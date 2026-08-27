import { zodTextFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/ai/client";
import { extractionResponseSchema, type ExtractionResponse } from "@/lib/ai/schemas";

export const EXTRACTION_SYSTEM_PROMPT = `You extract falsifiable future predictions from public statements.
A prediction must describe a future observable outcome.
Do not convert opinions into predictions.
Do not invent details needed to make a vague statement precise.
Do not invent numeric probabilities. If a numeric probability is not explicitly stated, return null.
The source_quote must be an exact contiguous quotation from the supplied source text.
The normalized_claim may clarify grammar, dates, pronouns and entities only when the meaning is unambiguous.
Do not strengthen certainty. Do not weaken certainty.
Do not attribute a quoted third party's prediction to the author.
Reject jokes, rhetorical questions, vague futurism and statements without defensible resolution criteria.
If the prediction's deadline is relative, resolve it using the supplied source timestamp.
If there is no defensible deadline or event trigger, return null where appropriate and lower falsifiability.
Split independently testable multi-component claims, but do not atomize every clause. Return at most five predictions.`;

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
