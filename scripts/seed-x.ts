import "dotenv/config";
import pLimit from "p-limit";
import { createHash } from "node:crypto";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { searchX } from "@/lib/sources/x";

type Flags = { expert?: string; all: boolean; start: Date; end: Date; maxPosts: number; dryRun: boolean; mode: "full-archive" | "recent" };

function parseFlags(argv: string[]): Flags {
  const get = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const requestedMode = argv.includes("--recent") ? "recent" : argv.includes("--full-archive") ? "full-archive" : env.X_FULL_ARCHIVE_ENABLED === "true" ? "full-archive" : "recent";
  const end = new Date(get("--end") ?? env.SEED_END_DATE ?? new Date().toISOString());
  const defaultStart = requestedMode === "recent" ? new Date(end.getTime() - 6.5 * 86_400_000) : new Date(get("--start") ?? env.SEED_START_DATE);
  return { expert: get("--expert"), all: argv.includes("--all") || !get("--expert"), start: new Date(get("--start") ?? defaultStart), end, maxPosts: Math.min(2000, Number(get("--max-posts") ?? env.SEED_MAX_POSTS_PER_EXPERT)), dryRun: argv.includes("--dry-run"), mode: requestedMode };
}

export async function seedX(argv = process.argv.slice(2)): Promise<{ rawPosts: number; experts: number; errors: number }> {
  if (!env.X_BEARER_TOKEN) throw new Error("X_BEARER_TOKEN is not configured. X ingestion was skipped; no scraping fallback is used.");
  const flags = parseFlags(argv);
  const sql = getDatabase();
  const experts = flags.expert
    ? await sql<{ id: string; display_name: string; x_handle: string; source_status: string }[]>`select id, display_name, x_handle, source_status from public.experts where slug = ${flags.expert} or lower(x_handle) = lower(${flags.expert.replace(/^@/, "")})`
    : await sql<{ id: string; display_name: string; x_handle: string; source_status: string }[]>`select id, display_name, x_handle, source_status from public.experts where x_handle is not null and source_status = 'verified' order by display_name`;
  let rawPosts = 0; let errors = 0;
  const limit = pLimit(env.SEED_CONCURRENCY);
  await Promise.all(experts.map((expert) => limit(async () => {
    const [run] = await sql<{ id: string }[]>`insert into public.ingestion_runs (source_type, job_type, status, started_at, items_requested, metadata) values ('x', 'expert_seed', 'running', now(), ${flags.maxPosts}, ${sql.json({ expert_id: expert.id, requested_mode: flags.mode, dry_run: flags.dryRun })}) returning id`;
    try {
      const result = await searchX({ handle: expert.x_handle, start: flags.start, end: flags.end, maxPosts: flags.maxPosts, mode: flags.mode });
      const unique = [...new Map(result.records.map((record) => [record.externalId, record])).values()];
      if (!flags.dryRun) for (const record of unique) {
        const hash = createHash("sha256").update(record.exactText ?? "").digest("hex");
        await sql`
          insert into public.sources (source_type, external_id, canonical_path, author_external_id, author_handle, published_at, exact_text, content_hash, metadata, fetched_at, last_verified_at)
          values ('x', ${record.externalId ?? null}, ${record.canonicalPath ?? null}, ${record.authorExternalId ?? null}, ${record.authorHandle ?? null}, ${record.publishedAt}, ${record.exactText ?? null}, ${hash}, ${sql.json(record.metadata as never)}, now(), now())
          on conflict (source_type, external_id) where external_id is not null do update set canonical_path = excluded.canonical_path,
            author_external_id = excluded.author_external_id, author_handle = excluded.author_handle, published_at = excluded.published_at,
            exact_text = excluded.exact_text, content_hash = excluded.content_hash, metadata = excluded.metadata, fetched_at = now(), last_verified_at = now(), deleted_at = null
        `;
      }
      rawPosts += unique.length;
      await sql`update public.ingestion_runs set status = ${result.fellBackFromFullArchive ? "limited" : "succeeded"}, finished_at = now(), items_fetched = ${unique.length}, items_created = ${flags.dryRun ? 0 : unique.length}, metadata = ${sql.json({ expert_id: expert.id, mode_used: result.modeUsed, fell_back_from_full_archive: result.fellBackFromFullArchive, dry_run: flags.dryRun })} where id = ${run.id}`;
    } catch (error) {
      errors += 1;
      await sql`update public.ingestion_runs set status = 'failed', finished_at = now(), errors = 1, metadata = ${sql.json({ expert_id: expert.id, error: error instanceof Error ? error.message : "unknown" })} where id = ${run.id}`;
      console.error(`X ingestion failed for ${expert.display_name}:`, error instanceof Error ? error.message : "unknown");
    }
  })));
  return { rawPosts, experts: experts.length, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedX().then((result) => console.log(`Raw X posts: ${result.rawPosts}\nExperts searched: ${result.experts}\nErrors: ${result.errors}`)).finally(closeDatabase);
}
