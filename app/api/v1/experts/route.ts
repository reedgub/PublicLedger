import { getExpertScorecards } from "@/lib/data/public";
import { checkRateLimit, requestIpHash } from "@/lib/security/rate-limit";

const API_LIMIT = { capacity: 30, refillPerSecond: 1 } as const;

export async function GET(request: Request) {
  const limit = checkRateLimit(`v1e:${requestIpHash(request)}`, API_LIMIT);
  if (!limit.allowed) {
    return Response.json({ error: "Rate limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const scorecards = await getExpertScorecards();
  return Response.json(
    {
      experts: scorecards.map((scorecard) => ({
        slug: scorecard.expert.slug,
        displayName: scorecard.expert.displayName,
        xHandle: scorecard.expert.xHandle,
        primaryCategory: scorecard.expert.primaryCategorySlug,
        totals: {
          predictions: scorecard.totalPredictions,
          takes: scorecard.totalTakes,
          open: scorecard.openPredictions,
          resolved: scorecard.resolvedPredictions,
          correct: scorecard.correctPredictions,
          incorrect: scorecard.incorrectPredictions,
        },
        accuracy: scorecard.accuracy,
        wilsonRankScore: scorecard.wilsonRankScore,
        brierScore: scorecard.brierScore,
        leaderboardEligible: scorecard.leaderboardEligible,
        provisional: scorecard.provisional,
      })),
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
