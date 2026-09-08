import "dotenv/config";
import pLimit from "p-limit";
import { createHash } from "node:crypto";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http/retry";
import { fetchXPostById } from "@/lib/sources/x";

export async function refreshXSources(): Promise<{ checked: number; updated: number; unavailable: number; errors: number }> {
  if (!env.X_BEARER_TOKEN) throw new Error("X_BEARER_TOKEN is not configured. Source compliance refresh was skipped.");
  const sql = getDatabase();
  const sources = await sql<{ id: string; external_id: string; author_handle: string | null; exact_text: string | null }[]>`select id, external_id, author_handle, exact_text from public.sources where source_type = 'x' and external_id is not null and deleted_at is null order by coalesce(last_verified_at, created_at) asc limit 1000`;
  let updated = 0; let unavailable = 0; let errors = 0;
  const limit = pLimit(env.SEED_CONCURRENCY);
  await Promise.all(sources.map((source) => limit(async () => {
    try {
      const current = await fetchXPostById(source.external_id, source.author_handle ?? undefined);
      if (!current?.exactText) throw new HttpError("X source unavailable", 404, new Headers());
      if (current.exactText !== source.exact_text) {
        const hash = createHash("sha256").update(current.exactText).digest("hex");
        await sql`update public.sources set exact_text = ${current.exactText}, content_hash = ${hash}, metadata = ${sql.json(current.metadata as never)}, fetched_at = now(), last_verified_at = now() where id = ${source.id}`;
        const predictions = await sql<{ id: string }[]>`update public.predictions set status = 'source_unavailable', published_at = null where source_id = ${source.id} and published_at is not null returning id`;
        await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, before, after, reason) values ('source', ${source.id}, 'source_updated', 'system', ${sql.json({ exact_text: source.exact_text })}, ${sql.json({ exact_text: current.exactText })}, 'X source content changed; linked predictions quarantined for review.')`;
        for (const prediction of predictions) await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, reason) values ('prediction', ${prediction.id}, 'prediction_unpublished', 'system', 'Source content changed materially or requires review.')`;
        updated += 1;
      } else await sql`update public.sources set fetched_at = now(), last_verified_at = now() where id = ${source.id}`;
    } catch (error) {
      if (error instanceof HttpError && [404, 410].includes(error.status)) {
        await sql`update public.sources set deleted_at = now(), exact_text = null, last_verified_at = now() where id = ${source.id}`;
        const predictions = await sql<{ id: string }[]>`update public.predictions set status = 'source_unavailable', published_at = null where source_id = ${source.id} and published_at is not null returning id`;
        await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, reason) values ('source', ${source.id}, 'source_deleted', 'system', 'Original platform reports the source unavailable.')`;
        for (const prediction of predictions) await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, reason) values ('prediction', ${prediction.id}, 'prediction_unpublished', 'system', 'Only evidence source became unavailable.')`;
        unavailable += 1;
      } else { errors += 1; console.error(`Source refresh failed for ${source.external_id}:`, error instanceof Error ? error.message : "unknown"); }
    }
  })));
  return { checked: sources.length, updated, unavailable, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  refreshXSources().then((result) => console.log(`Checked: ${result.checked}\nUpdated: ${result.updated}\nUnavailable: ${result.unavailable}\nErrors: ${result.errors}`)).finally(closeDatabase);
}
