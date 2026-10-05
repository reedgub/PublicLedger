// Stage 3 runners: submit pending cascade candidates to the OpenAI Batch API,
// collect finished batches, or verify synchronously for small volumes. All
// three converge on applyVerdict(), which owns the publish/reject
// decision and its audit trail.

import { toFile } from "openai";
import { env } from "@/lib/env";
import { getDatabase } from "@/lib/db/postgres";
import { getOpenAIClient } from "@/lib/ai/client";
import type { ExtractedPrediction } from "@/lib/ai/schemas";
import { isLikelyDuplicate } from "@/lib/predictions/dedupe";
import { publishCandidate } from "@/lib/pipeline/publish";
import { isProviderOutage } from "@/lib/pipeline/cascade";
import { recordSpend, tokenCostUsd, type BudgetGuard, type SpendScope } from "@/lib/pipeline/spend";
import {
  buildBatchLine,
  buildVerifierRequestBody,
  buildVerifierUserPrompt,
  cascadeVerdictSchema,
  CASCADE_VERIFIER_SYSTEM_PROMPT,
  CASCADE_VERIFIER_VERSION,
  decideCandidate,
  parseBatchOutputLine,
  type CascadeVerdict,
  type VerifierInput,
} from "@/lib/pipeline/verify";

type PendingRow = {
  id: string;
  source_id: string;
  expert_id: string;
  raw_extraction: { candidate: ExtractedPrediction; force_review?: boolean; capture_mode?: "live" | "backfill"; verify_attempts?: number };
  exact_text: string;
  published_at: string;
  source_type: string;
  ingestion_mode: "live" | "backfill";
  display_name: string;
  x_handle: string | null;
};

const MAX_BATCH_LINES = 50_000;
const MAX_VERIFY_ATTEMPTS = 2;

function verifierPrice() {
  return { input: env.OPENAI_PRICE_INPUT_PER_MTOK_USD, output: env.OPENAI_PRICE_OUTPUT_PER_MTOK_USD };
}

function toVerifierInput(row: PendingRow): VerifierInput {
  return {
    authorName: row.display_name,
    authorHandle: row.x_handle,
    sourceType: row.source_type,
    sourceTimestamp: new Date(row.published_at).toISOString(),
    sourceText: row.exact_text,
    candidate: row.raw_extraction.candidate,
  };
}

/** Rough per-candidate verification cost, used to keep a batch under budget. */
export function estimateVerifyCostUsd(input: VerifierInput, discount: number): number {
  const inputTokens = (CASCADE_VERIFIER_SYSTEM_PROMPT.length + buildVerifierUserPrompt(input).length) / 4;
  return tokenCostUsd({ inputTokens, outputTokens: 400 }, verifierPrice(), discount);
}

async function loadPending(limit: number): Promise<PendingRow[]> {
  const sql = getDatabase();
  return sql<PendingRow[]>`
    select pc.id, pc.source_id, pc.expert_id, pc.raw_extraction, s.exact_text, s.published_at::text, s.source_type, s.ingestion_mode,
      e.display_name, e.x_handle
    from public.prediction_candidates pc
    join public.sources s on s.id = pc.source_id
    join public.experts e on e.id = pc.expert_id
    where pc.status = 'pending' and pc.pipeline = 'cascade' and pc.verification_batch_id is null
      and s.deleted_at is null and s.exact_text is not null
    order by s.published_at asc
    limit ${limit}
  `;
}

export type ApplySummary = { published: number; rejected: number; duplicates: number; errors: number };

export async function applyVerdict(row: PendingRow, verdict: CascadeVerdict, summary: ApplySummary): Promise<void> {
  const sql = getDatabase();
  const candidate = row.raw_extraction.candidate;
  await sql`
    update public.prediction_candidates set verifier_verdict = ${verdict.verdict}, verifier_confidence = ${verdict.confidence},
      raw_extraction = raw_extraction || ${sql.json({ verifier: verdict, verifier_version: CASCADE_VERIFIER_VERSION, verifier_model: env.CASCADE_VERIFIER_MODEL } as never)}
    where id = ${row.id}
  `;
  const action = decideCandidate(verdict, {
    recordType: candidate.record_type ?? "prediction",
    forceReview: row.raw_extraction.force_review === true,
    hasResolutionDate: Boolean(candidate.resolution_date),
  });
  if (action.action === "reject") {
    await sql`update public.prediction_candidates set status = 'rejected', reason_rejected = ${`Verifier: ${action.reason}`.slice(0, 500)} where id = ${row.id}`;
    await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction_candidate', ${row.id}, 'prediction_rejected', 'system', ${sql.json({ verdict } as never)}, ${`Cascade verifier: ${action.reason}`.slice(0, 1000)})`;
    summary.rejected += 1;
    return;
  }
  // Last-moment duplicate check: another candidate may have published since extraction.
  const published = await sql<{ normalized_claim: string; resolution_date: string | null }[]>`
    select normalized_claim, resolution_date::text from public.predictions where expert_id = ${row.expert_id}
  `;
  if (published.some((item) => isLikelyDuplicate(
    { expertId: row.expert_id, claim: candidate.normalized_claim, resolutionDate: candidate.resolution_date },
    { expertId: row.expert_id, claim: item.normalized_claim, resolutionDate: item.resolution_date },
  ))) {
    await sql`update public.prediction_candidates set status = 'duplicate', reason_rejected = 'semantic_duplicate' where id = ${row.id}`;
    summary.duplicates += 1;
    return;
  }
  await publishCandidate({
    candidateId: row.id,
    expertId: row.expert_id,
    sourceId: row.source_id,
    predictionDate: row.published_at,
    candidate,
    verificationMode: action.verificationMode,
    captureMode: row.ingestion_mode,
    auditAction: "prediction_auto_approved",
    auditReason: "Passed open-model extraction, deterministic validation, and the cascade frontier verifier.",
    auditAfter: { verifier_confidence: verdict.confidence },
  });
  summary.published += 1;
}

async function handleFailedVerification(row: PendingRow, reason: string) {
  const sql = getDatabase();
  const attempts = (row.raw_extraction.verify_attempts ?? 0) + 1;
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    // Fail closed: never publish without a verdict.
    await sql`update public.prediction_candidates set status = 'rejected', verification_batch_id = null, reason_rejected = ${`verifier_error: ${reason}`.slice(0, 500)}, raw_extraction = raw_extraction || ${sql.json({ verify_attempts: attempts } as never)} where id = ${row.id}`;
  } else {
    await sql`update public.prediction_candidates set verification_batch_id = null, raw_extraction = raw_extraction || ${sql.json({ verify_attempts: attempts } as never)} where id = ${row.id}`;
  }
}

// ---- Sync ----------------------------------------------------------------------

export async function verifyPendingSync(options: { guard: BudgetGuard; scope: SpendScope; limit?: number; runId?: string }): Promise<ApplySummary> {
  const summary: ApplySummary = { published: 0, rejected: 0, duplicates: 0, errors: 0 };
  if (!env.OPENAI_API_KEY) return summary;
  const rows = await loadPending(options.limit ?? 500);
  const client = getOpenAIClient();
  let cost = 0;
  let tokens = 0;
  for (const row of rows) {
    const input = toVerifierInput(row);
    if (!options.guard.canSpend(estimateVerifyCostUsd(input, 0))) break;
    try {
      const response = await client.chat.completions.create(buildVerifierRequestBody(input));
      const usage = { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 };
      const callCost = tokenCostUsd(usage, verifierPrice());
      cost += callCost;
      tokens += usage.inputTokens + usage.outputTokens;
      options.guard.add(callCost);
      const verdict = cascadeVerdictSchema.parse(JSON.parse(response.choices[0]?.message?.content ?? "{}"));
      await applyVerdict(row, verdict, summary);
    } catch (error) {
      summary.errors += 1;
      // Provider refused (credits, auth, rate limit): not the candidate's fault; retry next run.
      if (isProviderOutage(error)) {
        console.error(`Verifier provider unavailable: ${error instanceof Error ? error.message : "unknown"}. Pending candidates stay queued.`);
        break;
      }
      await handleFailedVerification(row, error instanceof Error ? error.message : "unknown");
    }
  }
  if (cost > 0) await recordSpend({ scope: options.scope, runId: options.runId, provider: "openai", stage: "verify_sync", units: tokens, unitKind: "tokens", costUsd: cost, metadata: { model: env.CASCADE_VERIFIER_MODEL, candidates: rows.length } });
  return summary;
}

// ---- Batch submit ----------------------------------------------------------------

export async function submitVerificationBatch(options: { guard: BudgetGuard; scope: SpendScope; limit?: number }): Promise<{ submitted: number; batchId: string | null; estimatedUsd: number }> {
  if (!env.OPENAI_API_KEY) return { submitted: 0, batchId: null, estimatedUsd: 0 };
  const sql = getDatabase();
  const rows = await loadPending(Math.min(options.limit ?? MAX_BATCH_LINES, MAX_BATCH_LINES));
  const lines: string[] = [];
  const included: string[] = [];
  let estimated = 0;
  for (const row of rows) {
    const input = toVerifierInput(row);
    const estimate = estimateVerifyCostUsd(input, env.OPENAI_BATCH_DISCOUNT);
    if (!options.guard.canSpend(estimated + estimate)) break;
    estimated += estimate;
    lines.push(buildBatchLine(row.id, input));
    included.push(row.id);
  }
  if (lines.length === 0) return { submitted: 0, batchId: null, estimatedUsd: 0 };
  const client = getOpenAIClient();
  const file = await client.files.create({ file: await toFile(Buffer.from(lines.join("\n"), "utf8"), "publicledger-verify.jsonl"), purpose: "batch" });
  // Record the batch and claim its candidates BEFORE creating it remotely, so
  // a crash can never leave a paid batch that nothing will collect.
  const [row] = await sql<{ id: string }[]>`
    insert into public.verification_batches (kind, status, model, item_count, input_file_id, metadata)
    values ('candidate_verify', 'submitted', ${env.CASCADE_VERIFIER_MODEL}, ${lines.length}, ${file.id}, ${sql.json({ scope: options.scope, estimated_usd: estimated } as never)})
    returning id
  `;
  await sql`update public.prediction_candidates set verification_batch_id = ${row.id} where id = any(${included}::uuid[])`;
  let batchId: string;
  try {
    const batch = await client.batches.create({ input_file_id: file.id, endpoint: "/v1/chat/completions", completion_window: "24h", metadata: { app: "publicledger", kind: "candidate_verify", row_id: row.id } });
    batchId = batch.id;
  } catch (error) {
    await sql`update public.prediction_candidates set verification_batch_id = null where verification_batch_id = ${row.id}`;
    await sql`delete from public.verification_batches where id = ${row.id}`;
    throw error;
  }
  await sql`update public.verification_batches set provider_batch_id = ${batchId} where id = ${row.id}`;
  // Reserve the estimate so later steps in the same run respect it; the
  // ledger gets the actual cost when the batch is collected.
  options.guard.add(estimated);
  return { submitted: lines.length, batchId, estimatedUsd: estimated };
}

// ---- Batch collect ----------------------------------------------------------------

export async function collectVerificationBatches(options: { scope: SpendScope }): Promise<ApplySummary & { batchesCollected: number; batchesPending: number }> {
  const summary = { published: 0, rejected: 0, duplicates: 0, errors: 0, batchesCollected: 0, batchesPending: 0 };
  if (!env.OPENAI_API_KEY) return summary;
  const sql = getDatabase();
  const client = getOpenAIClient();
  // A row without a provider id is a submit that died before the remote
  // batch existed (the metadata row_id lets you reconcile manually if the
  // remote call actually succeeded). After an hour, release its candidates.
  const stale = await sql<{ id: string }[]>`
    update public.verification_batches set status = 'failed', completed_at = now(), metadata = metadata || '{"error":"submit did not complete"}'::jsonb
    where status = 'submitted' and provider_batch_id is null and submitted_at < now() - interval '1 hour' returning id
  `;
  for (const row of stale) await sql`update public.prediction_candidates set verification_batch_id = null where verification_batch_id = ${row.id} and status = 'pending'`;
  const batches = await sql<{ id: string; provider_batch_id: string; metadata: { scope?: SpendScope } }[]>`
    select id, provider_batch_id, metadata from public.verification_batches where status = 'submitted' and provider_batch_id is not null order by submitted_at asc
  `;
  for (const batch of batches) {
    const remote = await client.batches.retrieve(batch.provider_batch_id);
    if (["validating", "in_progress", "finalizing", "cancelling"].includes(remote.status)) {
      summary.batchesPending += 1;
      continue;
    }
    if (remote.status !== "completed") {
      // failed / expired / cancelled: release candidates for resubmission.
      await sql`update public.verification_batches set status = ${remote.status === "expired" ? "expired" : remote.status === "cancelled" ? "cancelled" : "failed"}, completed_at = now(), metadata = metadata || ${sql.json({ errors: remote.errors ?? null } as never)} where id = ${batch.id}`;
      await sql`update public.prediction_candidates set verification_batch_id = null where verification_batch_id = ${batch.id} and status = 'pending'`;
      continue;
    }
    const rows = await sql<PendingRow[]>`
      select pc.id, pc.source_id, pc.expert_id, pc.raw_extraction, s.exact_text, s.published_at::text, s.source_type, s.ingestion_mode,
        e.display_name, e.x_handle
      from public.prediction_candidates pc
      join public.sources s on s.id = pc.source_id
      join public.experts e on e.id = pc.expert_id
      where pc.verification_batch_id = ${batch.id} and pc.status = 'pending'
    `;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const usage = { inputTokens: 0, outputTokens: 0 };
    const seen = new Set<string>();
    if (remote.output_file_id) {
      const text = await (await client.files.content(remote.output_file_id)).text();
      for (const line of text.split("\n")) {
        let parsed;
        try { parsed = parseBatchOutputLine(line); } catch { summary.errors += 1; continue; }
        if (!parsed) continue;
        usage.inputTokens += parsed.usage.inputTokens;
        usage.outputTokens += parsed.usage.outputTokens;
        const row = byId.get(parsed.candidateId);
        if (!row) continue;
        seen.add(row.id);
        if (!parsed.verdict) {
          summary.errors += 1;
          await handleFailedVerification(row, parsed.error ?? "no verdict");
          continue;
        }
        try {
          await applyVerdict(row, parsed.verdict, summary);
        } catch (error) {
          summary.errors += 1;
          console.error(`Applying verdict for ${row.id} failed:`, error instanceof Error ? error.message : "unknown");
        }
      }
    }
    // Lines missing from the output (only in the error file) get retried.
    for (const row of rows) if (!seen.has(row.id)) await handleFailedVerification(row, "missing from batch output");
    const cost = tokenCostUsd(usage, verifierPrice(), env.OPENAI_BATCH_DISCOUNT);
    await recordSpend({ scope: batch.metadata.scope ?? options.scope, provider: "openai_batch", stage: "verify_batch", units: usage.inputTokens + usage.outputTokens, unitKind: "tokens", costUsd: cost, metadata: { batch_id: batch.provider_batch_id, candidates: rows.length } });
    await sql`update public.verification_batches set status = 'collected', output_file_id = ${remote.output_file_id ?? null}, error_file_id = ${remote.error_file_id ?? null}, completed_at = now(), collected_at = now() where id = ${batch.id}`;
    summary.batchesCollected += 1;
  }
  return summary;
}
