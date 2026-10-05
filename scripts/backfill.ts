// Historical backfill (2–5 years), built to be cheap, resumable and honest
// about coverage.
//
//   pnpm backfill --estimate                       # forecast cost; no post reads
//   pnpm backfill --years 2 --budget 20            # collect + process within $20
//   pnpm backfill --experts sama,LHSummers --years 5 --sources x,writing,podcast
//   pnpm backfill --years 3 --skip-process          # collect only
//
// Order of work: months 12–36 months old first (resolvable now), then the
// last year, then older history. Months are interleaved across experts so a
// budget cap spreads coverage evenly instead of exhausting one prolific
// account. Every month's status lands in public.ingestion_coverage; rerunning
// the command continues where the last run stopped.

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDatabase, getDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http/retry";
import { buildCascadeXQuery, CASCADE_X_QUERY_VERSION, type XQueryTier } from "@/lib/sources/x-query";
import { countXQuery, searchXQuery } from "@/lib/sources/x";
import { collectSitemap, collectFeed } from "@/lib/sources/feed";
import { episodeRecord, fetchPodcastEpisodes, transcribeEpisode } from "@/lib/sources/podcast";
import { ensureCoverage, loadCoverage, markCoverage, planMonthlyPeriods, prioritizePeriods, setEstimate, type Period } from "@/lib/pipeline/coverage";
import { forecastCost, measuredRatios } from "@/lib/pipeline/estimate";
import { createBudgetGuard, recordSpend, transcriptionCostUsd, xReadCostUsd, type BudgetGuard } from "@/lib/pipeline/spend";
import { storeSourceRecords } from "@/lib/pipeline/store";
import { processCascade } from "@/scripts/process-cascade";

type Flags = {
  years: number;
  experts: string[];
  limitExperts?: number;
  sources: Set<"x" | "writing" | "podcast">;
  estimate: boolean;
  budgetUsd?: number;
  tier: XQueryTier;
  includeReplies: boolean;
  maxPostsPerPeriod: number;
  maxPeriods?: number;
  includeUnverified: boolean;
  skipProcess: boolean;
};

function parseFlags(argv: string[]): Flags {
  const get = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const sources = new Set((get("--sources") ?? "x,writing").split(",").map((value) => value.trim()).filter(Boolean)) as Flags["sources"];
  const years = Number(get("--years") ?? 2);
  if (!(years >= 0.25 && years <= 10)) throw new Error("--years must be between 0.25 and 10");
  return {
    years,
    experts: (get("--experts") ?? get("--expert") ?? "").split(",").map((value) => value.trim().replace(/^@/, "")).filter(Boolean),
    limitExperts: get("--limit-experts") ? Number(get("--limit-experts")) : undefined,
    sources,
    estimate: argv.includes("--estimate"),
    budgetUsd: get("--budget") ? Number(get("--budget")) : undefined,
    tier: get("--tier") === "recall" ? "recall" : "precision",
    includeReplies: argv.includes("--include-replies"),
    maxPostsPerPeriod: Number(get("--max-posts-per-period") ?? 1500),
    maxPeriods: get("--max-periods") ? Number(get("--max-periods")) : undefined,
    includeUnverified: argv.includes("--include-unverified"),
    skipProcess: argv.includes("--skip-process"),
  };
}

type ExpertRow = { id: string; slug: string; display_name: string; x_handle: string | null };
type ExpertSourceRow = { id: string; expert_id: string; kind: "feed" | "sitemap" | "podcast"; url: string; expert_is_host: boolean; display_name: string; x_handle: string | null };

async function loadExperts(flags: Flags): Promise<ExpertRow[]> {
  const sql = getDatabase();
  const rows = flags.experts.length
    ? await sql<ExpertRow[]>`
        select id, slug, display_name, x_handle from public.experts
        where is_active and (slug = any(${flags.experts}) or lower(x_handle) = any(${flags.experts.map((value) => value.toLowerCase())}))
        order by display_name`
    : await sql<ExpertRow[]>`
        select id, slug, display_name, x_handle from public.experts
        where is_active and (${flags.includeUnverified} or source_status = 'verified')
        order by display_name`;
  return flags.limitExperts ? rows.slice(0, flags.limitExperts) : rows;
}

const yearPeriods = (periods: Period[]) => {
  const byYear = new Map<number, Period>();
  for (const period of periods) {
    const year = period.start.getUTCFullYear();
    const current = byYear.get(year);
    byYear.set(year, current ? { start: current.start < period.start ? current.start : period.start, end: current.end > period.end ? current.end : period.end } : { ...period });
  }
  return [...byYear.values()];
};

// ---- Estimate ---------------------------------------------------------------------

async function estimate(flags: Flags, experts: ExpertRow[], periods: Period[]) {
  let xPosts = 0;
  let audioHours = 0;
  let writingDocs = 0;
  const perExpert: Array<{ handle: string; matchingPosts: number }> = [];
  const since = periods[0].start;
  const until = periods[periods.length - 1].end;

  if (flags.sources.has("x") && env.X_BEARER_TOKEN) {
    for (const expert of experts) {
      if (!expert.x_handle) continue;
      await ensureCoverage(expert.id, "x", periods, CASCADE_X_QUERY_VERSION);
      const coverage = await loadCoverage(expert.id, "x", since);
      let total = 0;
      // One counts query per calendar year (year terms are year-specific);
      // daily buckets are rolled up into the monthly coverage rows.
      for (const year of yearPeriods(periods)) {
        const query = buildCascadeXQuery(expert.x_handle, { start: year.start, end: year.end, tier: flags.tier, includeReplies: flags.includeReplies });
        try {
          const counts = await countXQuery({ query, start: year.start, end: year.end, mode: "full-archive" });
          const monthly = new Map<number, number>();
          for (const bucket of counts.buckets) {
            const start = new Date(bucket.start);
            if (start < year.start || start >= year.end) continue;
            const key = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
            monthly.set(key, (monthly.get(key) ?? 0) + bucket.count);
          }
          // Months inside this year with no buckets have zero matching posts:
          // recording 0 lets the collector mark them complete without a read.
          for (const row of coverage) {
            const start = new Date(row.period_start);
            if (start < year.start || start >= year.end || row.status === "complete") continue;
            const count = monthly.get(start.getTime()) ?? 0;
            await setEstimate(row.id, count);
            total += count;
          }
        } catch (error) {
          if (error instanceof HttpError && [401, 403].includes(error.status)) {
            throw new Error("X counts/full-archive access was refused (401/403). Check that your X plan includes full-archive search.");
          }
          throw error;
        }
      }
      xPosts += Math.min(total, flags.maxPostsPerPeriod * periods.length);
      perExpert.push({ handle: expert.x_handle, matchingPosts: total });
    }
  } else if (flags.sources.has("x")) {
    console.warn("X_BEARER_TOKEN not set: X volume cannot be estimated.");
  }

  const sources = await loadExpertSources(experts, ["podcast", "sitemap"]);
  if (flags.sources.has("podcast")) {
    for (const source of sources.filter((row) => row.kind === "podcast")) {
      const episodes = await fetchPodcastEpisodes(source.url).catch(() => []);
      for (const episode of episodes) {
        if (episode.publishedAt && episode.publishedAt >= since && episode.publishedAt < until) audioHours += (episode.durationSeconds ?? 3600) / 3600;
      }
    }
  }
  if (flags.sources.has("writing")) writingDocs = sources.filter((row) => row.kind === "sitemap").length * 12 * flags.years; // ~1 post/month guess

  const ratios = await measuredRatios();
  const forecast = forecastCost({ xPosts, audioHours, writingDocs, ratios, withScreen: Boolean(env.OPEN_MODEL_API_KEY) });
  perExpert.sort((a, b) => b.matchingPosts - a.matchingPosts);
  const round = (value: number) => Number(value.toFixed(2));
  console.log(JSON.stringify({
    stage: "backfill_estimate",
    years: flags.years,
    window: { from: since.toISOString(), to: until.toISOString() },
    experts: experts.length,
    query_tier: flags.tier,
    x_matching_posts: xPosts,
    podcast_audio_hours: round(audioHours),
    writing_docs_guess: writingDocs,
    usd: {
      x_reads: round(forecast.xReadUsd),
      transcription: round(forecast.transcriptionUsd),
      stage1_screen: round(forecast.screenUsd),
      stage2_extract: round(forecast.extractUsd),
      stage3_verify: round(forecast.verifyUsd),
      total: round(forecast.totalUsd),
    },
    expected_candidates: Math.round(forecast.expectedCandidates),
    ratios_measured: forecast.ratios.measured,
    top_experts_by_volume: perExpert.slice(0, 15),
    note: "Estimate only. Prices come from .env (X_PRICE_PER_POST_READ_USD, OPEN_MODEL_*_PRICE_*, OPENAI_PRICE_*, TRANSCRIBE_PRICE_PER_HOUR_USD) — set them from your provider dashboards.",
  }, null, 2));
}

async function loadExpertSources(experts: ExpertRow[], kinds: Array<ExpertSourceRow["kind"]>): Promise<ExpertSourceRow[]> {
  if (experts.length === 0) return [];
  const sql = getDatabase();
  return sql<ExpertSourceRow[]>`
    select es.id, es.expert_id, es.kind, es.url, es.expert_is_host, e.display_name, e.x_handle
    from public.expert_sources es join public.experts e on e.id = es.expert_id
    where es.is_active and es.kind = any(${kinds}) and es.expert_id = any(${experts.map((expert) => expert.id)}::uuid[])
  `;
}

// ---- Collect: X -------------------------------------------------------------------

async function collectX(flags: Flags, experts: ExpertRow[], periods: Period[], guard: BudgetGuard, runId: string) {
  if (!env.X_BEARER_TOKEN) {
    console.warn("X_BEARER_TOKEN not set: skipping X backfill.");
    return { posts: 0, newSources: 0, periods: 0, stoppedByBudget: false };
  }
  const now = new Date();
  const ordered = prioritizePeriods(periods, now);
  const withHandles = experts.filter((expert) => expert.x_handle);
  const coverageByExpert = new Map<string, Map<number, { id: string; status: string; estimated_items: number | null }>>();
  for (const expert of withHandles) {
    await ensureCoverage(expert.id, "x", periods, CASCADE_X_QUERY_VERSION);
    const rows = await loadCoverage(expert.id, "x", periods[0].start);
    coverageByExpert.set(expert.id, new Map(rows.map((row) => [new Date(row.period_start).getTime(), row])));
  }
  let posts = 0; let newSources = 0; let done = 0;
  const perExpertDone = new Map<string, number>();
  for (const period of ordered) {
    for (const expert of withHandles) {
      const row = coverageByExpert.get(expert.id)?.get(period.start.getTime());
      if (!row || row.status === "complete" || row.status === "skipped") continue;
      if (flags.maxPeriods && (perExpertDone.get(expert.id) ?? 0) >= flags.maxPeriods) continue;
      if (row.estimated_items === 0) {
        await markCoverage(row.id, "complete", { queryVersion: CASCADE_X_QUERY_VERSION });
        continue;
      }
      // Budget check against the known (or a capped default) volume.
      const expected = Math.min(row.estimated_items ?? 100, flags.maxPostsPerPeriod);
      if (!guard.canSpend(xReadCostUsd(expected, Math.ceil(expected / 500)))) {
        console.log(JSON.stringify({ stage: "backfill_budget_reached", spent_usd: Number(guard.spentUsd.toFixed(4)), cap_usd: guard.capUsd }));
        return { posts, newSources, periods: done, stoppedByBudget: true };
      }
      await markCoverage(row.id, "running");
      try {
        const query = buildCascadeXQuery(expert.x_handle!, { start: period.start, end: period.end, tier: flags.tier, includeReplies: flags.includeReplies });
        const result = await searchXQuery({ query, handle: expert.x_handle!, start: period.start, end: period.end, mode: "full-archive", maxPosts: flags.maxPostsPerPeriod });
        const cost = xReadCostUsd(result.postsRead, result.requests);
        await recordSpend({ scope: "backfill", runId, provider: "x", stage: "backfill_search", units: result.postsRead, unitKind: "post_read", costUsd: cost, metadata: { expert_id: expert.id, period_start: period.start.toISOString() } }, guard);
        const created = await storeSourceRecords(result.records, { expertId: expert.id, mode: "backfill", verificationLevel: "x_api" });
        posts += result.postsRead; newSources += created; done += 1;
        perExpertDone.set(expert.id, (perExpertDone.get(expert.id) ?? 0) + 1);
        // Hitting the per-month cap means the month was not fully scanned.
        await markCoverage(row.id, result.postsRead >= flags.maxPostsPerPeriod ? "partial" : "complete", { itemsFetched: result.postsRead, costUsd: cost, queryVersion: CASCADE_X_QUERY_VERSION });
      } catch (error) {
        await markCoverage(row.id, "failed", { error: error instanceof Error ? error.message.slice(0, 300) : "unknown" });
        if (error instanceof HttpError && [401, 403].includes(error.status)) {
          throw new Error("X full-archive search was refused (401/403). Check that your X plan includes full-archive search.");
        }
        console.error(`X backfill failed for @${expert.x_handle} ${period.start.toISOString().slice(0, 7)}:`, error instanceof Error ? error.message : "unknown");
      }
    }
  }
  return { posts, newSources, periods: done, stoppedByBudget: false };
}

// ---- Collect: writing (sitemaps/feeds, free) ----------------------------------------

async function collectWriting(flags: Flags, experts: ExpertRow[], since: Date, until: Date) {
  const sources = await loadExpertSources(experts, ["sitemap", "feed"]);
  // Prefer the sitemap (full archive); fall back to the feed for experts without one.
  const withSitemap = new Set(sources.filter((row) => row.kind === "sitemap").map((row) => row.expert_id));
  let newSources = 0;
  for (const source of sources) {
    if (source.kind === "feed" && withSitemap.has(source.expert_id)) continue;
    const period = { start: since, end: until };
    const coverageType = `writing:${source.id}`;
    await ensureCoverage(source.expert_id, coverageType, [period], "sitemap-v1");
    const [row] = await loadCoverage(source.expert_id, coverageType, since);
    if (!row || row.status === "complete") continue;
    await markCoverage(row.id, "running");
    try {
      const result = source.kind === "sitemap"
        ? await collectSitemap({ sitemapUrl: source.url, expertName: source.display_name, expertHandle: source.x_handle, since, until, delayMs: 250 })
        : await collectFeed({ feedUrl: source.url, expertName: source.display_name, expertHandle: source.x_handle, since, until, maxItems: 500 });
      const created = await storeSourceRecords(result.records, { expertId: source.expert_id, mode: "backfill" });
      newSources += created;
      // A feed only reaches back as far as the publisher keeps items.
      await markCoverage(row.id, source.kind === "sitemap" ? "complete" : "partial", { itemsFetched: result.records.length });
      console.log(JSON.stringify({ stage: "backfill_writing", url: source.url, ...result.stats, created }));
    } catch (error) {
      await markCoverage(row.id, "failed", { error: error instanceof Error ? error.message.slice(0, 300) : "unknown" });
    }
  }
  return { newSources };
}

// ---- Collect: podcasts ------------------------------------------------------------

async function collectPodcasts(experts: ExpertRow[], since: Date, until: Date, guard: BudgetGuard, runId: string) {
  if (!env.TRANSCRIBE_API_KEY) {
    console.warn("TRANSCRIBE_API_KEY not set: skipping podcast backfill.");
    return { episodes: 0, stoppedByBudget: false };
  }
  const sql = getDatabase();
  const now = new Date();
  const sources = await loadExpertSources(experts, ["podcast"]);
  let episodes = 0;
  for (const source of sources) {
    const all = (await fetchPodcastEpisodes(source.url).catch(() => [])).filter((episode) => episode.publishedAt && episode.publishedAt >= since && episode.publishedAt < until);
    // Same value ordering as X: 12–36 months old first, newest first.
    const ordered = all.slice().sort((a, b) => {
      const band = (date: Date) => { const months = (now.getTime() - date.getTime()) / (30.44 * 86_400_000); return months >= 12 && months <= 36 ? 0 : months < 12 ? 1 : 2; };
      return band(a.publishedAt!) - band(b.publishedAt!) || b.publishedAt!.getTime() - a.publishedAt!.getTime();
    });
    for (const episode of ordered) {
      const [existing] = await sql<{ id: string }[]>`select id from public.sources where source_type = 'podcast' and external_id = ${episode.guid}`;
      if (existing) continue;
      if (!guard.canSpend(transcriptionCostUsd(episode.durationSeconds ?? 3600))) return { episodes, stoppedByBudget: true };
      try {
        const transcript = await transcribeEpisode(episode.audioUrl);
        await recordSpend({ scope: "backfill", runId, provider: new URL(env.TRANSCRIBE_BASE_URL).hostname, stage: "transcribe", units: transcript.audioSeconds, unitKind: "audio_seconds", costUsd: transcriptionCostUsd(transcript.audioSeconds), metadata: { expert_id: source.expert_id, guid: episode.guid } }, guard);
        const record = episodeRecord(episode, transcript, { expertHandle: source.x_handle, feedUrl: source.url, expertIsHost: source.expert_is_host });
        if (record) await storeSourceRecords([record], { expertId: source.expert_id, mode: "backfill" });
        episodes += 1;
      } catch (error) {
        console.error(`Transcription failed for ${episode.title}:`, error instanceof Error ? error.message : "unknown");
      }
    }
  }
  return { episodes, stoppedByBudget: false };
}

// ---- Main -------------------------------------------------------------------------

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const experts = await loadExperts(flags);
  if (experts.length === 0) throw new Error("No matching active experts.");
  const periods = planMonthlyPeriods(new Date(), flags.years);
  const since = periods[0].start;
  const until = periods[periods.length - 1].end;

  if (flags.estimate) {
    await estimate(flags, experts, periods);
    return;
  }

  const runId = randomUUID();
  const guard = await createBudgetGuard("backfill", { capUsd: flags.budgetUsd ?? env.BACKFILL_BUDGET_USD });
  console.log(JSON.stringify({ stage: "backfill_start", run_id: runId, experts: experts.length, years: flags.years, sources: [...flags.sources], budget_cap_usd: guard.capUsd, already_spent_usd: Number(guard.spentUsd.toFixed(4)) }));

  // Free sources first, then paid ones in value order.
  const writing = flags.sources.has("writing") ? await collectWriting(flags, experts, since, until) : null;
  const x = flags.sources.has("x") ? await collectX(flags, experts, periods, guard, runId) : null;
  const podcasts = flags.sources.has("podcast") ? await collectPodcasts(experts, since, until, guard, runId) : null;
  console.log(JSON.stringify({ stage: "backfill_collected", writing, x, podcasts, spent_usd: Number(guard.spentUsd.toFixed(4)) }));

  if (!flags.skipProcess) {
    // Processing draws on the same backfill budget; whatever collection left.
    await processCascade({ mode: "backfill", budgetUsd: flags.budgetUsd ?? env.BACKFILL_BUDGET_USD });
  }
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(closeDatabase);
