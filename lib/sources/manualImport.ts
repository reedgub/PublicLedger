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

/** Keep a probability only when the quote states it (e.g. "50%"); never infer one. */
export function statedProbability(quote: string, probability: number | null | undefined): number | null {
  if (probability === null || probability === undefined) return null;
  const percent = Math.round(probability * 100);
  return new RegExp(`(^|[^0-9.])${percent}\\s?(%|percent)`, "i").test(quote) ? probability : null;
}
