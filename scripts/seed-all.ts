import "dotenv/config";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { CATEGORIES } from "@/lib/constants";
import { seedExperts } from "@/scripts/seed-experts";
import { seedPolymarket } from "@/scripts/seed-polymarket";
import { seedX } from "@/scripts/seed-x";
import { processSources, type ProcessingSummary } from "@/scripts/process-sources";
import { resolveDue } from "@/scripts/resolve-due";

async function seedCategories() {
  const sql = getDatabase();
  for (const [index, category] of CATEGORIES.entries()) await sql`
    insert into public.categories (slug, name, sort_order) values (${category.slug}, ${category.name}, ${(index + 1) * 10})
    on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order
  `;
}

async function finalCounts() {
  const sql = getDatabase();
  const [row] = await sql<Record<string, number>[]>`
    select
      (select count(*) from public.prediction_candidates)::integer as candidates,
      (select count(*) from public.prediction_candidates where status = 'duplicate')::integer as duplicates,
      (select count(*) from public.predictions where published_at is not null)::integer as published,
      (select count(*) from public.predictions where published_at is not null and status in ('open','due','resolution_pending'))::integer as open,
      (select count(*) from public.resolutions where approved_at is not null)::integer as resolved,
      (select count(*) from public.resolutions where approved_at is not null and outcome = 'ambiguous')::integer as ambiguous
  `;
  return row;
}

async function main() {
  let errors = 0;
  await seedCategories();
  const experts = await seedExperts();
  let polymarket = { markets: 0, active: 0, closed: 0, topics: 0 };
  try { polymarket = await seedPolymarket(); } catch (error) { errors += 1; console.error("Polymarket seed failed:", error instanceof Error ? error.message : "unknown"); }
  let x = { rawPosts: 0, experts: 0, errors: 0 };
  if (env.X_BEARER_TOKEN) {
    try { x = await seedX([env.X_FULL_ARCHIVE_ENABLED === "true" ? "--full-archive" : "--recent", "--all"]); errors += x.errors; }
    catch (error) { errors += 1; console.error("X seed failed:", error instanceof Error ? error.message : "unknown"); }
  } else console.log("X ingestion skipped: X_BEARER_TOKEN is not configured.");
  let processing: ProcessingSummary = { examined: 0, rejectedByHeuristic: 0, droppedByScreen: 0, candidates: 0, candidatesRejected: 0, duplicates: 0, published: 0, verifierRejected: 0, deferredByBudget: 0, costUsd: 0, errors: 0 };
  if (env.OPENAI_API_KEY || env.OPEN_MODEL_API_KEY) {
    try { processing = await processSources(); errors += processing.errors; }
    catch (error) { errors += 1; console.error("Prediction processing failed:", error instanceof Error ? error.message : "unknown"); }
  } else console.log("AI extraction skipped: OPENAI_API_KEY is not configured.");
  let resolution = { due: 0, proposed: 0, approved: 0, errors: 0, skipped: true };
  try { resolution = await resolveDue(); errors += resolution.errors; } catch (error) { errors += 1; console.error("Resolution seed failed:", error instanceof Error ? error.message : "unknown"); }
  const counts = await finalCounts();
  console.log([
    `Experts seeded: ${experts.seeded}`, `Experts X-verified: ${experts.verified}`,
    `Polymarket events: ${polymarket.topics}`, `Markets: ${polymarket.markets}`,
    `Raw X posts: ${x.rawPosts}`, `Candidates: ${counts.candidates}`,
    `Rejected by heuristic: ${processing.rejectedByHeuristic}`, `Candidates for verification: ${processing.candidates}`,
    `Verifier rejected: ${processing.verifierRejected}`, `Published predictions: ${counts.published}`,
    `Open: ${counts.open}`, `Resolved: ${counts.resolved}`, `Ambiguous: ${counts.ambiguous}`,
    `Duplicates: ${counts.duplicates}`, `Errors: ${errors}`,
  ].join("\n"));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(closeDatabase);
