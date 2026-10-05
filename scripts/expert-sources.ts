// Register the non-X sources an expert publishes on.
//
//   pnpm sources:add --expert larry-summers --kind feed --url https://example.substack.com/feed
//   pnpm sources:add --expert larry-summers --kind sitemap --url https://example.substack.com/sitemap.xml
//   pnpm sources:add --expert nate-silver --kind podcast --url https://feeds.example.com/show.xml --host
//   pnpm sources:list [--expert slug]
//   pnpm sources:disable --url <url>
//
// Only register sources the expert personally authors (their own blog,
// newsletter, or a show they host or regularly appear on). For podcasts,
// pass --host only when the expert is the host; otherwise every candidate
// from that show goes to human review because transcripts have no speaker
// labels.

import "dotenv/config";
import { closeDatabase, getDatabase } from "@/lib/db/postgres";
import { parseSafePublicUrl } from "@/lib/security/urls";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const command = process.argv[2];
  const sql = getDatabase();
  if (command === "add") {
    const expert = arg("--expert");
    const kind = arg("--kind");
    const url = arg("--url");
    if (!expert || !url || !["feed", "sitemap", "podcast"].includes(kind ?? "")) {
      throw new Error("Usage: pnpm sources:add --expert <slug> --kind feed|sitemap|podcast --url <url> [--host] [--notes text]");
    }
    const safe = parseSafePublicUrl(url).toString();
    const [row] = await sql<{ id: string }[]>`select id from public.experts where slug = ${expert} or lower(x_handle) = lower(${expert.replace(/^@/, "")})`;
    if (!row) throw new Error(`Expert "${expert}" not found.`);
    await sql`
      insert into public.expert_sources (expert_id, kind, url, expert_is_host, notes)
      values (${row.id}, ${kind!}, ${safe}, ${process.argv.includes("--host")}, ${arg("--notes") ?? null})
      on conflict (expert_id, url) do update set kind = excluded.kind, expert_is_host = excluded.expert_is_host, notes = coalesce(excluded.notes, public.expert_sources.notes), is_active = true
    `;
    console.log(`Registered ${kind} for ${expert}: ${safe}`);
    return;
  }
  if (command === "disable") {
    const url = arg("--url");
    if (!url) throw new Error("Usage: pnpm sources:disable --url <url>");
    const rows = await sql`update public.expert_sources set is_active = false where url = ${url} returning id`;
    console.log(`Disabled ${rows.length} source(s).`);
    return;
  }
  if (command === "list") {
    const expert = arg("--expert");
    const rows = await sql<{ slug: string; kind: string; url: string; expert_is_host: boolean; is_active: boolean; last_item_at: string | null }[]>`
      select e.slug, es.kind, es.url, es.expert_is_host, es.is_active, es.last_item_at::text
      from public.expert_sources es join public.experts e on e.id = es.expert_id
      where (${expert ?? null}::text is null or e.slug = ${expert ?? null})
      order by e.slug, es.kind
    `;
    console.table(rows);
    return;
  }
  throw new Error("Commands: add, list, disable");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(closeDatabase);
