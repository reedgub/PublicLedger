import { zodTextFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/ai/client";
import { predictionVerifierSchema, type ExtractedPrediction, type PredictionVerifierResult } from "@/lib/ai/schemas";

export async function verifyPrediction(input: {
  sourceText: string;
  sourceTimestamp: string | Date;
  authorName: string;
  candidate: ExtractedPrediction;
}): Promise<{ result: PredictionVerifierResult; model: string }> {
  const client = getOpenAIClient();
  const response = await client.responses.parse({
    model: env.OPENAI_VERIFIER_MODEL,
    input: [
      {
        role: "system",
        content: `Independently audit a proposed prediction extraction. Compare it only with the supplied source. Reject invented precision, changed certainty, wrong speakers, unsupported dates, non-literal quotes and criteria that materially alter the claim. A faithful verdict requires that every substantive detail is supported.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          author: input.authorName,
          source_timestamp: new Date(input.sourceTimestamp).toISOString(),
          original_source_text: input.sourceText,
          proposed_prediction: input.candidate,
        }),
      },
    ],
    text: { format: zodTextFormat(predictionVerifierSchema, "publicledger_prediction_verifier") },
  });
  if (!response.output_parsed) throw new Error("OpenAI returned no parsed verifier output.");
  return { result: response.output_parsed, model: env.OPENAI_VERIFIER_MODEL };
}
