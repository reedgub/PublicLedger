// Hand-curated prediction lists (e.g. pasted from a research assistant) are
// treated as LEADS, never as facts: every row is re-checked against the real
// source before it can become a candidate, and the cascade verifier then
// decides publish or reject exactly as it does for collected posts.
//
//   - X posts are re-read through the official API (author must be the expert).
//   - Web pages are fetched live (robots.txt respected); only a bounded excerpt
//     around the quote is stored.
//   - The stored quote must be found verbatim in the fetched source (modulo
//     typography, repaired to the exact slice). Dates come from the source,
//     never from the row.

import { z } from "zod";
import { CATEGORY_SLUGS } from "@/lib/constants";
import { repairSourceQuote } from "@/lib/predictions/validation";
import { bylineMatches } from "@/lib/sources/feed";

export const manualRowSchema = z.object({
  expertSlug: z.string().min(1),
  sourcePath: z.string().url(),
  sourceQuote: z.string().min(1),
  normalizedClaim: z.string().min(1),
  resolutionCriteria: z.string().min(1),
  resolutionDate: z.string().min(1),
  category: z.enum(CATEGORY_SLUGS),
  recordType: z.enum(["prediction", "take"]).optional().default("prediction"),
  imputationNote: z.string().nullable().optional(),
  explicitProbability: z.number().min(0).max(1).nullable().optional(),
  confidenceLanguage: z.string().nullable().optional(),
  falsifiabilityScore: z.number().min(0).max(1).optional().default(0.8),
}).passthrough();

export type ManualRow = z.infer<typeof manualRowSchema>;

/** `https://x.com/<handle>/status/<id>` (or twitter.com) → handle and post id. */
export function parseXStatusUrl(url: string): { handle: string; id: string } | null {
  try {
    const parsed = new URL(url);
    if (!/^(www\.|mobile\.)?(x|twitter)\.com$/.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
    return match ? { handle: match[1], id: match[2] } : null;
  } catch {
    return null;
  }
}

/** Collapse rows that point at the same quote in the same source for the same expert. */
export function dedupeRows(rows: ManualRow[]): ManualRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.expertSlug}|${row.sourcePath}|${row.sourceQuote.replace(/\s+/g, " ").trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Locate the quote in the fetched text and return the exact source slice plus
 * a bounded excerpt around it (so third-party articles are never stored whole).
 */
export function locateQuote(text: string, quote: string, radius = 1200): { quote: string; excerpt: string } | null {
  // Rows sometimes elide with "..." — that is not a contiguous quote.
  if (/\.\.\.|…/.test(quote.replace(/\.\.\.$|…$/, ""))) return null;
  const exact = repairSourceQuote(text, quote.trim());
  if (!exact) return null;
  const index = text.indexOf(exact);
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + exact.length + radius);
  return { quote: exact, excerpt: text.slice(start, end) };
}

/** Within a week of the statement counts as live capture; anything older is backfill. */
export function captureModeFor(publishedAt: Date, now = new Date()): "live" | "backfill" {
  return now.getTime() - publishedAt.getTime() > 7 * 86_400_000 ? "backfill" : "live";
}

export { statedProbability } from "@/lib/predictions/validation";

/**
 * True when `quote` sits inside quotation marks in its paragraph of `text`.
 *
 * On a third-party page (news, interview write-up) only words the writer
 * puts in quotation marks are the expert's own; everything else is the
 * writer's paraphrase ("Hayes expects ETH to hit $10K"), which can never be
 * attributed. Ambiguous cases (single quotes, which double as apostrophes)
 * fail closed.
 */
export function isDirectQuote(text: string, quote: string): boolean {
  const index = text.indexOf(quote);
  if (index < 0 || !quote.trim()) return false;
  const trimmed = quote.trim();
  if (/^[“"]/.test(trimmed) && /[”"][.,!?;:]?$/.test(trimmed)) return true;
  const paragraphStart = Math.max(text.lastIndexOf("\n", index - 1) + 1, index - 2000);
  const nextBreak = text.indexOf("\n", index + quote.length);
  const paragraphEnd = Math.min(nextBreak < 0 ? text.length : nextBreak, index + quote.length + 2000);
  const before = text.slice(paragraphStart, index);
  const after = text.slice(index + quote.length, paragraphEnd);
  const count = (value: string, mark: string) => value.split(mark).length - 1;
  if (count(quote, "”") > count(quote, "“") || count(quote, '"') % 2 === 1) return false;
  const curlyOpen = count(before, "“") > count(before, "”") && after.includes("”");
  const straightOpen = count(before, '"') % 2 === 1 && after.includes('"');
  return curlyOpen || straightOpen;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Whether a page is the expert's own writing: its host is one of the
 * expert's registered feeds/sitemaps, or it carries the expert's byline.
 * A page with no byline is never assumed to be theirs.
 */
export function isExpertsOwnPage(page: { url: string; byline: string | null }, expert: { name: string; ownUrls: string[] }): boolean {
  const host = hostOf(page.url);
  if (host && expert.ownUrls.some((url) => hostOf(url) === host)) return true;
  return Boolean(page.byline) && bylineMatches(page.byline, expert.name);
}

/** Posting time encoded in an X post id (snowflake), or null for pre-2010 ids. */
export function xPostTimestamp(id: string): Date | null {
  if (!/^\d{5,25}$/.test(id)) return null;
  const ms = (BigInt(id) >> BigInt(22)) + BigInt(1288834974657);
  const date = new Date(Number(ms));
  return date.getTime() > Date.UTC(2010, 10, 4) && date.getTime() <= Date.now() + 86_400_000 ? date : null;
}
