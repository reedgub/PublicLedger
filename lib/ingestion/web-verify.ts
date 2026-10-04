// Web-source verification. Fetches an article URL, extracts a plain-text
// body, and confirms the xAI-returned quote appears as an exact substring.
//
// This is the non-X counterpart to lib/x/oembed. It runs in the daily
// ingestion path for source_type in {writing, interview}. It has three jobs:
//   1. Prove the URL is reachable and returns HTML (not a login wall, 404,
//      or paywall stub).
//   2. Extract a stable plaintext body we can substring-check against the
//      quote xAI proposed.
//   3. Pull a canonical URL and publication timestamp when the page exposes
//      them, so downstream dedupe / display is stable.
//
// The extractor is intentionally conservative: strip scripts/styles/nav and
// collapse whitespace. It does NOT attempt full readability heuristics; the
// downstream substring check is the real gate, so a slightly noisy body just
// means the check still passes when the quote is in the page.

import { HttpError, withRetry } from "@/lib/http/retry";
import { quoteIsPresent } from "@/lib/x/verify";

export type WebArticle = {
  finalUrl: string;
  canonicalUrl: string | null;
  hostname: string;
  bodyText: string;
  publishedAt: string | null;
  contentType: string;
  fetchedAt: string;
};

export type WebVerifyResult =
  | { ok: true; article: WebArticle }
  | {
      ok: false;
      reason:
        | "network_error"
        | "http_error"
        | "not_html"
        | "empty_body"
        | "quote_mismatch"
        | "too_large";
      detail?: string;
      article?: WebArticle;
    };

export class WebFetchError extends Error {
  constructor(
    message: string,
    public readonly kind: "network" | "http" | "not_html" | "too_large",
    public readonly status?: number,
  ) {
    super(message);
  }
}

const MAX_BYTES = 3_000_000; // 3 MB — enough for any legitimate article page.
const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "PublicLedgerBot/0.1 (+https://publicledger.dev; contact via GitHub issues)";

export async function fetchWebArticle(url: string): Promise<WebArticle> {
  return withRetry(
    async () => fetchArticleOnce(url),
    {
      attempts: 2,
      retryable: (error) =>
        error instanceof HttpError && (error.status === 429 || error.status >= 500),
    },
  );
}

async function fetchArticleOnce(url: string): Promise<WebArticle> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw new WebFetchError(
      error instanceof Error ? error.message : String(error),
      "network",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new HttpError(
      `web fetch ${response.status}`,
      response.status,
      response.headers,
      "",
    );
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("html") && !contentType.includes("text/plain")) {
    throw new WebFetchError(`unsupported content-type: ${contentType}`, "not_html");
  }

  // Cap the body size so a runaway page can't OOM the runner.
  const buf = await readBoundedText(response.body, MAX_BYTES);
  if (buf.truncated) {
    throw new WebFetchError(`article exceeded ${MAX_BYTES} bytes`, "too_large");
  }

  const html = buf.text;
  const { text, canonicalUrl, publishedAt } = extractArticleText(html, response.url);

  return {
    finalUrl: response.url,
    canonicalUrl,
    hostname: new URL(response.url).hostname.toLowerCase(),
    bodyText: text,
    publishedAt,
    contentType,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch and verify a quote in one call. Returns a discriminated union so the
 * caller can distinguish "URL is broken" from "quote wasn't in the page".
 */
export async function verifyWebSource(
  url: string,
  quote: string,
): Promise<WebVerifyResult> {
  let article: WebArticle;
  try {
    article = await fetchWebArticle(url);
  } catch (error) {
    if (error instanceof HttpError) {
      return { ok: false, reason: "http_error", detail: `${error.status}` };
    }
    if (error instanceof WebFetchError) {
      if (error.kind === "not_html") return { ok: false, reason: "not_html", detail: error.message };
      if (error.kind === "too_large") return { ok: false, reason: "too_large", detail: error.message };
      return { ok: false, reason: "network_error", detail: error.message };
    }
    return {
      ok: false,
      reason: "network_error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!article.bodyText || article.bodyText.length < 40) {
    return { ok: false, reason: "empty_body", article };
  }
  if (!quoteIsPresent(quote, article.bodyText)) {
    return { ok: false, reason: "quote_mismatch", article };
  }
  return { ok: true, article };
}

async function readBoundedText(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let bytes = 0;
  const parts: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        return { text: parts.join(""), truncated: true };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
  return { text: parts.join(""), truncated: false };
}

/**
 * Turn raw HTML into plain text and pull a few metadata fields.
 *
 * We're intentionally naive here: substring search is the actual gate, so a
 * few stray nav labels in the body don't hurt. We drop the tags most likely
 * to inject unrelated text (script, style, template, nav, header, footer,
 * aside) and then reduce the rest to whitespace-normalized visible text.
 */
export function extractArticleText(
  html: string,
  requestUrl: string,
): { text: string; canonicalUrl: string | null; publishedAt: string | null } {
  const canonicalUrl = extractCanonicalUrl(html, requestUrl);
  const publishedAt = extractPublishedAt(html);
  // Drop noisy blocks first.
  let cleaned = html.replace(
    /<(script|style|template|noscript|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,
    " ",
  );
  // Convert paragraph/line breaks into whitespace before stripping tags to
  // preserve word boundaries.
  cleaned = cleaned.replace(/<\/(?:p|div|li|h[1-6]|br|section|article)>/gi, "\n");
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n");
  // Strip remaining tags.
  cleaned = cleaned.replace(/<[^>]+>/g, " ");
  // Decode a handful of common HTML entities. We keep it small — full entity
  // decoding is not needed because normalizeForCompare in the verifier
  // handles the whitespace/punctuation that actually breaks matching.
  cleaned = cleaned
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rdquo;/gi, "”")
    .replace(/&ldquo;/gi, "“")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–");
  const text = cleaned.replace(/\s+/g, " ").trim();
  return { text, canonicalUrl, publishedAt };
}

function extractCanonicalUrl(html: string, requestUrl: string): string | null {
  const match = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
  );
  if (!match) return null;
  try {
    return new URL(match[1], requestUrl).toString();
  } catch {
    return null;
  }
}

function extractPublishedAt(html: string): string | null {
  const candidates = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const rx of candidates) {
    const m = html.match(rx);
    if (m) {
      const d = new Date(m[1]);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}
