// Daily low-cost ingestion.
//
//   1. Collect finished verification batches from earlier runs (publishes).
//   2. Search each expert's recent X posts since the last seen post id,
//      filtered server-side to forecast vocabulary so only candidate posts
//      are read and billed (official API; retweets/replies excluded).
//   3. Pull new posts from registered feeds and new podcast episodes.
//   4. Run the cascade over everything new and submit stage 3 as a batch.
//
// All paid calls share the DAILY_BUDGET_USD cap (rolling 24h).
//
//   pnpm ingest:daily [--expert slug] [--skip-x] [--skip-feeds] [--skip-podcasts] [--skip-process]

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDatabase, getDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { revalidateLive } from "@/lib/http/revalidate";
import { HttpError } from "@/lib/http/retry";
import { resolveXUser, searchXQuery } from "@/lib/sources/x";
import { buildCascadeXQuery } from "@/lib/sources/x-query";
import { collectFeed } from "@/lib/sources/feed";
import { episodeRecord, fetchPodcastEpisodes, transcribeEpisode } from "@/lib/sources/podcast";
import { createBudgetGuard, recordSpend, transcriptionCostUsd, xReadCostUsd, type BudgetGuard } from "@/lib/pipeline/spend";
import { storeSourceRecords } from "@/lib/pipeline/store";
import { collectVerificationBatches } from "@/lib/pipeline/verifyRunner";
import { processCascade } from "@/scripts/process-cascade";

// Same checkpoint row the earlier timeline poller used. The cursor column is
// still written for reference; polling windows are time-based.
const X_CURSOR_CHECKPOINT = "x_timeline";
const RECENT_WINDOW_MS = 7 * 86_400_000;
const FIRST_RUN_LOOKBACK_MS = 2 * 86_400_000;
const RESUME_OVERLAP_MS = 2 * 3_600_000;
const MAX_POSTS_PER_EXPERT = 100;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type ExpertRow = { id: string; slug: string; display_name: string; x_handle: string; source_status: string; cursor: string | null; last_success_at: Date | null };

async function pollX(guard: BudgetGuard, runId: string, onlyExpert?: string) {
  const summary = { experts: 0, posts: 0, newSources: 0, verified: 0, errors: 0, stoppedByBudget: false };
  if (!env.X_BEARER_TOKEN) {
    console.warn("X_BEARER_TOKEN not set: skipping X polling.");
    return summary;
  }
  const sql = getDatabase();
  const experts = await sql<ExpertRow[]>`
    select e.id, e.slug, e.display_name, e.x_handle, e.source_status, c.cursor, c.last_success_at
    from public.experts e
    left join public.ingestion_checkpoints c on c.expert_id = e.id and c.source_type = ${X_CURSOR_CHECKPOINT}
    where e.is_active and e.x_handle is not null and e.source_status in ('verified', 'unverified')
      and (${onlyExpert ?? null}::text is null or e.slug = ${onlyExpert ?? null} or lower(e.x_handle) = lower(${onlyExpert ?? ""}))
    order by c.last_success_at asc nulls first
  `;
  const now = Date.now();
  // Recent search must end at least a few seconds in the past.
  const end = new Date(now - 30_000);
  for (const expert of experts) {
    // Upper bound for this expert today; most experts post far fewer matches.
    if (!guard.canSpend(xReadCostUsd(10, 1))) {
      summary.stoppedByBudget = true;
      break;
    }
    try {
      if (expert.source_status === "unverified") {
        // One official lookup per unverified expert, ever: verified only when
        // X returns the exact handle (same rule as the verify-experts job).
        const user = await resolveXUser(expert.x_handle);
        const matches = user && user.username.toLowerCase() === expert.x_handle.toLowerCase();
        await recordSpend({ scope: "daily", runId, provider: "x", stage: "user_lookup", units: 1, unitKind: "request", costUsd: xReadCostUsd(0, 1) }, guard);
        if (!user || !matches) {
          await sql`update public.experts set source_status = 'unresolved', updated_at = now() where id = ${expert.id}`;
          throw new Error("X user not found or handle mismatch");
        }
        await sql`update public.experts set x_user_id = ${user.id}, x_handle = ${user.username}, avatar_url = coalesce(${user.profileImageUrl}, avatar_url), source_status = 'verified', updated_at = now() where id = ${expert.id}`;
        summary.verified += 1;
      }
      // Server-side filtered recent search: X only returns (and bills) posts
      // that contain forecast vocabulary, instead of every post on the
      // timeline. Recent search rejects since_id cursors (HTTP 400 for every
      // expert that had one), so the window is time-based: from shortly
      // before the last success, clamped to the 7-day recent window. Re-read
      // overlap is small and upserts dedupe it.
      const lastSuccess = expert.last_success_at ? new Date(expert.last_success_at).getTime() : 0;
      const start = new Date(Math.max(now - RECENT_WINDOW_MS + 60_000, lastSuccess ? lastSuccess - RESUME_OVERLAP_MS : now - FIRST_RUN_LOOKBACK_MS));
      const query = buildCascadeXQuery(expert.x_handle, { start, end, tier: "recall" });
      const result = await searchXQuery({
        query,
        handle: expert.x_handle,
        start,
        end,
        mode: "recent",
        maxPosts: MAX_POSTS_PER_EXPERT,
      });
      const cost = xReadCostUsd(result.postsRead, result.requests);
      await recordSpend({ scope: "daily", runId, provider: "x", stage: "recent_search", units: result.postsRead, unitKind: "post_read", costUsd: cost, metadata: { expert_id: expert.id } }, guard);
      summary.newSources += await storeSourceRecords(result.records, { expertId: expert.id, mode: "live", verificationLevel: "x_api" });
      summary.posts += result.postsRead;
      summary.experts += 1;
      await sql`
        insert into public.ingestion_checkpoints (expert_id, source_type, cursor, last_started_at, last_success_at, last_status, updated_at)
        values (${expert.id}, ${X_CURSOR_CHECKPOINT}, ${result.newestId}, now(), now(), 'succeeded', now())
        on conflict (expert_id, source_type) do update set cursor = coalesce(excluded.cursor, public.ingestion_checkpoints.cursor),
          last_started_at = now(), last_success_at = now(), last_status = 'succeeded', last_error = null, updated_at = now()
      `;
    } catch (error) {
      summary.errors += 1;
      const detail = error instanceof HttpError && error.body ? ` ${error.body}` : "";
      const message = `${error instanceof Error ? error.message : "unknown"}${detail}`;
      console.error(`X poll failed for @${expert.x_handle}: ${message}`);
      await sql`
        insert into public.ingestion_checkpoints (expert_id, source_type, last_started_at, last_status, last_error, updated_at)
        values (${expert.id}, ${X_CURSOR_CHECKPOINT}, now(), 'failed', ${message.slice(0, 300)}, now())
        on conflict (expert_id, source_type) do update set last_started_at = now(), last_status = 'failed', last_error = excluded.last_error, updated_at = now()
      `;
    }
  }
  return summary;
}

type ExpertSourceRow = { id: string; expert_id: string; kind: "feed" | "podcast"; url: string; expert_is_host: boolean; last_item_at: Date | null; display_name: string; x_handle: string | null };

async function loadSources(kind: "feed" | "podcast", onlyExpert?: string): Promise<ExpertSourceRow[]> {
  const sql = getDatabase();
  return sql<ExpertSourceRow[]>`
    select es.id, es.expert_id, es.kind, es.url, es.expert_is_host, es.last_item_at, e.display_name, e.x_handle
    from public.expert_sources es join public.experts e on e.id = es.expert_id
    where es.is_active and e.is_active and es.kind = ${kind}
      and (${onlyExpert ?? null}::text is null or e.slug = ${onlyExpert ?? null} or lower(e.x_handle) = lower(${onlyExpert ?? ""}))
  `;
}

async function pollFeeds(onlyExpert?: string) {
  const sql = getDatabase();
  const summary = { feeds: 0, newSources: 0, errors: 0 };
  for (const source of await loadSources("feed", onlyExpert)) {
    try {
      const since = source.last_item_at ? new Date(new Date(source.last_item_at).getTime() - 86_400_000) : new Date(Date.now() - 7 * 86_400_000);
      const result = await collectFeed({ feedUrl: source.url, expertName: source.display_name, expertHandle: source.x_handle, since, maxItems: 25 });
      summary.newSources += await storeSourceRecords(result.records, { expertId: source.expert_id, mode: "live" });
      const newest = result.records.reduce<Date | null>((max, record) => (!max || record.publishedAt > max ? record.publishedAt : max), null);
      await sql`update public.expert_sources set last_checked_at = now(), last_item_at = greatest(coalesce(last_item_at, ${newest}), coalesce(${newest}, last_item_at)) where id = ${source.id}`;
      summary.feeds += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(`Feed poll failed for ${source.url}:`, error instanceof Error ? error.message : "unknown");
    }
  }
  return summary;
}

async function pollPodcasts(guard: BudgetGuard, runId: string, onlyExpert?: string) {
  const sql = getDatabase();
  const summary = { shows: 0, episodes: 0, errors: 0, stoppedByBudget: false };
  if (!env.TRANSCRIBE_API_KEY) return summary;
  for (const source of await loadSources("podcast", onlyExpert)) {
    try {
      const since = source.last_item_at ? new Date(source.last_item_at) : new Date(Date.now() - 7 * 86_400_000);
      const episodes = (await fetchPodcastEpisodes(source.url)).filter((episode) => episode.publishedAt && episode.publishedAt > since).slice(0, 5);
      summary.shows += 1;
      for (const episode of episodes) {
        const [existing] = await sql<{ id: string }[]>`select id from public.sources where source_type = 'podcast' and external_id = ${episode.guid}`;
        if (existing) continue;
        if (!guard.canSpend(transcriptionCostUsd(episode.durationSeconds ?? 3600))) {
          summary.stoppedByBudget = true;
          return summary;
        }
        const transcript = await transcribeEpisode(episode.audioUrl);
        await recordSpend({ scope: "daily", runId, provider: new URL(env.TRANSCRIBE_BASE_URL).hostname, stage: "transcribe", units: transcript.audioSeconds, unitKind: "audio_seconds", costUsd: transcriptionCostUsd(transcript.audioSeconds), metadata: { expert_id: source.expert_id, guid: episode.guid } }, guard);
        const record = episodeRecord(episode, transcript, { expertHandle: source.x_handle, feedUrl: source.url, expertIsHost: source.expert_is_host });
        if (record) await storeSourceRecords([record], { expertId: source.expert_id, mode: "live" });
        await sql`update public.expert_sources set last_checked_at = now(), last_item_at = greatest(coalesce(last_item_at, ${episode.publishedAt}), ${episode.publishedAt}) where id = ${source.id}`;
        summary.episodes += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`Podcast poll failed for ${source.url}:`, error instanceof Error ? error.message : "unknown");
    }
  }
  return summary;
}

async function main() {
  const runId = randomUUID();
  const onlyExpert = arg("--expert")?.replace(/^@/, "");
  const startedAt = Date.now();

  const collected = await collectVerificationBatches({ scope: "daily" });
  console.log(JSON.stringify({ stage: "verify_collect_summary", ...collected }));
  if (collected.published > 0) await revalidateLive(["/", "/leaderboard"]);

  const guard = await createBudgetGuard("daily");
  console.log(JSON.stringify({ stage: "daily_start", run_id: runId, budget_cap_usd: guard.capUsd, already_spent_usd: Number(guard.spentUsd.toFixed(4)) }));
  const x = process.argv.includes("--skip-x") ? null : await pollX(guard, runId, onlyExpert);
  const feeds = process.argv.includes("--skip-feeds") ? null : await pollFeeds(onlyExpert);
  const podcasts = process.argv.includes("--skip-podcasts") ? null : await pollPodcasts(guard, runId, onlyExpert);
  console.log(JSON.stringify({ stage: "daily_collected", x, feeds, podcasts, spent_usd: Number(guard.spentUsd.toFixed(4)) }));

  if (!process.argv.includes("--skip-process")) await processCascade({ mode: "live" });
  console.log(JSON.stringify({ stage: "daily_done", run_id: runId, duration_s: Math.round((Date.now() - startedAt) / 1000) }));

  // A day where every expert errored is an outage, not a quiet day.
  if (x && x.experts === 0 && x.errors > 0) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(closeDatabase);
