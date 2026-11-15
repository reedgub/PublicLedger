// Substack pull for one publication. Usage:
//   pnpm tsx scripts/seed-substack.ts \
//     --feed https://noahsmith.substack.com/feed \
//     --handle noahpinion \
//     --since 2024-01-01 \
//     --max 20
//
// This inserts one source row per article (source_type='substack'). The
// existing extraction pipeline (`pnpm tsx scripts/process-sources.ts`)
// currently only reads source_type='x' — a follow-up wires it to
// substack. Until then this script lets you populate real Substack sources
// so the pipeline plumbing can be tested against real HTML.

import "dotenv/config";
import { createHash } from "node:crypto";
import { closeDatabase, getDatabase } from "@/lib/db/postgres";
import { substackAdapter } from "@/lib/sources/substack";

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const feed = arg("--feed");
  const handle = arg("--handle");
  const since = arg("--since");
  const max = arg("--max");
  if (!feed || !handle) {
    console.error("Usage: pnpm tsx scripts/seed-substack.ts --feed <rss-url> --handle <expert-handle> [--since YYYY-MM-DD] [--max N]");
    process.exit(1);
  }
  const records = await substackAdapter.fetch({
    feedUrl: feed,
    authorHandle: handle,
    since: since ? new Date(since) : undefined,
    maxItems: max ? Number(max) : undefined,
  });
  const sql = getDatabase();
  let inserted = 0;
  for (const record of records) {
    const contentHash = createHash("sha256").update(record.exactText ?? "").digest("hex");
    await sql`
      insert into public.sources (source_type, external_id, canonical_path, author_handle, published_at,
        exact_text, content_hash, metadata, fetched_at, last_verified_at)
      values (${record.sourceType}, ${record.externalId ?? null}, ${record.canonicalPath ?? null}, ${record.authorHandle ?? null},
        ${record.publishedAt.toISOString()}, ${record.exactText ?? null}, ${contentHash},
        ${sql.json(record.metadata as never)}, now(), now())
      on conflict (source_type, external_id) where external_id is not null do update set
        exact_text = case when exists (select 1 from public.predictions p where p.source_id = public.sources.id) then public.sources.exact_text else excluded.exact_text end,
        content_hash = case when exists (select 1 from public.predictions p where p.source_id = public.sources.id) then public.sources.content_hash else excluded.content_hash end,
        metadata = public.sources.metadata || excluded.metadata, last_verified_at = now()
      where public.sources.deleted_at is null
    `;
    inserted += 1;
  }
  console.log(`Substack items fetched: ${records.length}\nSources upserted: ${inserted}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(closeDatabase);
