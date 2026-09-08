import { CATEGORY_SLUGS, type CategorySlug } from "@/lib/constants";

export type ExtractedPredictionForValidation = {
  normalized_claim: string;
  source_quote: string;
  resolution_date: string | null;
  resolution_criteria: string;
  explicit_probability: number | null;
  category: CategorySlug;
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
  if (!isLiteralSourceQuote(sourceText, candidate.source_quote)) errors.push("source_quote_not_literal");
  if (!candidate.normalized_claim.trim()) errors.push("normalized_claim_empty");
  if (!candidate.resolution_criteria.trim()) errors.push("resolution_criteria_empty");
  if (!CATEGORY_SLUGS.includes(candidate.category)) errors.push("invalid_category");
  if (candidate.explicit_probability !== null && (candidate.explicit_probability < 0 || candidate.explicit_probability > 1)) {
    errors.push("invalid_probability");
  }
  // A prediction without a defensible deadline is not falsifiable and not a
  // Project Lighthouse candidate — reject at extraction time so it never
  // reaches the review queue or the auto-publish gate.
  if (!candidate.resolution_date) {
    errors.push("resolution_date_missing");
  } else if (Number.isNaN(new Date(candidate.resolution_date).getTime())) {
    errors.push("resolution_date_invalid");
  } else if (new Date(candidate.resolution_date) < new Date(predictionDate)) {
    errors.push("resolution_before_prediction");
  }
  return { valid: errors.length === 0, errors };
}
