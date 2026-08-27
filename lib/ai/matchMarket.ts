import { zodTextFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/ai/client";
import { marketMatchSchema, type MarketMatchResult } from "@/lib/ai/schemas";

export async function verifyMarketMatch(input: {
  normalizedClaim: string;
  resolutionCriteria: string;
  predictionDate: string;
  resolutionDate: string | null;
  marketQuestion: string;
  marketDescription: string | null;
  marketEndDate: string | null;
}): Promise<MarketMatchResult> {
  const response = await getOpenAIClient().responses.parse({
    model: env.OPENAI_VERIFIER_MODEL,
    input: [
      {
        role: "system",
        content: "Determine whether a prediction and market describe the same observable outcome and compatible timeframe. Be conservative. A related subject is not enough.",
      },
      { role: "user", content: JSON.stringify(input) },
    ],
    text: { format: zodTextFormat(marketMatchSchema, "receipts_market_match") },
  });
  if (!response.output_parsed) throw new Error("OpenAI returned no parsed market match.");
  return response.output_parsed;
}
