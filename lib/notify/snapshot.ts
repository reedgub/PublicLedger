import { getDatabase } from "@/lib/db/postgres";
import type { SiteSnapshot } from "@/lib/notify/slack";

/** Spend recorded since a moment, e.g. the start of this run (runs never overlap). */
export async function spendSinceUsd(since: Date, scope: string): Promise<number> {
  const sql = getDatabase();
  const [row] = await sql<{ usd: number }[]>`
    select coalesce(sum(cost_usd), 0)::float8 as usd from public.pipeline_spend where created_at >= ${since} and scope = ${scope}
  `;
  return row?.usd ?? 0;
}

/** What a run report needs from the database: what went live recently, totals and spend. */
export async function loadSiteSnapshot(listLimit = 8): Promise<SiteSnapshot> {
  const sql = getDatabase();
  const recent = await sql<{ id: string; display_name: string; normalized_claim: string; resolution_date: string | null }[]>`
    select p.id, e.display_name, p.normalized_claim, p.resolution_date::text
    from public.predictions p join public.experts e on e.id = p.expert_id
    where p.published_at > now() - interval '24 hours' and p.status <> 'source_unavailable'
    order by p.published_at desc limit ${listLimit}
  `;
  const [counts] = await sql<{ recent: number; total: number }[]>`
    select count(*) filter (where published_at > now() - interval '24 hours')::int as recent, count(*)::int as total
    from public.predictions where published_at is not null and status <> 'source_unavailable'
  `;
  const [spend] = await sql<{ day_usd: number; week_usd: number }[]>`
    select coalesce(sum(cost_usd) filter (where created_at > now() - interval '24 hours'), 0)::float8 as day_usd,
      coalesce(sum(cost_usd), 0)::float8 as week_usd
    from public.pipeline_spend where created_at > now() - interval '7 days'
  `;
  return {
    newlyPublished: recent.map((row) => ({ id: row.id, expertName: row.display_name, claim: row.normalized_claim, resolutionDate: row.resolution_date })),
    newlyPublishedCount: counts?.recent ?? 0,
    totalPublished: counts?.total ?? 0,
    spendTodayUsd: spend?.day_usd ?? 0,
    spend7dUsd: spend?.week_usd ?? 0,
  };
}
