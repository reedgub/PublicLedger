// Grow the roster from evidence, with a human approving every addition.
//
//   pnpm discover:experts                      # mine @mentions from stored posts (free)
//   pnpm discover:experts --wikidata           # + notable economists/investors/analysts with X handles (free)
//   pnpm discover:experts --score --top 50     # + prediction density via X counts (no post reads)
//   pnpm discover:experts --approve someone --slug some-one --category economy-rates [--name "Some One"]
//   pnpm discover:experts --reject someone
//
// Density = forecast-vocabulary posts / all original posts over 90 days,
// both from the counts endpoint, so ranking costs no billed post reads.

import "dotenv/config";
import { closeDatabase, getDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { CATEGORY_SLUGS } from "@/lib/constants";
import { buildCascadeXQuery } from "@/lib/sources/x-query";
import { countXQuery, resolveXUser } from "@/lib/sources/x";
import { extractMentions } from "@/lib/pipeline/discovery";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function mineMentions(days: number) {
  const sql = getDatabase();
  const existing = new Set((await sql<{ handle: string }[]>`select lower(x_handle) as handle from public.experts where x_handle is not null`).map((row) => row.handle));
  const rows = await sql<{ expert_id: string; exact_text: string }[]>`
    select coalesce(s.expert_id, e.id) as expert_id, s.exact_text
    from public.sources s left join public.experts e on lower(e.x_handle) = lower(s.author_handle)
    where s.source_type = 'x' and s.exact_text is not null and s.published_at >= now() - make_interval(days => ${days})
  `;
  const counts = new Map<string, { mentions: number; experts: Set<string> }>();
  for (const row of rows) {
    for (const handle of extractMentions(row.exact_text)) {
      if (existing.has(handle)) continue;
      const entry = counts.get(handle) ?? { mentions: 0, experts: new Set<string>() };
      entry.mentions += 1;
      if (row.expert_id) entry.experts.add(row.expert_id);
      counts.set(handle, entry);
    }
  }
  // Require mentions from at least two different experts to filter noise.
  const candidates = [...counts.entries()].filter(([, value]) => value.experts.size >= 2);
  for (const [handle, value] of candidates) {
    await sql`
      insert into public.expert_suggestions (x_handle, discovered_via, mention_count, mentioned_by_experts)
      values (${handle}, 'mention_graph', ${value.mentions}, ${value.experts.size})
      on conflict (lower(x_handle)) do update set mention_count = excluded.mention_count,
        mentioned_by_experts = excluded.mentioned_by_experts, updated_at = now()
    `;
  }
  return candidates.length;
}

// Humans with an X username, in forecasting-heavy occupations, with enough
// Wikipedia sitelinks to count as public figures.
const WIKIDATA_QUERY = `
SELECT DISTINCT ?person ?personLabel ?handle ?links WHERE {
  # economist, investor, political scientist, banker, chief executive officer, entrepreneur, computer scientist
  VALUES ?occupation { wd:Q188094 wd:Q557880 wd:Q1238570 wd:Q806798 wd:Q484876 wd:Q131524 wd:Q82594 }
  ?person wdt:P106 ?occupation; wdt:P31 wd:Q5; wdt:P2002 ?handle; wikibase:sitelinks ?links.
  FILTER(?links >= 15)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?links)
LIMIT 500`;

async function mineWikidata() {
  const sql = getDatabase();
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(WIKIDATA_QUERY)}`;
  const response = await fetch(url, { headers: { "User-Agent": "PublicLedgerBot/0.2 (+https://publicledger.dev)", Accept: "application/sparql-results+json" } });
  if (!response.ok) throw new Error(`Wikidata ${response.status}`);
  const payload = await response.json() as { results: { bindings: Array<{ personLabel?: { value: string }; handle?: { value: string }; person?: { value: string }; links?: { value: string } }> } };
  const existing = new Set((await sql<{ handle: string }[]>`select lower(x_handle) as handle from public.experts where x_handle is not null`).map((row) => row.handle));
  let added = 0;
  for (const binding of payload.results.bindings) {
    const handle = binding.handle?.value;
    if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle) || existing.has(handle.toLowerCase())) continue;
    await sql`
      insert into public.expert_suggestions (x_handle, display_name, discovered_via, metadata)
      values (${handle}, ${binding.personLabel?.value ?? null}, 'wikidata', ${sql.json({ wikidata: binding.person?.value, sitelinks: Number(binding.links?.value ?? 0) })})
      on conflict (lower(x_handle)) do update set display_name = coalesce(public.expert_suggestions.display_name, excluded.display_name),
        metadata = public.expert_suggestions.metadata || excluded.metadata, updated_at = now()
    `;
    added += 1;
  }
  return added;
}

async function scoreSuggestions(top: number) {
  if (!env.X_BEARER_TOKEN) throw new Error("X_BEARER_TOKEN is required for --score.");
  const sql = getDatabase();
  const rows = await sql<{ id: string; x_handle: string }[]>`
    select id, x_handle from public.expert_suggestions where status = 'new' and prediction_density is null
    order by mentioned_by_experts desc, mention_count desc, coalesce((metadata->>'sitelinks')::int, 0) desc limit ${top}
  `;
  const end = new Date(Date.now() - 60_000);
  const start = new Date(end.getTime() - 90 * 86_400_000);
  for (const row of rows) {
    try {
      const forecast = await countXQuery({ query: buildCascadeXQuery(row.x_handle, { start, end }), start, end, mode: "full-archive" });
      const total = await countXQuery({ query: `from:${row.x_handle} -is:retweet -is:reply`, start, end, mode: "full-archive" });
      const density = total.total > 0 ? forecast.total / total.total : 0;
      await sql`update public.expert_suggestions set forecast_posts_90d = ${forecast.total}, total_posts_90d = ${total.total}, prediction_density = ${density}, updated_at = now() where id = ${row.id}`;
    } catch (error) {
      console.error(`Scoring @${row.x_handle} failed:`, error instanceof Error ? error.message : "unknown");
    }
  }
  return rows.length;
}

async function approve(handle: string) {
  const sql = getDatabase();
  const slug = arg("--slug");
  const category = arg("--category");
  if (!slug || !category || !(CATEGORY_SLUGS as readonly string[]).includes(category)) {
    throw new Error(`--approve needs --slug and --category (${CATEGORY_SLUGS.join(", ")}).`);
  }
  const user = env.X_BEARER_TOKEN ? await resolveXUser(handle) : null;
  const [suggestion] = await sql<{ display_name: string | null }[]>`select display_name from public.expert_suggestions where lower(x_handle) = lower(${handle})`;
  const name = arg("--name") ?? suggestion?.display_name ?? user?.name;
  if (!name) throw new Error("Provide --name (no display name known for this handle).");
  const verified = Boolean(user && user.username.toLowerCase() === handle.toLowerCase());
  const [expert] = await sql<{ id: string }[]>`
    insert into public.experts (slug, display_name, x_handle, x_user_id, avatar_url, headline, primary_category_slug, source_status)
    values (${slug}, ${name}, ${user?.username ?? handle}, ${verified ? user!.id : null}, ${user?.profileImageUrl ?? null}, ${arg("--headline") ?? null}, ${category}, ${verified ? "verified" : "unverified"})
    on conflict (slug) do nothing returning id
  `;
  if (!expert) throw new Error(`Slug "${slug}" already exists.`);
  await sql`insert into public.expert_categories (expert_id, category_slug) values (${expert.id}, ${category}) on conflict do nothing`;
  await sql`update public.expert_suggestions set status = 'approved', updated_at = now() where lower(x_handle) = lower(${handle})`;
  await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, reason) values ('expert', ${expert.id}, 'expert_added', 'admin', 'Approved from expert suggestions.')`;
  console.log(`Added ${name} (@${handle}) as ${slug}; X identity ${verified ? "verified" : "NOT verified — run the verify-experts job"}.`);
  console.log("Next: pnpm backfill --estimate --experts " + slug);
}

async function main() {
  const sql = getDatabase();
  const approveHandle = arg("--approve");
  if (approveHandle) return approve(approveHandle.replace(/^@/, ""));
  const rejectHandle = arg("--reject");
  if (rejectHandle) {
    await sql`update public.expert_suggestions set status = 'rejected', updated_at = now() where lower(x_handle) = lower(${rejectHandle.replace(/^@/, "")})`;
    return;
  }
  const mentions = await mineMentions(Number(arg("--days") ?? 180));
  const wikidata = process.argv.includes("--wikidata") ? await mineWikidata() : 0;
  const scored = process.argv.includes("--score") ? await scoreSuggestions(Number(arg("--top") ?? 50)) : 0;
  console.log(JSON.stringify({ stage: "discovery", mention_candidates: mentions, wikidata_candidates: wikidata, scored }));
  const top = await sql<{ x_handle: string; display_name: string | null; via: string; mentioned_by_experts: number; density: string | null; forecast_posts_90d: number | null }[]>`
    select x_handle, display_name, discovered_via as via, mentioned_by_experts, round(prediction_density::numeric, 3)::text as density, forecast_posts_90d
    from public.expert_suggestions where status = 'new'
    order by prediction_density desc nulls last, mentioned_by_experts desc, mention_count desc limit ${Number(arg("--top") ?? 30)}
  `;
  console.table(top);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(closeDatabase);
