// Re-checks the original behind a published prediction, for free where
// possible: web pages are re-fetched (robots.txt respected), podcast audio is
// probed with HEAD, and X posts are checked through the public oEmbed endpoint
// when no X API token is configured. Nothing is scraped.
//
// Outcomes are deliberately conservative in both directions:
//   - "gone": the publisher says the original no longer exists (404/410, or
//     oEmbed cannot resolve the post) → quarantine now.
//   - "quote_missing": the page loaded but no longer contains a quote → those
//     predictions are quarantined now.
//   - "unreachable": we could not tell (timeouts, 5xx, 403/429, robots) → a
//     strike; repeated strikes make the source unverifiable.
//   - "verified": the original still exists and still contains every quote.

import { load } from "cheerio";
import { quoteAppearsIn } from "@/lib/predictions/validation";
import { pageTextFromHtml } from "@/lib/resolution/evidence";
import { allowedToFetch, FEED_USER_AGENT, parseArticle } from "@/lib/sources/feed";
import { fetchXOembed, XOembedNotFoundError } from "@/lib/x/oembed";

export type LiveCheck =
  | { state: "verified" }
  | { state: "gone"; detail: string }
  | { state: "quote_missing"; missing: string[] }
  | { state: "unreachable"; detail: string };

/** Consecutive "unreachable" checks after which a source counts as unverifiable. */
export const MAX_REFRESH_STRIKES = 3;

/** Every readable text a page offers: article body, whole page, and meta descriptions. */
export function pageTexts(html: string, url: string): string[] {
  const $ = load(html);
  const summary = $("meta[name='description'], meta[property='og:description']").map((_, node) => $(node).attr("content") ?? "").get().join("\n");
  return [parseArticle(html, url).text, pageTextFromHtml(html), summary].filter((text) => text.length > 0);
}

/** Classify a fetched page. Pure, so the decision rules are unit-tested. */
export function classifyPage(status: number, html: string | null, url: string, quotes: string[]): LiveCheck {
  if (status === 404 || status === 410) return { state: "gone", detail: `HTTP ${status}` };
  if (status < 200 || status >= 300 || html === null) return { state: "unreachable", detail: `HTTP ${status}` };
  const texts = pageTexts(html, url);
  const missing = quotes.filter((quote) => !texts.some((text) => quoteAppearsIn(text, quote)));
  return missing.length ? { state: "quote_missing", missing } : { state: "verified" };
}

export async function checkWebSource(url: string, quotes: string[]): Promise<LiveCheck> {
  if (!/^https?:\/\//i.test(url)) return { state: "gone", detail: "no public URL for this source" };
  try {
    if (!(await allowedToFetch(url))) return { state: "unreachable", detail: "robots.txt disallows fetching" };
    const response = await fetch(url, { headers: { "User-Agent": FEED_USER_AGENT, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    return classifyPage(response.status, response.ok ? await response.text() : null, url, quotes);
  } catch (error) {
    return { state: "unreachable", detail: error instanceof Error ? error.message.slice(0, 200) : "fetch failed" };
  }
}

/** Podcasts: the transcript is ours, so only the episode audio's existence can be checked. */
export async function checkPodcastAudio(audioUrl: string | null): Promise<LiveCheck> {
  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) return { state: "gone", detail: "no public audio URL for this episode" };
  try {
    const response = await fetch(audioUrl, { method: "HEAD", headers: { "User-Agent": FEED_USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (response.status === 404 || response.status === 410) return { state: "gone", detail: `HTTP ${response.status}` };
    return response.ok ? { state: "verified" } : { state: "unreachable", detail: `HTTP ${response.status}` };
  } catch (error) {
    return { state: "unreachable", detail: error instanceof Error ? error.message.slice(0, 200) : "fetch failed" };
  }
}

/**
 * X without an API token: oEmbed tells us whether the post still publicly
 * exists. Its rendered text is lossy (links, long posts), so it is only used
 * for existence; an edit on X creates a new post id and leaves this one as-is.
 */
export async function checkXPostViaOembed(handle: string, postId: string): Promise<LiveCheck> {
  try {
    await fetchXOembed(`https://x.com/${handle || "i"}/status/${postId}`);
    return { state: "verified" };
  } catch (error) {
    if (error instanceof XOembedNotFoundError) return { state: "gone", detail: "X reports the post is unavailable (deleted, protected, or suspended)" };
    return { state: "unreachable", detail: error instanceof Error ? error.message.slice(0, 200) : "oEmbed failed" };
  }
}
