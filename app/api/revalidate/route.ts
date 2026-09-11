// Cache-purge endpoint for CLI scripts that publish new content.
//
// Route handlers already call `revalidatePath` directly; this endpoint exists
// so long-lived CLIs (process-sources, resolve-due, seed-*) can nudge the
// running site to re-render the homepage/leaderboard the moment new
// predictions ship, instead of waiting for the next admin action or cron.
//
// Gated on CRON_SECRET so callers must run in a trusted environment.
// Payload: { paths?: string[]; tags?: string[] }. Both optional; unknown
// entries are ignored.

import { revalidatePath, revalidateTag } from "next/cache";
import { env } from "@/lib/env";

const ALLOWED_PATHS = new Set(["/", "/leaderboard", "/experts", "/topics"]);
const PATH_PREFIXES = ["/predictions/", "/experts/", "/topics/"];

function authorized(request: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const bearer = request.headers.get("authorization");
  return bearer === `Bearer ${env.CRON_SECRET}` || request.headers.get("x-cron-secret") === env.CRON_SECRET;
}

async function handle(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { paths?: unknown; tags?: unknown };
  const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string") : [];
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];

  const revalidated: string[] = [];
  for (const path of paths) {
    if (ALLOWED_PATHS.has(path) || PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      revalidatePath(path);
      revalidated.push(path);
    }
  }
  for (const tag of tags) {
    // Next 16's revalidateTag requires a cache-life profile as the second
    // argument. "max" expires the tag immediately (default profile).
    revalidateTag(tag, "max");
    revalidated.push(`tag:${tag}`);
  }
  return Response.json({ ok: true, revalidated });
}

export const POST = handle;
