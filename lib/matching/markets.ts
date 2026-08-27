import type { Market } from "@/types/domain";
import { tokenSimilarity } from "@/lib/predictions/dedupe";

export function retrieveMarketCandidates(
  prediction: { normalizedClaim: string; resolutionDate: string | null },
  markets: Market[],
  limit = 5,
): Array<{ market: Market; retrievalScore: number }> {
  return markets
    .map((market) => {
      const similarity = tokenSimilarity(prediction.normalizedClaim, market.question);
      const timeframeCompatible = !prediction.resolutionDate || !market.endAt
        ? 0.5
        : Math.abs(new Date(prediction.resolutionDate).getTime() - new Date(market.endAt).getTime()) <= 31 * 86_400_000
          ? 1
          : 0;
      return { market, retrievalScore: similarity * 0.8 + timeframeCompatible * 0.2 };
    })
    .filter((item) => item.retrievalScore >= 0.2)
    .sort((a, b) => b.retrievalScore - a.retrievalScore)
    .slice(0, limit);
}

export function canCreateMarketLink(result: {
  is_match: boolean;
  score: number;
  same_outcome_definition: boolean;
  same_timeframe: boolean;
}): boolean {
  return result.is_match && result.score >= 0.9 && result.same_outcome_definition && result.same_timeframe;
}
