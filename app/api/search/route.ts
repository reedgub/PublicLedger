import { z } from "zod";
import { searchPublic } from "@/lib/data/public";
import { checkRateLimit, requestIpHash } from "@/lib/security/rate-limit";

const querySchema = z.string().trim().min(2).max(120);

// Autocomplete-friendly limits: allow a short typing burst, then throttle so
// one client can't sustain a flood against the pg_trgm function.
const SEARCH_RATE_LIMIT = { capacity: 30, refillPerSecond: 2 } as const;

export async function GET(request: Request) {
  const limit = checkRateLimit(requestIpHash(request), SEARCH_RATE_LIMIT);
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many searches. Slow down and try again shortly.", results: [] },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const query = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!query.success) return Response.json({ results: [] });
  try {
    return Response.json({ results: await searchPublic(query.data) });
  } catch (error) {
    console.error("Search failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Search is temporarily unavailable.", results: [] }, { status: 503 });
  }
}
