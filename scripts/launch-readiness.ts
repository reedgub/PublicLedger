import "dotenv/config";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";

type Check = { level: "PASS" | "WARN" | "FAIL"; label: string; value: number; target?: number };

export async function launchReadiness(): Promise<Check[]> {
  const sql = getDatabase();
  const [counts] = await sql<Record<string, number>[]>`
    select
      (select count(*) from public.experts)::integer as experts,
      (select count(*) from public.predictions where published_at is not null)::integer as published,
      (select count(*) from public.resolutions where approved_at is not null)::integer as resolved,
      (select count(distinct category_slug) from public.predictions where published_at is not null)::integer as categories,
      (select count(*) from public.topics where status = 'active')::integer as topics,
      (select count(*) from public.markets)::integer as markets,
      (select count(*) from public.predictions p left join public.sources s on s.id = p.source_id where p.published_at is not null and s.id is null)::integer as missing_source,
      (select count(*) from public.resolutions r where r.approved_at is not null and r.scoring_eligible and not exists (select 1 from public.resolution_evidence e where e.resolution_id = r.id))::integer as missing_evidence,
      (select count(*) from public.predictions where explicit_probability is not null and source_quote !~ '[0-9]')::integer as probability_without_numeric_source
  `;
  const goals: Array<[string, number, number]> = [["Experts", counts.experts, 50], ["Published predictions", counts.published, 300], ["Resolved predictions", counts.resolved, 75], ["Categories represented", counts.categories, 8], ["Active topics", counts.topics, 100], ["Markets", counts.markets, 200]];
  const quality: Array<[string, number]> = [["Published predictions missing source", counts.missing_source], ["Scoring resolutions missing evidence", counts.missing_evidence], ["Numeric probabilities without numeric source quote", counts.probability_without_numeric_source]];
  return [...goals.map(([label, value, target]): Check => ({ level: value >= target ? "PASS" : "WARN", label, value, target })), ...quality.map(([label, value]): Check => ({ level: value === 0 ? "PASS" : "FAIL", label, value }))];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  launchReadiness().then((checks) => {
    for (const check of checks) console.log(`${check.level.padEnd(4)} ${check.label}: ${check.value}${check.target ? ` / ${check.target}` : ""}`);
    if (checks.some((check) => check.level === "FAIL")) process.exitCode = 1;
  }).finally(closeDatabase);
}
