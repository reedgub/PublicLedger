// Where the money went: spend by scope, provider and stage, plus cost per
// published prediction and backfill coverage.
//
//   pnpm spend [--days 30]
import "dotenv/config";
import { closeDatabase, getDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";

async function main() {
  const index = process.argv.indexOf("--days");
  const days = index >= 0 ? Number(process.argv[index + 1]) : 30;
  const since = new Date(Date.now() - days * 86_400_000);
  const sql = getDatabase();
  const byStage = await sql<{ scope: string; provider: string; stage: string; units: string; unit_kind: string; usd: string }[]>`
    select scope, provider, stage, sum(units)::bigint::text as units, unit_kind, round(sum(cost_usd)::numeric, 4)::text as usd
    from public.pipeline_spend where created_at >= ${since}
    group by scope, provider, stage, unit_kind order by sum(cost_usd) desc
  `;
  const [totals] = await sql<{ usd: string | null; published: string; backfilled: string }[]>`
    select (select round(sum(cost_usd)::numeric, 4)::text from public.pipeline_spend where created_at >= ${since}) as usd,
      (select count(*)::text from public.predictions where published_at >= ${since}) as published,
      (select count(*)::text from public.predictions where published_at >= ${since} and capture_mode = 'backfill') as backfilled
  `;
  const coverage = await sql<{ status: string; periods: string }[]>`
    select status, count(*)::text as periods from public.ingestion_coverage where mode = 'backfill' group by status order by status
  `;
  const inflight = await sql<{ batches: string; candidates: string }[]>`
    select count(*)::text as batches, coalesce(sum(item_count), 0)::text as candidates from public.verification_batches where status = 'submitted'
  `;
  const usd = Number(totals?.usd ?? 0);
  const published = Number(totals?.published ?? 0);
  console.log(`Spend over the last ${days} days: $${usd.toFixed(2)}  (daily cap $${env.DAILY_BUDGET_USD}, backfill lifetime cap $${env.BACKFILL_BUDGET_USD})`);
  console.log(`Published predictions: ${published} (${totals?.backfilled ?? 0} backfilled) — $${published ? (usd / published).toFixed(3) : "n/a"} per published prediction`);
  console.table(byStage);
  console.log("Backfill coverage (months):");
  console.table(coverage);
  console.log(`Verification batches in flight: ${inflight[0]?.batches ?? 0} (${inflight[0]?.candidates ?? 0} candidates)`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(closeDatabase);
