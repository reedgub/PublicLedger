// Correct a published prediction's probability or confidence language.
//
//   pnpm correct:prediction <prediction-id> --drop-probability --reason "..."
//   pnpm correct:prediction <id> --probability 0.7 --reason "..."
//   pnpm correct:prediction <id> --drop-probability --confidence-language "more likely than not" --reason "..."
//   pnpm correct:prediction <id> --resolution-date 2026-12-10 --reason "..."
//
// Published predictions are immutable. public.correct_prediction() publishes a
// corrected copy (same source, quote, dates, criteria, resolution and
// evidence), hides the original, links them, and audits both in one
// transaction. The copy's public history shows the correction and its reason.
// The database rejects a probability the quote doesn't state, and confidence
// language that isn't the source's own words.

import "dotenv/config";
import { closeDatabase, getDatabase } from "@/lib/db/postgres";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const id = process.argv[2];
  const reason = arg("--reason");
  if (!id || id.startsWith("--") || !reason) throw new Error("Usage: pnpm correct:prediction <id> (--drop-probability | --probability <0-1>) [--confidence-language <words from the quote>] --reason <why>");
  const sql = getDatabase();
  const [current] = await sql<{ explicit_probability: string | null; confidence_language: string | null }[]>`
    select explicit_probability::text, confidence_language from public.predictions where id = ${id}`;
  if (!current) throw new Error(`Prediction ${id} not found.`);
  const probability = process.argv.includes("--drop-probability") ? null
    : arg("--probability") !== undefined ? Number(arg("--probability"))
      : current.explicit_probability === null ? null : Number(current.explicit_probability);
  if (probability !== null && !(probability >= 0 && probability <= 1)) throw new Error("--probability must be between 0 and 1.");
  const confidence = process.argv.includes("--confidence-language") ? arg("--confidence-language") ?? null : current.confidence_language;
  const deadline = arg("--resolution-date") ?? null;
  if (deadline !== null && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new Error("--resolution-date must be YYYY-MM-DD.");
  const [{ id: newId }] = await sql<{ id: string }[]>`
    select public.correct_prediction(${id}, ${probability}, ${confidence}, ${reason}, 'admin', ${process.env.CORRECTION_ACTOR ?? null}, ${deadline}::timestamptz) as id`;
  console.log(JSON.stringify({ corrected: id, replacement: newId, explicit_probability: probability, confidence_language: confidence, resolution_date: deadline }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(closeDatabase);
