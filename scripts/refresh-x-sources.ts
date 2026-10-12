import "dotenv/config";
import { createHash } from "node:crypto";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { lookupXPosts } from "@/lib/sources/x";
import { fullPostText, samePostText } from "@/lib/sources/x-parser";
import { recordSpend, xReadCostUsd } from "@/lib/pipeline/spend";

// Compliance refresh. Looks posts up 100 ids per request (instead of one
// request per post) and quarantines predictions whose only source was
// deleted or materially edited.
//
// Only sources behind a PUBLISHED prediction are re-checked (oldest check
// first): every read is billed, and screened-out or unpublished sources are
// never shown publicly. Each source is re-read at most once every 30 days,
// so the weekly job spreads the work; REFRESH_LIMIT caps reads per run.

type SourceRow = { id: string; external_id: string; exact_text: string | null };

async function quarantine(sourceId: string, reason: string) {
  const sql = getDatabase();
  const predictions = await sql<{ id: string }[]>`update public.predictions set status = 'source_unavailable', published_at = null where source_id = ${sourceId} and published_at is not null returning id`;
  for (const prediction of predictions) await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, reason) values ('prediction', ${prediction.id}, 'prediction_unpublished', 'system', ${reason})`;
}

export async function refreshXSources(limit = 1000): Promise<{ checked: number; updated: number; unavailable: number; errors: number }> {
  if (!env.X_BEARER_TOKEN) throw new Error("X_BEARER_TOKEN is not configured. Source compliance refresh was skipped.");
  const sql = getDatabase();
  const sources = await sql<SourceRow[]>`
    select s.id, s.external_id, s.exact_text from public.sources s
    where s.source_type = 'x' and s.external_id is not null and s.deleted_at is null
      and exists (select 1 from public.predictions p where p.source_id = s.id and p.published_at is not null)
      -- Each published source is re-read at most once a month.
      and (s.last_verified_at is null or s.last_verified_at < now() - interval '30 days')
    order by coalesce(s.last_verified_at, s.created_at) asc limit ${limit}
  `;
  let updated = 0; let unavailable = 0; let errors = 0;
  let lookup: Awaited<ReturnType<typeof lookupXPosts>>;
  try {
    lookup = await lookupXPosts(sources.map((source) => source.external_id));
  } catch (error) {
    console.error("X batch lookup failed:", error instanceof Error ? error.message : "unknown");
    return { checked: 0, updated: 0, unavailable: 0, errors: sources.length };
  }
  await recordSpend({ scope: "daily", provider: "x", stage: "compliance_refresh", units: lookup.postsRead, unitKind: "post_read", costUsd: xReadCostUsd(lookup.postsRead, lookup.requests) });
  const missing = new Set(lookup.missing);
  for (const source of sources) {
    try {
      const post = lookup.found.get(source.external_id);
      if (!post) {
        // Not returned and not explicitly reported missing: leave it for the
        // next run rather than guessing.
        if (!missing.has(source.external_id)) continue;
        await sql`update public.sources set deleted_at = now(), exact_text = null, last_verified_at = now() where id = ${source.id}`;
        await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, reason) values ('source', ${source.id}, 'source_deleted', 'system', 'Original platform reports the source unavailable.')`;
        await quarantine(source.id, "Only evidence source became unavailable.");
        unavailable += 1;
        continue;
      }
      const full = fullPostText(post);
      // Stored text may be the full long-form text or the truncated form, and
      // older code paths saved it with different formatting (entities,
      // collapsed line breaks, pic.twitter.com links, no reply @mentions).
      // Only a change in the words is an edit; the stored text is kept so
      // published quotes remain exact substrings of it.
      if (samePostText(source.exact_text, post)) {
        await sql`update public.sources set fetched_at = now(), last_verified_at = now() where id = ${source.id}`;
        continue;
      }
      const hash = createHash("sha256").update(full).digest("hex");
      await sql`update public.sources set exact_text = ${full}, content_hash = ${hash}, fetched_at = now(), last_verified_at = now() where id = ${source.id}`;
      await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, before, after, reason) values ('source', ${source.id}, 'source_updated', 'system', ${sql.json({ exact_text: source.exact_text })}, ${sql.json({ exact_text: full })}, 'X source content changed; linked predictions quarantined for review.')`;
      await quarantine(source.id, "Source content changed materially or requires review.");
      updated += 1;
    } catch (error) {
      errors += 1;
      console.error(`Source refresh failed for ${source.external_id}:`, error instanceof Error ? error.message : "unknown");
    }
  }
  return { checked: sources.length, updated, unavailable, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  refreshXSources(Number(process.env.REFRESH_LIMIT || 300)).then((result) => console.log(`Checked: ${result.checked}\nUpdated: ${result.updated}\nUnavailable: ${result.unavailable}\nErrors: ${result.errors}`)).finally(closeDatabase);
}
