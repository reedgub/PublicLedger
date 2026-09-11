// Best-effort cache purge for CLI scripts.
//
// When SITE_REVALIDATE_URL and CRON_SECRET are set, POSTs to the running site's
// /api/revalidate endpoint so the homepage and specific pages re-render as soon
// as the CLI publishes new content. Silent no-op when either is unset — safe
// to call from every script.
//
// SITE_REVALIDATE_URL falls back to NEXT_PUBLIC_SITE_ORIGIN. Missing origin is
// treated as "no live site to notify" and returns immediately without error.

const DEFAULT_TIMEOUT_MS = 5_000;

export async function revalidateLive(paths: string[], tags: string[] = []): Promise<void> {
  const origin = process.env.SITE_REVALIDATE_URL || process.env.NEXT_PUBLIC_SITE_ORIGIN;
  const secret = process.env.CRON_SECRET;
  if (!origin || !secret) return;
  if (paths.length === 0 && tags.length === 0) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const url = new URL("/api/revalidate", origin);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ paths, tags }),
      signal: controller.signal,
    });
  } catch {
    // Best-effort — CLI runs must not fail because the site is unreachable.
  } finally {
    clearTimeout(timer);
  }
}
