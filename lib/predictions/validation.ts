import { CATEGORY_SLUGS, type CategorySlug } from "@/lib/constants";

export type ExtractedPredictionForValidation = {
  normalized_claim: string;
  source_quote: string;
  resolution_date: string | null;
  resolution_criteria: string;
  explicit_probability: number | null;
  category: CategorySlug;
  record_type?: "prediction" | "take";
  imputation_note?: string | null;
};

export type ValidationResult = { valid: boolean; errors: string[] };

/** A real calendar date written exactly as YYYY-MM-DD (rejects "late 2027", "Q2 2027", "2026-02-30"). */
export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isLiteralSourceQuote(sourceText: string, sourceQuote: string): boolean {
  return sourceQuote.length > 0 && sourceText.includes(sourceQuote);
}

export function validateExtractedPrediction(
  sourceText: string,
  predictionDate: string | Date,
  candidate: ExtractedPredictionForValidation,
): ValidationResult {
  const errors: string[] = [];
  const recordType = candidate.record_type ?? "prediction";
  if (!isLiteralSourceQuote(sourceText, candidate.source_quote)) errors.push("source_quote_not_literal");
  if (!candidate.normalized_claim.trim()) errors.push("normalized_claim_empty");
  if (!candidate.resolution_criteria.trim()) errors.push("resolution_criteria_empty");
  if (!CATEGORY_SLUGS.includes(candidate.category)) errors.push("invalid_category");
  if (candidate.explicit_probability !== null && (candidate.explicit_probability < 0 || candidate.explicit_probability > 1)) {
    errors.push("invalid_probability");
  }
  // A resolution date is required for BOTH tiers — a take is still a
  // forward-looking claim, it just may have had its date imputed rather
  // than stated by the author. The imputation is what makes it a "take"
  // instead of a "prediction"; a claim with no defensible date at all
  // is neither, and shouldn't be stored.
  if (!candidate.resolution_date) {
    errors.push("resolution_date_missing");
  } else if (!isIsoDate(candidate.resolution_date)) {
    errors.push("resolution_date_invalid");
  } else if (new Date(candidate.resolution_date) < new Date(predictionDate)) {
    errors.push("resolution_before_prediction");
  }
  // Takes must explain what was imputed, so a reader can decide whether to
  // trust the deadline / criteria / claim structure.
  if (recordType === "take" && !(candidate.imputation_note && candidate.imputation_note.trim().length > 0)) {
    errors.push("take_missing_imputation_note");
  }
  return { valid: errors.length === 0, errors };
}

// ---- Quote repair ---------------------------------------------------------
//
// Models often return a quote that is the right passage with cosmetic drift:
// curly vs straight quotes, dashes, collapsed whitespace, or Unicode "bold"
// letters folded to ASCII. When the passage can be located unambiguously
// after normalising those differences, return the EXACT slice of the source,
// so the stored quote is still a literal contiguous substring of the source.

function foldChar(char: string): string {
  return char
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .toLowerCase();
}

/** Normalised text plus, for each normalised char, the source index it came from. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let lastWasSpace = false;
  let index = 0;
  for (const char of text) {
    const isSpace = /\s/.test(char);
    if (isSpace) {
      if (!lastWasSpace && folded.length > 0) {
        folded += " ";
        map.push(index);
      }
    } else {
      for (const out of foldChar(char)) {
        folded += out;
        map.push(index);
      }
    }
    lastWasSpace = isSpace;
    index += char.length;
  }
  return { folded, map };
}

/** The exact source passage matching `quote` modulo typography, or null if absent or ambiguous. */
export function repairSourceQuote(sourceText: string, quote: string): string | null {
  if (!quote.trim()) return null;
  if (sourceText.includes(quote)) return quote;
  const source = foldWithMap(sourceText);
  const needle = foldWithMap(quote.trim()).folded.trim();
  if (needle.length < 12) return null;
  const first = source.folded.indexOf(needle);
  if (first < 0 || source.folded.indexOf(needle, first + 1) >= 0) return null;
  const start = source.map[first];
  const lastIndex = source.map[first + needle.length - 1];
  // Extend to the end of the last source character (surrogate pairs).
  const end = lastIndex + (sourceText.codePointAt(lastIndex)! > 0xffff ? 2 : 1);
  return sourceText.slice(start, end);
}
