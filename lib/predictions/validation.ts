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
  } else if (Number.isNaN(new Date(candidate.resolution_date).getTime())) {
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
