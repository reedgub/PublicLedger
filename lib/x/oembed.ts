// X oEmbed adapter. Verifies a candidate post exists and belongs to the
// expected author without needing an X Bearer Token. Free, unauthenticated.

import * as cheerio from "cheerio";
import { HttpError, withRetry } from "@/lib/http/retry";
import { canonicalizeXPostUrl } from "@/lib/x/url";

const OEMBED_ENDPOINT = "https://publish.x.com/oembed";

export type XOembedResult = {
  postId: string;
  canonicalUrl: string;
  authorName: string | null;
  authorHandle: string | null;
  bodyText: string;
  cacheAge: number | null;
  fetchedAt: string;
};

export class XOembedNotFoundError extends Error {
  constructor(url: string) {
    super(`X oEmbed did not resolve ${url}`);
  }
}

export async function fetchXOembed(canonicalUrl: string): Promise<XOembedResult> {
  const ref = canonicalizeXPostUrl(canonicalUrl);
  if (!ref) throw new Error(`Not a canonical X post URL: ${canonicalUrl}`);
  const target = new URL(OEMBED_ENDPOINT);
  target.searchParams.set("url", ref.canonical);
  target.searchParams.set("omit_script", "true");
  target.searchParams.set("dnt", "true");

  return withRetry(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(target, {
          headers: { Accept: "application/json", "User-Agent": "ProjectLighthouse/0.1 (+https://projectlighthouse.dev)" },
          signal: controller.signal,
        });
        if (response.status === 404) throw new XOembedNotFoundError(canonicalUrl);
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new HttpError(`oEmbed ${response.status}`, response.status, response.headers, body.slice(0, 400));
        }
        const payload = (await response.json()) as {
          author_name?: string;
          author_url?: string;
          cache_age?: string | number;
          html?: string;
          url?: string;
        };
        if (!payload.html) throw new XOembedNotFoundError(canonicalUrl);
        return parseOembedPayload(ref.canonical, ref.postId, payload);
      } finally {
        clearTimeout(timer);
      }
    },
    {
      attempts: 2,
      // Do not retry a 404 — the post is gone.
      retryable: (error) => !(error instanceof XOembedNotFoundError) && (error instanceof HttpError ? error.status >= 500 : true),
    },
  );
}

export function parseOembedPayload(
  canonicalUrl: string,
  postId: string,
  payload: { author_name?: string; author_url?: string; cache_age?: string | number; html?: string; url?: string },
): XOembedResult {
  const $ = cheerio.load(payload.html ?? "");
  const blockquote = $("blockquote").first();
  // Drop nested anchors' href-only trailing lines (URLs, media) but keep the
  // human-readable body text.
  blockquote.find("script, style").remove();
  const bodyText = blockquote.find("p").first().text() || blockquote.text();
  const authorHandle = extractAuthorHandle(payload.author_url ?? "");
  const cacheAge = payload.cache_age !== undefined ? Number(payload.cache_age) : null;
  return {
    postId,
    canonicalUrl: payload.url ?? canonicalUrl,
    authorName: payload.author_name?.trim() || null,
    authorHandle,
    bodyText: bodyText.replace(/\s+\n/g, "\n").trim(),
    cacheAge: Number.isFinite(cacheAge) ? (cacheAge as number) : null,
    fetchedAt: new Date().toISOString(),
  };
}

function extractAuthorHandle(authorUrl: string): string | null {
  if (!authorUrl) return null;
  try {
    const parsed = new URL(authorUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const handle = parts[0];
    return handle && /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
  } catch {
    return null;
  }
}
