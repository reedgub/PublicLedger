// Source persistence for the cascade. Every collector (X timeline, X archive
// search, feeds, sitemaps, podcasts) writes through here so provenance
// (expert, live vs backfill, first-seen time) is recorded consistently.

import { createHash } from "node:crypto";
import { getDatabase } from "@/lib/db/postgres";
import type { SourceRecord } from "@/lib/sources/types";

export type StoreOptions = {
  expertId: string;
  mode: "live" | "backfill";
  verificationLevel?: "x_api" | null;
};

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Upsert sources. Returns the number of NEW rows. Re-fetching an existing
 * source refreshes its text and verification time; a changed text resets
 * screening so the new content is processed. discovered_at and a live
 * ingestion_mode are protected by a database trigger.
 */
export async function storeSourceRecords(records: SourceRecord[], options: StoreOptions): Promise<number> {
  if (records.length === 0) return 0;
  const sql = getDatabase();
  let created = 0;
  for (const record of records) {
    if (!record.exactText) continue;
    const hash = contentHash(record.exactText);
    const [row] = await sql<{ inserted: boolean }[]>`
      insert into public.sources (source_type, external_id, canonical_path, author_external_id, author_handle, published_at,
        exact_text, content_hash, metadata, fetched_at, last_verified_at, expert_id, ingestion_mode, source_verification_level)
      values (${record.sourceType}, ${record.externalId ?? null}, ${record.canonicalPath ?? null}, ${record.authorExternalId ?? null},
        ${record.authorHandle ?? null}, ${record.publishedAt}, ${record.exactText}, ${hash}, ${sql.json(record.metadata as never)},
        now(), now(), ${options.expertId}, ${options.mode}, ${options.verificationLevel ?? null})
      on conflict (source_type, external_id) where external_id is not null do update set
        canonical_path = excluded.canonical_path,
        -- Text under an existing prediction is never silently replaced; the
        -- compliance refresh owns that path (it quarantines and audits).
        exact_text = case when exists (select 1 from public.predictions p where p.source_id = public.sources.id) then public.sources.exact_text else excluded.exact_text end,
        content_hash = case when exists (select 1 from public.predictions p where p.source_id = public.sources.id) then public.sources.content_hash else excluded.content_hash end,
        metadata = public.sources.metadata || excluded.metadata,
        expert_id = coalesce(public.sources.expert_id, excluded.expert_id),
        fetched_at = now(),
        last_verified_at = now(),
        screen_status = case
          when exists (select 1 from public.predictions p where p.source_id = public.sources.id) then public.sources.screen_status
          when public.sources.content_hash is distinct from excluded.content_hash then 'pending'
          else public.sources.screen_status end
      where public.sources.deleted_at is null
      returning (xmax = 0) as inserted
    `;
    if (row?.inserted) created += 1;
  }
  return created;
}
