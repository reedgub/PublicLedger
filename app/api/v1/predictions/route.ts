// Read-only JSON snapshot of the public prediction stream.
//
// Journalists linking predictions back to their pieces is the highest-leverage
// growth loop we have — expose the corpus over an unversioned-but-stable
// endpoint so it's trivial to script against. All rows respect the same
// visibility rules as the public site (published, non-source_unavailable,
// record_type='prediction').
//
// Rate-limited per-IP. Small default page size, hard cap at 50, cursorless
// for now (offset-only) so callers can page linearly without server state.

import { z } from "zod";
import { getLatestPredictions } from "@/lib/data/public";
import { checkRateLimit, requestIpHash } from "@/lib/security/rate-limit";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(25),
  status: z.enum(["any", "open", "resolved"]).optional().default("any"),
});

const API_LIMIT = { capacity: 30, refillPerSecond: 1 } as const;

export async function GET(request: Request) {
  const limit = checkRateLimit(`v1p:${requestIpHash(request)}`, API_LIMIT);
  if (!limit.allowed) {
    return Response.json({ error: "Rate limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const params = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!params.success) return Response.json({ error: params.error.issues[0]?.message ?? "Invalid query" }, { status: 400 });

  const predictions = await getLatestPredictions({
    limit: params.data.limit,
    resolved: params.data.status === "resolved" ? true : undefined,
    open: params.data.status === "open" ? true : undefined,
  });

  return Response.json(
    {
      predictions: predictions.map((prediction) => ({
        id: prediction.id,
        expert: {
          slug: prediction.expert.slug,
          displayName: prediction.expert.displayName,
          xHandle: prediction.expert.xHandle,
        },
        category: prediction.categorySlug,
        normalizedClaim: prediction.normalizedClaim,
        sourceQuote: prediction.sourceQuote,
        predictionDate: prediction.predictionDate,
        resolutionDate: prediction.resolutionDate,
        resolutionCriteria: prediction.resolutionCriteria,
        explicitProbability: prediction.explicitProbability,
        status: prediction.status,
        source: {
          type: prediction.source.sourceType,
          canonicalPath: prediction.source.canonicalPath,
          publishedAt: prediction.source.publishedAt,
          deletedAt: prediction.source.deletedAt,
        },
        resolution: prediction.resolution
          ? {
              outcome: prediction.resolution.outcome,
              explanation: prediction.resolution.explanation,
              resolvedAt: prediction.resolution.resolvedAt,
              evidence: prediction.resolution.evidence.map((evidence) => ({
                sourceTitle: evidence.sourceTitle,
                sourcePath: evidence.sourcePath,
                publisher: evidence.publisher,
                isPrimarySource: evidence.isPrimarySource,
              })),
            }
          : null,
      })),
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
