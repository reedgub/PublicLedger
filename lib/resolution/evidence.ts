// Deterministic evidence check for resolutions.
//
// The proposer cites URLs with excerpts. Instead of paying for a second
// web-search pass to "re-check" them, we fetch each cited page ourselves and
// require the excerpt to actually appear on it — the same exact-substring
// discipline used for source quotes. Only confirmed evidence counts toward
// auto-resolution, and the verifier sees the fetched text, not the
// proposer's claims about it.

import { load } from "cheerio";
import { parseSafePublicUrl } from "@/lib/security/urls";

const USER_AGENT = "PublicLedgerBot/0.2 (+https://publicledger.dev/methodology)";
const MAX_BYTES = 3_000_000;

export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when the excerpt (or, for long excerpts, a substantial leading part of it) appears in the page text. */
export function excerptAppears(pageText: string, excerpt: string): boolean {
  const page = normalizeForMatch(pageText);
  const needle = normalizeForMatch(excerpt).replace(/^["'…. ]+|["'…. ]+$/g, "");
  if (needle.length < 12) return false;
  if (page.includes(needle)) return true;
  // Tolerate trailing truncation/ellipsis by the model: require the first 80 chars.
  return needle.length > 80 && page.includes(needle.slice(0, 80));
}

export function pageTextFromHtml(html: string): string {
  const $ = load(html);
  $("script, style, noscript, nav, footer, header, form, svg").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

export function contextAround(text: string, excerpt: string, radius = 600): string {
  const normalizedText = normalizeForMatch(text);
  const index = normalizedText.indexOf(normalizeForMatch(excerpt).slice(0, 80));
  if (index < 0) return text.slice(0, radius * 2);
  // Indices differ slightly after normalization; the window is generous.
  return text.slice(Math.max(0, index - radius), index + radius * 2);
}

export type CheckedEvidence<T> = T & { confirmed: boolean; fetchedContext: string | null; checkError: string | null };

export async function checkEvidence<T extends { source_path: string; excerpt: string | null }>(items: T[], timeoutMs = 15_000): Promise<Array<CheckedEvidence<T>>> {
  const results: Array<CheckedEvidence<T>> = [];
  for (const item of items) {
    try {
      const url = parseSafePublicUrl(item.source_path);
      if (!item.excerpt) throw new Error("no excerpt cited");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain" }, signal: controller.signal, redirect: "follow" }).finally(() => clearTimeout(timer));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get("content-type") ?? "";
      if (!/text\/|html|xml|json/.test(type)) throw new Error(`unsupported content-type ${type}`);
      const raw = (await response.text()).slice(0, MAX_BYTES);
      const text = /html|xml/.test(type) ? pageTextFromHtml(raw) : raw;
      const confirmed = excerptAppears(text, item.excerpt);
      results.push({ ...item, confirmed, fetchedContext: confirmed ? contextAround(text, item.excerpt) : null, checkError: confirmed ? null : "excerpt not found on page" });
    } catch (error) {
      results.push({ ...item, confirmed: false, fetchedContext: null, checkError: error instanceof Error ? error.message : "fetch failed" });
    }
  }
  return results;
}
