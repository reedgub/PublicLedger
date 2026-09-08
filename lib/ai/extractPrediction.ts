import { zodTextFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/ai/client";
import { extractionResponseSchema, type ExtractionResponse } from "@/lib/ai/schemas";

export const EXTRACTION_SYSTEM_PROMPT = `You extract forward-looking claims from public statements for Project Lighthouse, a public track-record database.

Every claim you return has a record_type. There are exactly two:

  record_type = "prediction"  — the strict, scored kind. Return this ONLY when all three ingredients below are present or defensibly inferable from the source alone:
    1. A concrete future outcome (a specific person / entity / value / event — not a vague direction).
    2. A resolution_date (YYYY-MM-DD) either stated by the author or clearly inferable from the source itself — a dated event, an election year, a relative phrase like "by 2027" / "by the election" / "within 12 months" resolved against the supplied source timestamp. Never guess a date.
    3. Resolution criteria naming a specific measurable outcome AND a specific public data source — a named poll, index, government release, benchmark, election outcome, court ruling, financial filing, launch event, etc.

  record_type = "take"  — the soft, DISPLAY-ONLY kind. Return this when the claim is a real forward-looking take (specific claim, testable in principle) but at least one ingredient is missing from the source and you had to impute it. You may impute BOTH a resolution_date and resolution_criteria for a take, but only when the imputation is defensible (industry convention, reasonable horizon, standard public data source). Set imputation_note to a short sentence explaining exactly what was imputed and why it is defensible.

  IMPORTANT for takes — resolution_criteria must still name a SPECIFIC public data source. Vague criteria like "national polls will show", "public opinion surveys", "market reaction", "reputable outlets report" are NOT acceptable even for a take. Name the source: "Pew Research national poll", "Gallup satisfaction survey", "Nielsen ratings for the season premiere week", "SEC 10-K filing", "the RealClearPolitics generic-ballot average", "Alabama athletics official roster page". If you can't name a specific source, drop the candidate — do not return it as a take.

  If a claim from the source already qualifies as record_type='prediction' (all three ingredients present without imputation), DO NOT also emit a record_type='take' for the same claim in the same response. Return each underlying claim at most once, in its highest applicable tier.

  Takes are NEVER scored — they exist so readers can see the full track record of what the expert says, not just the small subset that is fully specified.

Skip entirely (return neither prediction nor take) — these are commentary, not claims:
- Mood-forecasts: "everyone will hate X", "an era of Y", "vibes are shifting", "AI is unstoppable".
- Aesthetic judgments and hot takes without a specific outcome ("this is the best product ever", "X is overrated").
- Rhetorical questions, jokes, sarcasm, subtweets.
- Attribution of someone else's prediction: if the tweet quotes or paraphrases another person's claim, do not attribute it to the author.
- General commentary about ongoing states.

Hard rules that apply to BOTH tiers:
- The source_quote must be an exact contiguous quotation from the supplied source text. No paraphrasing, no ellipses. If you can't reproduce it exactly, drop the candidate.
- The normalized_claim may clarify grammar, dates, pronouns, and entities only when meaning is unambiguous. Do not strengthen or weaken certainty.
- Do not invent numeric probabilities. If the author does not state one, explicit_probability is null.
- Split independently testable multi-component claims into separate rows, but each split must independently meet its own tier's requirements.
- Return at most five items per source.

Scoring hints:
- falsifiability_score for a "prediction" should be >= 0.7. If you'd score lower, downgrade it to "take" or drop it.
- falsifiability_score for a "take" can be lower (0.4 - 0.7) but the underlying claim must still be testable in principle.
- source_fidelity_score reflects how literally the normalized_claim tracks the source_quote.

The default answer is DROP. Prefer zero returned items over one dubious one. When in doubt between "take" and "drop", prefer "drop" — takes still show up publicly on the expert's page.`;

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
