import { getExpertScorecards } from "@/lib/data/public";
import { checkRateLimit, requestIpHash } from "@/lib/security/rate-limit";

const API_LIMIT = { capacity: 30, refillPerSecond: 1 } as const;

export async function GET(request: Request) {
  const limit = checkRateLimit(`v1l:${requestIpHash(request)}`, API_LIMIT);
  if (!limit.allowed) {
    return Response.json({ error: "Rate limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const scorecards = (await getExpertScorecards()).filter((scorecard) => scorecard.leaderboardEligible);
  return Response.json(
    {
      leaderboard: scorecards.map((scorecard, index) => ({
        rank: index + 1,
        slug: scorecard.expert.slug,
        displayName: scorecard.expert.displayName,
        accuracy: scorecard.accuracy,
        wilsonRankScore: scorecard.wilsonRankScore,
        brierScore: scorecard.brierScore,
        correct: scorecard.correctPredictions,
        resolved: scorecard.resolvedPredictions,
        provisional: scorecard.provisional,
      })),
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
