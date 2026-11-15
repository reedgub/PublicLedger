import "dotenv/config";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { markSourceEdited, markSourceUnavailable, quarantinePredictions } from "@/lib/predictions/quarantine";
import { checkPodcastAudio, checkWebSource, checkXPostViaOembed, MAX_REFRESH_STRIKES, type LiveCheck } from "@/lib/sources/liveCheck";
import { lookupXPosts } from "@/lib/sources/x";
import { fullPostText, samePostText } from "@/lib/sources/x-parser";
import { recordSpend, xReadCostUsd } from "@/lib/pipeline/spend";

// Compliance refresh for EVERY source behind a visible prediction.
//
//   - X: the official API (100 ids per request) when X_BEARER_TOKEN is set,
//     which also detects edits; otherwise the free oEmbed endpoint, which
//     detects deletion. Never scraped.
//   - Web, writing, Substack, manual: the page is re-fetched (robots.txt
//     respected) and every published quote must still be on it.
//   - Podcasts: the episode audio must still exist.
//
// Gone originals are quarantined and their stored text dropped; a missing
// quote quarantines that prediction; MAX_REFRESH_STRIKES inconclusive checks
// in a row make the source unverifiable. Each source is re-checked at most
// every 30 days; REFRESH_LIMIT caps sources per run.

type SourceRow = {
  id: string;
  source_type: string;
  external_id: string | null;
  canonical_path: string | null;
  author_handle: string | null;
  exact_text: string | null;
  metadata: Record<string, unknown>;
};
type Visible = { id: string; source_quote: string };

export type RefreshSummary = { checked: number; verified: number; edited: number; unavailable: number; quotesMissing: number; inconclusive: number; quarantined: number; errors: number };

async function visiblePredictions(sourceId: string): Promise<Visible[]> {
  const sql = getDatabase();
  return sql<Visible[]>`select id, source_quote from public.predictions where source_id = ${sourceId} and published_at is not null and status <> 'source_unavailable'`;
}

async function markVerified(sourceId: string) {
  const sql = getDatabase();
  await sql`update public.sources set last_verified_at = now(), metadata = (metadata - 'refresh_strikes') - 'refresh_last_error' where id = ${sourceId}`;
}

/** Apply a live-check outcome. Returns how many predictions were quarantined. */
async function applyCheck(source: SourceRow, check: LiveCheck, summary: RefreshSummary): Promise<void> {
  const sql = getDatabase();
  if (check.state === "verified") {
    await markVerified(source.id);
    summary.verified += 1;
    return;
  }
  if (check.state === "gone") {
    summary.quarantined += (await markSourceUnavailable(sql, source.id, `Original source unavailable: ${check.detail}.`)).length;
    summary.unavailable += 1;
    return;
  }
  if (check.state === "quote_missing") {
    const missing = new Set(check.missing);
    const affected = (await visiblePredictions(source.id)).filter((prediction) => missing.has(prediction.source_quote)).map((prediction) => prediction.id);
    const quarantined = await sql.begin((tx) => quarantinePredictions(tx, { predictionIds: affected }, "The quoted words no longer appear in the original source."));
    await sql`update public.sources set last_verified_at = now() where id = ${source.id}`;
    summary.quarantined += quarantined.length;
    summary.quotesMissing += 1;
    return;
  }
  const strikes = Number(source.metadata.refresh_strikes ?? 0) + 1;
  summary.inconclusive += 1;
  if (strikes >= MAX_REFRESH_STRIKES) {
    summary.quarantined += (await markSourceUnavailable(sql, source.id, `Original source could not be verified on ${strikes} consecutive checks (last: ${check.detail}).`)).length;
    summary.unavailable += 1;
    return;
  }
  await sql`update public.sources set last_verified_at = now(), metadata = metadata || ${sql.json({ refresh_strikes: strikes, refresh_last_error: check.detail } as never)} where id = ${source.id}`;
}

async function refreshXViaApi(sources: SourceRow[], summary: RefreshSummary) {
  const sql = getDatabase();
  let lookup: Awaited<ReturnType<typeof lookupXPosts>>;
  try {
    lookup = await lookupXPosts(sources.map((source) => source.external_id!));
  } catch (error) {
    console.error("X batch lookup failed:", error instanceof Error ? error.message : "unknown");
    summary.errors += sources.length;
    return;
  }
  await recordSpend({ scope: "daily", provider: "x", stage: "compliance_refresh", units: lookup.postsRead, unitKind: "post_read", costUsd: xReadCostUsd(lookup.postsRead, lookup.requests) });
  const missing = new Set(lookup.missing);
  for (const source of sources) {
    try {
      const post = lookup.found.get(source.external_id!);
      if (!post) {
        // Neither returned nor reported missing: an inconclusive check.
        await applyCheck(source, missing.has(source.external_id!) ? { state: "gone", detail: "X reports the post is unavailable" } : { state: "unreachable", detail: "not returned by X lookup" }, summary);
        continue;
      }
      // Only a change in the words is an edit (stored text may differ in
      // rendering: entities, line breaks, t.co vs pic.twitter.com links).
      if (samePostText(source.exact_text, post)) {
        await applyCheck(source, { state: "verified" }, summary);
        continue;
      }
      summary.quarantined += (await markSourceEdited(sql, source.id, fullPostText(post), "X source content changed; linked predictions quarantined.")).length;
      summary.edited += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(`Source refresh failed for ${source.external_id}:`, error instanceof Error ? error.message : "unknown");
    }
  }
}

function xHandle(source: SourceRow): string {
  return source.author_handle ?? source.canonical_path?.split("/").filter(Boolean)[0] ?? "";
}

export async function refreshSources(limit = 300): Promise<RefreshSummary> {
  const sql = getDatabase();
  const summary: RefreshSummary = { checked: 0, verified: 0, edited: 0, unavailable: 0, quotesMissing: 0, inconclusive: 0, quarantined: 0, errors: 0 };
  const sources = await sql<SourceRow[]>`
    select s.id, s.source_type, s.external_id, s.canonical_path, s.author_handle, s.exact_text, s.metadata
    from public.sources s
    where s.deleted_at is null
      and exists (select 1 from public.predictions p where p.source_id = s.id and p.published_at is not null and p.status <> 'source_unavailable')
      and (s.last_verified_at is null or s.last_verified_at < now() - interval '30 days')
    order by coalesce(s.last_verified_at, s.created_at) asc limit ${limit}
  `;
  summary.checked = sources.length;
  const xSources = sources.filter((source) => source.source_type === "x" && source.external_id);
  if (env.X_BEARER_TOKEN && xSources.length) await refreshXViaApi(xSources, summary);
  for (const source of sources) {
    if (env.X_BEARER_TOKEN && xSources.includes(source)) continue;
    try {
      let check: LiveCheck;
      if (source.source_type === "x") {
        check = source.external_id ? await checkXPostViaOembed(xHandle(source), source.external_id) : { state: "gone", detail: "no post id" };
      } else if (source.source_type === "podcast") {
        check = await checkPodcastAudio(typeof source.metadata.audioUrl === "string" ? source.metadata.audioUrl : null);
      } else {
        const quotes = (await visiblePredictions(source.id)).map((prediction) => prediction.source_quote);
        check = await checkWebSource(source.canonical_path ?? "", quotes);
      }
      await applyCheck(source, check, summary);
    } catch (error) {
      summary.errors += 1;
      console.error(`Source refresh failed for ${source.id}:`, error instanceof Error ? error.message : "unknown");
    }
  }
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  refreshSources(Number(process.env.REFRESH_LIMIT || 300))
    .then((result) => {
      console.log(JSON.stringify({ stage: "source_refresh_summary", ...result }));
      if (result.errors > 0) process.exitCode = 1;
    })
    .finally(closeDatabase);
}
