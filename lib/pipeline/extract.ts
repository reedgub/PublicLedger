// Stage 2: structured extraction on an open-weight model.
//
// Reuses the production extraction rules verbatim and adds two things open
// models need: an explicit JSON shape (they don't all honour strict schemas)
// and an outcome-blindness rule, which matters most for backfill — the model
// already knows how 2023 turned out, and that knowledge must not leak into
// the frozen claim or criteria.

import { z } from "zod";
import { EXTRACTION_SYSTEM_PROMPT } from "@/lib/ai/extractPrediction";
import { extractedPredictionSchema, type ExtractedPrediction } from "@/lib/ai/schemas";
import { CATEGORY_SLUGS } from "@/lib/constants";
import { chatJson, resolveModel, type ModelTarget } from "@/lib/llm/openCompat";
import { tokenCostUsd } from "@/lib/pipeline/spend";

export const CASCADE_EXTRACTION_VERSION = "2026-10-05.2-cascade-attribution";

export const OUTCOME_BLIND_RULES = `
Outcome blindness (mandatory):
- Work ONLY from the supplied source text and its timestamp. You may know what happened after the source was published — ignore it completely.
- Never add names, numbers, thresholds, dates or framing to the normalized_claim or resolution_criteria that are not in the source or not knowable on the source date.
- Extract every qualifying claim regardless of whether you believe it later came true or false.

Attribution (mandatory):
- Only extract outcomes the author asserts in their own voice. Do NOT extract the author reporting someone else's forecast: central-bank or government projections, market pricing or betting odds, analyst or economist consensus ("X is expected to…"), poll numbers, company guidance, or third-person quotes ("he said…").
- Do NOT extract retrospective claims of having been right ("as I predicted…", "just like I told you").
- Do NOT extract claims whose subject is unclear without outside context.`;

const JSON_SHAPE = `
Reply with ONLY a JSON object of this exact shape:
{
  "source_is_usable": boolean,
  "speaker_is_author": boolean,
  "reason_rejected": string | null,
  "predictions": [
    {
      "record_type": "prediction" | "take",
      "normalized_claim": string,
      "source_quote": string,            // exact contiguous substring of the source text
      "resolution_date": "YYYY-MM-DD" | null,
      "resolution_criteria": string,
      "explicit_probability": number | null,   // 0-1, only if the author stated one
      "confidence_language": string | null,   // the author's own hedge or certainty words, copied verbatim from source_quote ("I am in the 25 bps camp", "very likely"); null if none. Never a description ("categorical") or a paraphrase.
      "category": one of ${CATEGORY_SLUGS.map((slug) => `"${slug}"`).join(", ")},
      "extraction_confidence": number,   // 0-1
      "falsifiability_score": number,    // 0-1
      "source_fidelity_score": number,   // 0-1
      "imputation_note": string | null   // required when record_type = "take"
    }
  ]
}
Return "predictions": [] when nothing qualifies.`;

export const CASCADE_EXTRACTION_SYSTEM_PROMPT = `${EXTRACTION_SYSTEM_PROMPT}\n${OUTCOME_BLIND_RULES}\n${JSON_SHAPE}`;

// Lenient envelope: individual predictions are validated one by one so one
// malformed row doesn't discard its valid siblings.
const envelopeSchema = z.object({
  source_is_usable: z.boolean(),
  speaker_is_author: z.boolean(),
  reason_rejected: z.string().nullable().optional().default(null),
  predictions: z.array(z.unknown()).default([]),
});

export type CascadeExtraction = {
  sourceIsUsable: boolean;
  speakerIsAuthor: boolean;
  reasonRejected: string | null;
  predictions: ExtractedPrediction[];
  malformed: number;
};

export function normalizeExtraction(raw: z.infer<typeof envelopeSchema>): CascadeExtraction {
  const predictions: ExtractedPrediction[] = [];
  let malformed = 0;
  for (const item of raw.predictions.slice(0, 5)) {
    // Unknown categories become "other" rather than discarding a valid claim.
    const candidate = item && typeof item === "object" && !(CATEGORY_SLUGS as readonly string[]).includes((item as { category?: string }).category ?? "")
      ? { ...(item as object), category: "other" }
      : item;
    const parsed = extractedPredictionSchema.safeParse(candidate);
    if (parsed.success) predictions.push(parsed.data);
    else malformed += 1;
  }
  return {
    sourceIsUsable: raw.source_is_usable,
    speakerIsAuthor: raw.speaker_is_author,
    reasonRejected: raw.reason_rejected ?? null,
    predictions,
    malformed,
  };
}

export function buildExtractionUserPrompt(input: {
  authorName: string;
  authorHandle?: string | null;
  sourceType: string;
  sourceTimestamp: string | Date;
  text: string;
  isExcerpt: boolean;
}): string {
  const lines = [
    `Author: ${input.authorName}${input.authorHandle ? ` (@${input.authorHandle})` : ""}`,
    `Source type: ${input.sourceType}`,
    `Source timestamp (UTC): ${new Date(input.sourceTimestamp).toISOString()}`,
  ];
  if (input.isExcerpt) lines.push("This is an excerpt of a longer document by the author. Only extract claims the author makes in this excerpt.");
  if (input.sourceType === "podcast") lines.push("This is a machine transcript of spoken audio that may include other speakers. Set speaker_is_author=false unless it is clear the author is the one speaking.");
  lines.push("", "Source text:", input.text);
  return lines.join("\n");
}

export type ExtractionCallResult = {
  extraction: CascadeExtraction;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  model: string;
  provider: string;
};

export function extractionTarget(): ModelTarget | null {
  return resolveModel("extract");
}

export function estimateExtractionCostUsd(target: ModelTarget, textChars: number): number {
  return tokenCostUsd({ inputTokens: (CASCADE_EXTRACTION_SYSTEM_PROMPT.length + textChars + 300) / 4, outputTokens: 600 }, target.price);
}

export async function extractUnit(
  target: ModelTarget,
  input: Parameters<typeof buildExtractionUserPrompt>[0],
): Promise<ExtractionCallResult> {
  const result = await chatJson(target, {
    system: CASCADE_EXTRACTION_SYSTEM_PROMPT,
    user: buildExtractionUserPrompt(input),
    schema: envelopeSchema,
    maxTokens: 2500,
  });
  return {
    extraction: normalizeExtraction(result.data),
    usage: result.usage,
    costUsd: tokenCostUsd(result.usage, target.price),
    model: result.model,
    provider: result.provider,
  };
}
