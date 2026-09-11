// Bulk-import a hand-curated JSON list of published predictions.
//
// Purpose: get the site out of its "no verified predictions yet" state quickly.
// The public read path filters on published_at IS NOT NULL, so a launch needs
// several dozen well-formed rows before it feels like a real product. This
// script is the shortcut: point it at a JSON file authored by a human curator
// and each row lands as a source + published prediction (+ optional resolution).
//
// Usage:
//   pnpm tsx scripts/import-seed-predictions.ts path/to/seed.json
//
// The JSON is an array of items, each of which must minimally include:
//   {
//     "expertSlug": "nate-silver",
//     "sourcePath": "https://x.com/NateSilver538/status/...",  // or any URL
//     "sourceType": "x" | "web" | "manual",
//     "exactText": "the exact source text the quote lives inside",
//     "publishedAtSource": "2024-06-14T13:04:00Z",             // when the expert said it
//     "sourceQuote": "the exact contiguous substring of exactText",
//     "normalizedClaim": "US CPI YoY will print below 3% for December 2024.",
//     "resolutionCriteria": "BLS December 2024 CPI YoY release shows <3.0%.",
//     "resolutionDate": "2024-12-31",
//     "category": "economy-rates"
//   }
//
// Optional per-row: authorHandle, explicitProbability, confidenceLanguage,
// falsifiabilityScore, recordType ("prediction" | "take"), imputationNote,
// resolution ({ outcome, explanation, evidence: [{ ... }] }).
//
// Every row is validated the same way the extraction pipeline validates AI
// candidates: sourceQuote must be an exact contiguous substring of exactText,
// resolutionDate must be present and after publishedAtSource. Rows that fail
// are skipped and reported at the end — never partially inserted.

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";
import { CATEGORY_SLUGS } from "@/lib/constants";
import { predictionFingerprint } from "@/lib/predictions/fingerprint";
import { validateExtractedPrediction } from "@/lib/predictions/validation";
import { revalidateLive } from "@/lib/http/revalidate";

const evidenceSchema = z.object({
  sourceTitle: z.string().nullable().optional(),
  sourcePath: z.string().url(),
  publisher: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  isPrimarySource: z.boolean().optional().default(false),
});

const resolutionSchema = z.object({
  outcome: z.enum(["correct", "incorrect", "partial", "ambiguous", "void"]),
  explanation: z.string().min(1),
  resolvedAt: z.string().optional(),
  scoringEligible: z.boolean().optional(),
  evidence: z.array(evidenceSchema).default([]),
});

const rowSchema = z.object({
  expertSlug: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceType: z.string().default("manual"),
  authorHandle: z.string().nullable().optional(),
  exactText: z.string().min(1),
  publishedAtSource: z.string().min(1),
  sourceQuote: z.string().min(1),
  normalizedClaim: z.string().min(1),
  resolutionCriteria: z.string().min(1),
  resolutionDate: z.string().min(1),
  category: z.enum(CATEGORY_SLUGS),
  explicitProbability: z.number().min(0).max(1).nullable().optional(),
  confidenceLanguage: z.string().nullable().optional(),
  falsifiabilityScore: z.number().min(0).max(1).optional().default(0.9),
  recordType: z.enum(["prediction", "take"]).optional().default("prediction"),
  imputationNote: z.string().nullable().optional(),
  resolution: resolutionSchema.nullable().optional(),
});

type ImportRow = z.infer<typeof rowSchema>;

type Summary = {
  read: number;
  inserted: number;
  skipped: Array<{ index: number; expertSlug: string; reason: string }>;
};

async function upsertSource(sql: ReturnType<typeof getDatabase>, row: ImportRow) {
  const contentHash = createHash("sha256").update(row.exactText).digest("hex");
  const externalId = `manual:${contentHash}`;
  const [existing] = await sql<{ id: string }[]>`
    select id from public.sources where source_type = ${row.sourceType} and external_id = ${externalId} limit 1
  `;
  if (existing) return existing.id;
  const [inserted] = await sql<{ id: string }[]>`
    insert into public.sources (source_type, external_id, canonical_path, author_handle, published_at,
      exact_text, content_hash, metadata, fetched_at, last_verified_at)
    values (${row.sourceType}, ${externalId}, ${row.sourcePath}, ${row.authorHandle ?? null}, ${row.publishedAtSource},
      ${row.exactText}, ${contentHash}, ${sql.json({ imported_via: "import-seed-predictions" })}, now(), now())
    returning id
  `;
  return inserted.id;
}

export async function importSeedPredictions(rows: unknown[]): Promise<Summary> {
  const sql = getDatabase();
  const summary: Summary = { read: rows.length, inserted: 0, skipped: [] };
  for (let index = 0; index < rows.length; index += 1) {
    const parsed = rowSchema.safeParse(rows[index]);
    if (!parsed.success) {
      summary.skipped.push({ index, expertSlug: String((rows[index] as { expertSlug?: string })?.expertSlug ?? "?"), reason: parsed.error.issues[0]?.message ?? "invalid_row" });
      continue;
    }
    const row = parsed.data;
    const validation = validateExtractedPrediction(row.exactText, row.publishedAtSource, {
      normalized_claim: row.normalizedClaim,
      source_quote: row.sourceQuote,
      resolution_date: row.resolutionDate,
      resolution_criteria: row.resolutionCriteria,
      explicit_probability: row.explicitProbability ?? null,
      category: row.category,
      record_type: row.recordType,
      imputation_note: row.imputationNote ?? null,
    });
    if (!validation.valid) {
      summary.skipped.push({ index, expertSlug: row.expertSlug, reason: validation.errors.join(",") });
      continue;
    }
    const [expert] = await sql<{ id: string }[]>`select id from public.experts where slug = ${row.expertSlug} limit 1`;
    if (!expert) {
      summary.skipped.push({ index, expertSlug: row.expertSlug, reason: "expert_not_found" });
      continue;
    }
    try {
      const sourceId = await upsertSource(sql, row);
      const fingerprint = predictionFingerprint({
        expertId: expert.id,
        sourceId,
        normalizedClaim: row.normalizedClaim,
        predictionDate: row.publishedAtSource,
        resolutionDate: row.resolutionDate,
        resolutionCriteria: row.resolutionCriteria,
        explicitProbability: row.explicitProbability ?? null,
      });
      const publishedAt = new Date().toISOString();
      const status =
        row.resolution
          ? row.resolution.outcome === "ambiguous" ? "ambiguous"
            : row.resolution.outcome === "void" ? "void"
              : "resolved"
          : new Date(row.resolutionDate) <= new Date() ? "due" : "open";
      const [prediction] = await sql<{ id: string }[]>`
        insert into public.predictions (expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
          resolution_date, resolution_criteria, explicit_probability, confidence_language, falsifiability_score, verification_mode,
          status, fingerprint_sha256, published_at, frozen_at, record_type, imputation_note)
        values (${expert.id}, ${sourceId}, ${row.category}, ${row.normalizedClaim}, ${row.sourceQuote}, ${row.publishedAtSource},
          ${row.resolutionDate}, ${row.resolutionCriteria}, ${row.explicitProbability ?? null}, ${row.confidenceLanguage ?? null}, ${row.falsifiabilityScore}, 'admin',
          ${status}, ${fingerprint}, ${publishedAt}, ${publishedAt}, ${row.recordType}, ${row.recordType === "take" ? row.imputationNote ?? null : null})
        on conflict (fingerprint_sha256) do update set updated_at = public.predictions.updated_at
        returning id
      `;
      if (row.resolution) {
        const scoringEligible =
          row.resolution.scoringEligible ?? (row.resolution.outcome === "correct" || row.resolution.outcome === "incorrect");
        if (scoringEligible && !["correct", "incorrect"].includes(row.resolution.outcome)) {
          throw new Error(`scoring_eligible only valid for correct/incorrect on ${row.expertSlug}`);
        }
        if (scoringEligible && row.recordType === "take") {
          throw new Error(`takes cannot be scoring eligible on ${row.expertSlug}`);
        }
        const resolvedAt = row.resolution.resolvedAt ?? publishedAt;
        const [resolution] = await sql<{ id: string }[]>`
          insert into public.resolutions (prediction_id, outcome, explanation, resolution_confidence, resolution_method, scoring_eligible, resolved_at, approved_at)
          values (${prediction.id}, ${row.resolution.outcome}, ${row.resolution.explanation}, 1.0, 'admin', ${scoringEligible}, ${resolvedAt}, now())
          on conflict (prediction_id) do update set outcome = excluded.outcome, explanation = excluded.explanation,
            scoring_eligible = excluded.scoring_eligible, approved_at = excluded.approved_at
          returning id
        `;
        await sql`delete from public.resolution_evidence where resolution_id = ${resolution.id}`;
        for (const evidence of row.resolution.evidence) {
          await sql`
            insert into public.resolution_evidence (resolution_id, source_type, source_title, source_path, publisher, excerpt, is_primary_source)
            values (${resolution.id}, 'web', ${evidence.sourceTitle ?? null}, ${evidence.sourcePath}, ${evidence.publisher ?? null}, ${evidence.excerpt ?? null}, ${evidence.isPrimarySource ?? false})
          `;
        }
      }
      await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, reason)
        values ('prediction', ${prediction.id}, 'prediction_admin_approved', 'admin', 'Imported via scripts/import-seed-predictions')`;
      summary.inserted += 1;
    } catch (error) {
      summary.skipped.push({ index, expertSlug: row.expertSlug, reason: error instanceof Error ? error.message : "insert_failed" });
    }
  }
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: pnpm tsx scripts/import-seed-predictions.ts <path-to-seed.json>");
    process.exit(1);
  }
  readFile(path, "utf8")
    .then((body) => importSeedPredictions(JSON.parse(body)))
    .then(async (summary) => {
      console.log(`Read: ${summary.read}\nInserted: ${summary.inserted}\nSkipped: ${summary.skipped.length}`);
      for (const skip of summary.skipped) console.log(`  - #${skip.index} (${skip.expertSlug}): ${skip.reason}`);
      if (summary.inserted > 0) await revalidateLive(["/", "/leaderboard"]);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(closeDatabase);
}
