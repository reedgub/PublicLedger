// Orchestrates one weekly (or backfill) pass of xAI-driven X discovery.
//
// For each verified expert:
//   1. Read the checkpoint. Compute the next window with 2-day overlap.
//   2. Ask xAI for candidate predictions in that window.
//   3. For each candidate, verify the post via publish.x.com/oembed:
//      author must match; source_quote must be an exact substring of the
//      oembed body text (after presentation-level normalization only).
//   4. Insert verified posts into public.sources with source_type='x',
//      priming the existing extract/verify pipeline that runs downstream.
//   5. Record cost + tokens in public.x_discovery_runs.
//   6. If xAI reports saturation, split the window recursively (bounded).
//   7. Update the checkpoint on success (or failure) before moving on.
//
// Budget: soft/hard weekly caps are enforced from previous x_discovery_runs
// rows within a rolling 7-day window plus this run's live spend.

import { createHash } from "node:crypto";
import pLimit from "p-limit";
import type { Sql } from "postgres";
import { env, integrations } from "@/lib/env";
import { getDatabase } from "@/lib/db/postgres";
import { canonicalizeXPostUrl } from "@/lib/x/url";
import { quoteIsPresent } from "@/lib/x/verify";
import { XOembedNotFoundError, fetchXOembed } from "@/lib/x/oembed";
import { XaiNotConfiguredError, fetchXaiDiscovery, type XaiCandidate } from "@/lib/x/xai";
import { createBudgetTracker, type BudgetTracker } from "@/lib/ingestion/budget";
import { computeNextWindow, type ExpertCheckpoint } from "@/lib/ingestion/checkpoints";
import { createSaturationQueue } from "@/lib/ingestion/split";

export type RunOptions = {
  onlyExpertSlug?: string;
  backfillDays?: number;
  maxCandidatesPerWindow?: number;
  maxWindowsPerExpert?: number;
  concurrency?: number;
  now?: Date;
  dryRun?: boolean;
};

export type ExpertResult = {
  expertId: string;
  handle: string;
  windowsQueried: number;
  candidatesReturned: number;
  candidatesVerified: number;
  candidatesInserted: number;
  costUsd: number;
  status: "succeeded" | "skipped" | "budget_hit" | "failed";
  reason?: string;
};

export type RunSummary = {
  runId: string | null;
  expertsAttempted: number;
  expertsSucceeded: number;
  totalCandidatesReturned: number;
  totalCandidatesInserted: number;
  totalCostUsd: number;
  hitSoftBudget: boolean;
  hitHardBudget: boolean;
  perExpert: ExpertResult[];
};

type ExpertRow = {
  id: string;
  slug: string;
  display_name: string;
  x_handle: string;
  source_status: string;
};

type CheckpointRow = {
  expert_id: string;
  source_type: string;
  last_started_at: string | null;
  last_success_at: string | null;
  last_from_date: string | null;
  last_to_date: string | null;
  last_status: string | null;
  last_error: string | null;
  updated_at: string;
};

function toCheckpoint(row: CheckpointRow): ExpertCheckpoint {
  return {
    expertId: row.expert_id,
    sourceType: row.source_type,
    lastStartedAt: row.last_started_at,
    lastSuccessAt: row.last_success_at,
    lastFromDate: row.last_from_date,
    lastToDate: row.last_to_date,
    lastStatus: row.last_status,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

async function loadCheckpoint(sql: Sql, expertId: string): Promise<ExpertCheckpoint | null> {
  const rows = await sql<CheckpointRow[]>`
    select * from public.ingestion_checkpoints
    where expert_id = ${expertId} and source_type = 'x' limit 1
  `;
  return rows[0] ? toCheckpoint(rows[0]) : null;
}

async function upsertCheckpoint(
  sql: Sql,
  input: {
    expertId: string;
    startedAt: string;
    successAt: string | null;
    fromDate: string;
    toDate: string;
    status: string;
    error: string | null;
  },
): Promise<void> {
  await sql`
    insert into public.ingestion_checkpoints
      (expert_id, source_type, last_started_at, last_success_at, last_from_date, last_to_date, last_status, last_error, updated_at)
    values
      (${input.expertId}, 'x', ${input.startedAt}, ${input.successAt}, ${input.fromDate}, ${input.toDate}, ${input.status}, ${input.error}, now())
    on conflict (expert_id, source_type) do update set
      last_started_at = excluded.last_started_at,
      last_success_at = coalesce(excluded.last_success_at, public.ingestion_checkpoints.last_success_at),
      last_from_date = excluded.last_from_date,
      last_to_date = excluded.last_to_date,
      last_status = excluded.last_status,
      last_error = excluded.last_error,
      updated_at = now()
  `;
}

async function loadWeeklySpendSql(sql: Sql, ingestionRunId: string | null): Promise<number> {
  const rows = await sql<{ total: string | null }[]>`
    select sum(cost_usd)::text as total from public.x_discovery_runs
    where started_at >= now() - interval '7 days'
      and (${ingestionRunId}::uuid is null or ingestion_run_id is distinct from ${ingestionRunId}::uuid)
  `;
  return Number(rows[0]?.total ?? 0) || 0;
}

async function insertDiscoveryRun(
  sql: Sql,
  input: {
    ingestionRunId: string | null;
    expertId: string;
    fromDate: string;
    toDate: string;
    model: string;
    promptVersion: string;
    status: "running" | "succeeded" | "failed" | "cached" | "saturated" | "deferred";
    candidateCount: number;
    xSearchToolCalls: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    costUsd: number;
    requestId: string | null;
    raw: unknown;
  },
): Promise<void> {
  await sql`
    insert into public.x_discovery_runs
      (ingestion_run_id, expert_id, from_date, to_date, model, prompt_version, status, candidate_count,
       x_search_tool_calls, input_tokens, output_tokens, reasoning_tokens, cost_usd, request_id, raw,
       started_at, completed_at)
    values
      (${input.ingestionRunId}, ${input.expertId}, ${input.fromDate}, ${input.toDate}, ${input.model},
       ${input.promptVersion}, ${input.status}, ${input.candidateCount}, ${input.xSearchToolCalls},
       ${input.inputTokens}, ${input.outputTokens}, ${input.reasoningTokens}, ${input.costUsd},
       ${input.requestId}, ${sql.json(input.raw as never)}, now(), now())
    on conflict (expert_id, from_date, to_date, prompt_version, model) do update set
      status = excluded.status,
      candidate_count = excluded.candidate_count,
      x_search_tool_calls = excluded.x_search_tool_calls,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      reasoning_tokens = excluded.reasoning_tokens,
      cost_usd = excluded.cost_usd,
      request_id = excluded.request_id,
      raw = excluded.raw,
      completed_at = now()
  `;
}

async function insertOembedSource(
  sql: Sql,
  candidate: XaiCandidate,
  oembed: Awaited<ReturnType<typeof fetchXOembed>>,
  expertHandle: string,
): Promise<{ inserted: boolean }> {
  const hash = createHash("sha256").update(oembed.bodyText).digest("hex");
  const canonicalPath = new URL(oembed.canonicalUrl).pathname;
  const publishedAt = candidate.postedAt ?? oembed.fetchedAt;
  const metadata = {
    xai_candidate: {
      proposed_normalized_claim: candidate.proposedNormalizedClaim,
      proposed_resolution_date: candidate.proposedResolutionDate,
      proposed_resolution_criteria: candidate.proposedResolutionCriteria,
      explicit_probability: candidate.explicitProbability,
      category: candidate.category,
      falsifiability_rating: candidate.falsifiabilityRating,
      source_quote: candidate.sourceQuote,
    },
    oembed: {
      author_name: oembed.authorName,
      author_handle: oembed.authorHandle,
      cache_age: oembed.cacheAge,
    },
  };
  const result = await sql<{ id: string; inserted: boolean }[]>`
    insert into public.sources
      (source_type, external_id, canonical_path, author_external_id, author_handle, published_at,
       exact_text, content_hash, metadata, fetched_at, last_verified_at, oembed_verified_at,
       oembed_cache_age, source_verification_level, source_available)
    values
      ('x', ${candidate.postId}, ${canonicalPath}, null, ${expertHandle}, ${publishedAt},
       ${oembed.bodyText}, ${hash}, ${sql.json(metadata as never)}, now(), now(), now(),
       ${oembed.cacheAge}, 'xai_oembed', true)
    on conflict (source_type, external_id) where external_id is not null do update set
      canonical_path = excluded.canonical_path,
      author_handle = excluded.author_handle,
      published_at = coalesce(public.sources.published_at, excluded.published_at),
      exact_text = coalesce(public.sources.exact_text, excluded.exact_text),
      content_hash = coalesce(public.sources.content_hash, excluded.content_hash),
      metadata = public.sources.metadata || excluded.metadata,
      last_verified_at = now(),
      oembed_verified_at = now(),
      oembed_cache_age = excluded.oembed_cache_age,
      source_verification_level = coalesce(public.sources.source_verification_level, excluded.source_verification_level),
      source_available = true,
      deleted_at = null
    returning id, (xmax = 0) as inserted
  `;
  return { inserted: result[0]?.inserted ?? false };
}

async function verifyOne(
  sql: Sql,
  candidate: XaiCandidate,
  expertHandle: string,
): Promise<"verified" | "quote_mismatch" | "gone" | "author_mismatch" | "invalid_url" | "error"> {
  const ref = canonicalizeXPostUrl(candidate.postUrl);
  if (!ref) return "invalid_url";
  if (ref.handle.toLowerCase() !== expertHandle.replace(/^@/, "").toLowerCase()) return "author_mismatch";
  try {
    const oembed = await fetchXOembed(candidate.postUrl);
    if (!quoteIsPresent(candidate.sourceQuote, oembed.bodyText)) return "quote_mismatch";
    await insertOembedSource(sql, candidate, oembed, expertHandle);
    return "verified";
  } catch (error) {
    if (error instanceof XOembedNotFoundError) return "gone";
    throw error;
  }
}

async function runOneExpert(
  sql: Sql,
  expert: ExpertRow,
  options: RunOptions,
  ingestionRunId: string | null,
  tracker: BudgetTracker,
): Promise<ExpertResult> {
  const now = options.now ?? new Date();
  const checkpoint = await loadCheckpoint(sql, expert.id);
  const rootWindow = computeNextWindow(checkpoint, { now, backfillDays: options.backfillDays });
  if (!rootWindow) {
    return {
      expertId: expert.id, handle: expert.x_handle,
      windowsQueried: 0, candidatesReturned: 0, candidatesVerified: 0, candidatesInserted: 0,
      costUsd: 0, status: "skipped", reason: "no window",
    };
  }

  const queue = createSaturationQueue(
    { fromDate: rootWindow.fromDate, toDate: rootWindow.toDate },
    { maxWindows: options.maxWindowsPerExpert ?? 6 },
  );

  const startedAt = new Date().toISOString();
  let windowsQueried = 0;
  let candidatesReturned = 0;
  let candidatesVerified = 0;
  let candidatesInserted = 0;
  let costUsd = 0;
  let hardBudgetHit = false;
  let latestWindow = rootWindow;
  let lastError: string | null = null;

  while (true) {
    const window = queue.next();
    if (!window) break;
    if (!tracker.ensureUnderHard()) {
      hardBudgetHit = true;
      break;
    }
    latestWindow = window;
    windowsQueried += 1;
    try {
      const discovery = await fetchXaiDiscovery({
        expertHandle: expert.x_handle,
        expertDisplayName: expert.display_name,
        fromDate: window.fromDate,
        toDate: window.toDate,
        maxCandidates: options.maxCandidatesPerWindow,
        promptVersion: env.XAI_DISCOVERY_PROMPT_VERSION,
        runId: ingestionRunId ?? undefined,
      });
      tracker.spend(discovery.usage.costUsd);
      costUsd += discovery.usage.costUsd;
      candidatesReturned += discovery.candidates.length;

      if (!options.dryRun) {
        for (const candidate of discovery.candidates) {
          const outcome = await verifyOne(sql, candidate, expert.x_handle);
          if (outcome === "verified") {
            candidatesVerified += 1;
            candidatesInserted += 1;
          }
        }
      } else {
        candidatesVerified += discovery.candidates.length;
      }

      await insertDiscoveryRun(sql, {
        ingestionRunId,
        expertId: expert.id,
        fromDate: window.fromDate,
        toDate: window.toDate,
        model: discovery.usage.model,
        promptVersion: env.XAI_DISCOVERY_PROMPT_VERSION,
        status: discovery.saturationLikely ? "saturated" : "succeeded",
        candidateCount: discovery.candidates.length,
        xSearchToolCalls: discovery.usage.xSearchToolCalls,
        inputTokens: discovery.usage.inputTokens,
        outputTokens: discovery.usage.outputTokens,
        reasoningTokens: discovery.usage.reasoningTokens,
        costUsd: discovery.usage.costUsd,
        requestId: discovery.usage.requestId,
        raw: discovery.raw,
      });

      if (discovery.saturationLikely) queue.reportSaturated(window);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown xai error";
      await insertDiscoveryRun(sql, {
        ingestionRunId,
        expertId: expert.id,
        fromDate: window.fromDate,
        toDate: window.toDate,
        model: env.XAI_MODEL,
        promptVersion: env.XAI_DISCOVERY_PROMPT_VERSION,
        status: "failed",
        candidateCount: 0, xSearchToolCalls: 0,
        inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
        costUsd: 0, requestId: null, raw: { error: lastError },
      });
    }
  }

  const successAt = lastError === null && !hardBudgetHit ? new Date().toISOString() : null;
  await upsertCheckpoint(sql, {
    expertId: expert.id,
    startedAt,
    successAt,
    fromDate: rootWindow.fromDate,
    toDate: latestWindow.toDate,
    status: hardBudgetHit ? "budget_hit" : lastError ? "failed" : "succeeded",
    error: lastError,
  });

  return {
    expertId: expert.id, handle: expert.x_handle,
    windowsQueried, candidatesReturned, candidatesVerified, candidatesInserted,
    costUsd,
    status: hardBudgetHit ? "budget_hit" : lastError ? "failed" : "succeeded",
    reason: lastError ?? undefined,
  };
}

async function ensureIngestionRun(sql: Sql, jobType: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    insert into public.ingestion_runs (source_type, job_type, status, started_at)
    values ('x', ${jobType}, 'running', now()) returning id
  `;
  return rows[0]?.id ?? null;
}

async function finalizeIngestionRun(
  sql: Sql,
  runId: string,
  summary: { itemsRequested: number; itemsFetched: number; itemsCreated: number; errors: number; metadata: Record<string, unknown> },
): Promise<void> {
  await sql`
    update public.ingestion_runs set
      status = ${summary.errors > 0 ? "limited" : "succeeded"},
      finished_at = now(),
      items_requested = ${summary.itemsRequested},
      items_fetched = ${summary.itemsFetched},
      items_created = ${summary.itemsCreated},
      errors = ${summary.errors},
      metadata = ${sql.json(summary.metadata as never)}
    where id = ${runId}
  `;
}

export async function runXaiWeekly(options: RunOptions = {}): Promise<RunSummary> {
  if (!integrations.xai) throw new XaiNotConfiguredError();
  const sql = getDatabase();
  const jobType = options.backfillDays && options.backfillDays > 14 ? "x_backfill" : "x_weekly";
  const ingestionRunId = await ensureIngestionRun(sql, jobType);

  const priorSpent = await loadWeeklySpendSql(sql, ingestionRunId);
  const tracker = createBudgetTracker(priorSpent);

  const experts = options.onlyExpertSlug
    ? await sql<ExpertRow[]>`
        select id, slug, display_name, x_handle, source_status
        from public.experts
        where (slug = ${options.onlyExpertSlug} or lower(x_handle) = lower(${options.onlyExpertSlug.replace(/^@/, "")}))
          and x_handle is not null
      `
    : await sql<ExpertRow[]>`
        select id, slug, display_name, x_handle, source_status
        from public.experts
        where is_active and x_handle is not null
        order by display_name
      `;

  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 1));
  const limit = pLimit(concurrency);
  const perExpert: ExpertResult[] = [];
  let expertsSucceeded = 0;

  await Promise.all(
    experts.map((expert) =>
      limit(async () => {
        if (!tracker.ensureUnderHard()) {
          perExpert.push({
            expertId: expert.id, handle: expert.x_handle,
            windowsQueried: 0, candidatesReturned: 0, candidatesVerified: 0, candidatesInserted: 0,
            costUsd: 0, status: "budget_hit", reason: "hard budget hit before start",
          });
          return;
        }
        const result = await runOneExpert(sql, expert, options, ingestionRunId, tracker);
        perExpert.push(result);
        if (result.status === "succeeded") expertsSucceeded += 1;
      }),
    ),
  );

  const totalCandidatesReturned = perExpert.reduce((sum, r) => sum + r.candidatesReturned, 0);
  const totalCandidatesInserted = perExpert.reduce((sum, r) => sum + r.candidatesInserted, 0);
  const totalCostUsd = perExpert.reduce((sum, r) => sum + r.costUsd, 0);
  const snap = tracker.snapshot();

  if (ingestionRunId) {
    await finalizeIngestionRun(sql, ingestionRunId, {
      itemsRequested: experts.length,
      itemsFetched: totalCandidatesReturned,
      itemsCreated: totalCandidatesInserted,
      errors: perExpert.filter((r) => r.status === "failed").length,
      metadata: {
        job_type: jobType,
        cost_usd_this_run: Number(totalCostUsd.toFixed(4)),
        cost_usd_weekly_total: Number(snap.spentUsd.toFixed(4)),
        hit_soft_budget: !snap.underSoft,
        hit_hard_budget: !snap.underHard,
        per_expert_top20: perExpert.slice(0, 20),
      },
    });
  }

  return {
    runId: ingestionRunId,
    expertsAttempted: experts.length,
    expertsSucceeded,
    totalCandidatesReturned,
    totalCandidatesInserted,
    totalCostUsd,
    hitSoftBudget: !snap.underSoft,
    hitHardBudget: !snap.underHard,
    perExpert,
  };
}
