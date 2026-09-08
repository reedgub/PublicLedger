import { zodTextFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/ai/client";
import { extractionResponseSchema, type ExtractionResponse } from "@/lib/ai/schemas";

export const EXTRACTION_SYSTEM_PROMPT = `You extract falsifiable future predictions from public statements for Project Lighthouse, a public track-record database.
Every prediction you return MUST have three ingredients — no exceptions:
  1. A concrete future outcome (a specific person / entity / value / event, not a vague direction).
  2. A resolution_date in ISO-8601 (YYYY-MM-DD) form. If the source doesn't state a date, you may infer one ONLY when the source contains a dated event or a phrase like "by 2027", "before the election", "by end of quarter", "within 12 months" — resolve relative dates against the supplied source timestamp. If you cannot pin a defensible date this way, DO NOT return the candidate. Never guess.
  3. Resolution criteria: a short, measurable procedure a neutral reader could use to score correct / incorrect. It must reference a data source (a specific poll, index, government release, benchmark, election outcome, court ruling, financial filing, launch event, or similar public record) or a named observable event. Vague criteria like "reputable polls will show" without naming the poll are not acceptable.

Hard rules — the source_quote is data:
- The source_quote must be an exact contiguous quotation from the supplied source text. No paraphrasing, no ellipses.
- The normalized_claim may clarify grammar, dates, pronouns, and entities only when meaning is unambiguous. Do not strengthen or weaken certainty.
- Do not invent numeric probabilities. If the author does not state a probability, explicit_probability is null.
- Do not attribute a quoted third party's prediction to the author.
- Do not turn opinions, aesthetic judgments, jokes, rhetorical questions, or general commentary into predictions.
- Do not extract mood-forecasts ("everyone will hate X", "it's going to be an era of Y", "vibes are shifting"). These are commentary, not falsifiable claims. Skip them.
- If the source is a reply that quotes another person's prediction, do not attribute it to the reply author.

Splitting:
- Split independently testable multi-component claims into separate predictions, but only if EACH split still meets all three ingredients above. Return at most five predictions per source.
- If a tweet contains multiple loose claims but none can meet the ingredients bar on its own, return zero predictions and set reason_rejected to explain.

Scoring guidance:
- falsifiability_score should be >= 0.7 for any prediction you return. If you'd have to score lower, don't return it.
- source_fidelity_score should reflect how literally the normalized_claim tracks the source_quote.

The default answer is REJECT. Prefer returning zero clean predictions over one dubious one.`;

export async function extractPredictions(input: {
  sourceText: string;
  sourceTimestamp: string | Date;
  authorName: string;
  authorHandle?: string | null;
}): Promise<{ result: ExtractionResponse; model: string }> {
  const client = getOpenAIClient();
  const sourceTimestamp = new Date(input.sourceTimestamp).toISOString();
  const response = await client.responses.parse({
    model: env.OPENAI_MODEL,
    input: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Author: ${input.authorName}${input.authorHandle ? ` (@${input.authorHandle})` : ""}\nSource timestamp (UTC): ${sourceTimestamp}\n\nSource text:\n${input.sourceText}`,
      },
    ],
    text: { format: zodTextFormat(extractionResponseSchema, "receipts_prediction_extraction") },
  });
  if (!response.output_parsed) throw new Error("OpenAI returned no parsed extraction output.");
  return { result: response.output_parsed, model: env.OPENAI_MODEL };
}
