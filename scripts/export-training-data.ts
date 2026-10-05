// Export labelled data for fine-tuning your own small models, so the cheap
// stages get more accurate the longer the pipeline runs.
//
//   pnpm export:training [--out data/training] [--min-date 2024-01-01]
//
// Writes (chat-format JSONL accepted by OpenAI, Together, Fireworks, and
// open-source trainers such as axolotl/unsloth):
//   screen.train.jsonl / screen.val.jsonl     stage 1: does this text contain a checkable forecast? {"keep": true|false}
//   extract.train.jsonl / extract.val.jsonl   stage 2: source → the extraction that survived verification/admin review
//
// Labels come only from decisions made AFTER the cheap stages — the frontier
// verifier and admin review — never from the cheap model's own output, so
// training does not just teach the model to agree with itself. The split is
// by expert (≈10% of experts held out) to avoid leakage between near-duplicate
// posts from one author.

import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeDatabase, getDatabase } from "@/lib/db/postgres";
import { buildExtractionUserPrompt, CASCADE_EXTRACTION_SYSTEM_PROMPT } from "@/lib/pipeline/extract";
import { buildScreenUserPrompt, SCREEN_SYSTEM_PROMPT } from "@/lib/pipeline/screen";
import { verifierContext } from "@/lib/pipeline/verify";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function isValidationExpert(expertId: string, share = 0.1): boolean {
  const bucket = parseInt(createHash("sha256").update(expertId).digest("hex").slice(0, 8), 16) / 0xffffffff;
  return bucket < share;
}

type Row = {
  source_id: string;
  expert_id: string;
  display_name: string;
  x_handle: string | null;
  source_type: string;
  published_at: string;
  exact_text: string;
  positives: Array<Record<string, unknown>> | null;
  negative_reasons: string[] | null;
};

// Verifier/admin verdicts that mean "there was no real forecast here".
const NEGATIVE_VERDICTS = new Set(["not_prediction", "wrong_speaker", "unsupported"]);

async function main() {
  const out = arg("--out") ?? "data/training";
  const minDate = arg("--min-date") ?? "2000-01-01";
  const sql = getDatabase();
  const rows = await sql<Row[]>`
    select s.id as source_id, e.id as expert_id, e.display_name, e.x_handle, s.source_type, s.published_at::text, s.exact_text,
      -- Positives use the PUBLISHED fields, so admin corrections become the label.
      (select jsonb_agg(jsonb_build_object(
          'record_type', p.record_type, 'normalized_claim', p.normalized_claim, 'source_quote', p.source_quote,
          'resolution_date', to_char(p.resolution_date, 'YYYY-MM-DD'), 'resolution_criteria', p.resolution_criteria,
          'explicit_probability', p.explicit_probability, 'confidence_language', p.confidence_language, 'category', p.category_slug,
          'extraction_confidence', 0.95, 'falsifiability_score', coalesce(p.falsifiability_score, 0.9), 'source_fidelity_score', 0.97,
          'imputation_note', p.imputation_note))
        from public.predictions p where p.source_id = s.id and p.published_at is not null) as positives,
      (select array_agg(coalesce(pc.verifier_verdict, pc.reason_rejected))
        from public.prediction_candidates pc where pc.source_id = s.id and pc.status in ('rejected')) as negative_reasons
    from public.sources s
    join public.experts e on e.id = coalesce(s.expert_id, (select e2.id from public.experts e2 where lower(e2.x_handle) = lower(s.author_handle) limit 1))
    where s.exact_text is not null and s.deleted_at is null and s.published_at >= ${minDate}
      and (exists (select 1 from public.predictions p where p.source_id = s.id and p.published_at is not null)
        or exists (select 1 from public.prediction_candidates pc where pc.source_id = s.id and pc.status = 'rejected'
          and (pc.verifier_verdict is not null or pc.reason_rejected like 'Auto-reject%' or pc.reason_rejected like 'Verifier:%')))
  `;

  const files: Record<string, string[]> = { "screen.train.jsonl": [], "screen.val.jsonl": [], "extract.train.jsonl": [], "extract.val.jsonl": [] };
  let positives = 0; let negatives = 0;
  for (const row of rows) {
    const split = isValidationExpert(row.expert_id) ? "val" : "train";
    const hasPositive = (row.positives?.length ?? 0) > 0;
    const negative = !hasPositive && (row.negative_reasons ?? []).some((reason) => reason && [...NEGATIVE_VERDICTS].some((verdict) => reason.includes(verdict)));
    if (!hasPositive && !negative) continue;
    // Long documents: train on the passage around the labelled quote(s).
    const text = hasPositive
      ? verifierContext(row.exact_text, String(row.positives![0].source_quote ?? ""), 1200)
      : row.exact_text.slice(0, 2400);
    if (hasPositive && row.positives!.some((item) => !text.includes(String(item.source_quote ?? "")))) continue;
    files[`screen.${split}.jsonl`].push(JSON.stringify({ messages: [
      { role: "system", content: SCREEN_SYSTEM_PROMPT },
      { role: "user", content: buildScreenUserPrompt([{ key: "1", text }]) },
      { role: "assistant", content: JSON.stringify({ keep: hasPositive ? [1] : [] }) },
    ] }));
    files[`extract.${split}.jsonl`].push(JSON.stringify({ messages: [
      { role: "system", content: CASCADE_EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: buildExtractionUserPrompt({ authorName: row.display_name, authorHandle: row.x_handle, sourceType: row.source_type, sourceTimestamp: row.published_at, text, isExcerpt: text.length < row.exact_text.length }) },
      { role: "assistant", content: JSON.stringify({ source_is_usable: true, speaker_is_author: hasPositive || !(row.negative_reasons ?? []).some((reason) => reason?.includes("wrong_speaker")), reason_rejected: hasPositive ? null : "no qualifying forecast", predictions: hasPositive ? row.positives : [] }) },
    ] }));
    if (hasPositive) positives += 1; else negatives += 1;
  }
  await mkdir(out, { recursive: true });
  for (const [name, lines] of Object.entries(files)) await writeFile(path.join(out, name), lines.join("\n") + (lines.length ? "\n" : ""));
  console.log(JSON.stringify({ stage: "training_export", out, sources: rows.length, positives, negatives, files: Object.fromEntries(Object.entries(files).map(([name, lines]) => [name, lines.length])) }));
  if (positives + negatives < 500) console.log("Fewer than ~500 labelled examples: keep collecting before fine-tuning; prompt-only open models are the better choice until then.");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(closeDatabase);
