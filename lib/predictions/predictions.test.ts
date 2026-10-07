import { describe, expect, it } from "vitest";
import { predictionFingerprint } from "@/lib/predictions/fingerprint";
import { scorePredictionHeuristic } from "@/lib/predictions/heuristics";
import { canAutoPublish } from "@/lib/predictions/promotion";
import { isIsoDate, isLiteralSourceQuote, validateExtractedPrediction } from "@/lib/predictions/validation";

describe("prediction utilities", () => {
  it("keeps the heuristic permissive for concrete future claims", () => {
    expect(scorePredictionHeuristic("I expect inflation will fall below 3% by 2027.").shouldExtract).toBe(true);
    expect(scorePredictionHeuristic("Do you like this?").shouldExtract).toBe(false);
  });

  it("fingerprints canonical whitespace consistently", () => {
    const base = { expertId: "e", sourceId: "s", normalizedClaim: "Rates will fall.", predictionDate: "2026-01-01Z", resolutionDate: "2027-01-01Z", resolutionCriteria: "Official data records a fall.", explicitProbability: null };
    expect(predictionFingerprint(base)).toBe(predictionFingerprint({ ...base, normalizedClaim: "  Rates   will fall. " }));
  });

  it("requires an exact contiguous quote", () => {
    expect(isLiteralSourceQuote("Bitcoin will reach 200k.", "will reach 200k")).toBe(true);
    expect(isLiteralSourceQuote("Bitcoin will reach 200k.", "Bitcoin reaches $200,000")).toBe(false);
  });

  it("validates chronology and criteria", () => {
    const result = validateExtractedPrediction("It will happen.", "2026-01-01Z", {
      normalized_claim: "It will happen.", source_quote: "It will happen.", resolution_date: "2025-01-01",
      resolution_criteria: "An official record confirms it.", explicit_probability: null, category: "other",
    });
    expect(result.errors).toContain("resolution_before_prediction");
  });

  it("requires deadlines to be real YYYY-MM-DD dates", () => {
    expect(isIsoDate("2027-12-31")).toBe(true);
    for (const value of ["late 2027", "Q2 2027", "2027", "2026-02-30", "2027-13-01", "N/A", "", null]) expect(isIsoDate(value)).toBe(false);
    const result = validateExtractedPrediction("It will happen by late 2027.", "2026-01-01Z", {
      normalized_claim: "It will happen.", source_quote: "It will happen", resolution_date: "late 2027",
      resolution_criteria: "An official record confirms it.", explicit_probability: null, category: "other",
    });
    expect(result.errors).toContain("resolution_date_invalid");
  });

  it("rejects predictions without a resolution date", () => {
    const result = validateExtractedPrediction("It will happen someday.", "2026-01-01Z", {
      normalized_claim: "It will happen someday.",
      source_quote: "It will happen someday.",
      resolution_date: null,
      resolution_criteria: "An official record confirms it.",
      explicit_probability: null,
      category: "other",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("resolution_date_missing");
  });

  it("rejects a take that is missing an imputation note", () => {
    const result = validateExtractedPrediction("It will happen by 2027.", "2026-01-01Z", {
      normalized_claim: "It happens by 2027.",
      source_quote: "It will happen by 2027.",
      resolution_date: "2027-12-31",
      resolution_criteria: "A named public data source confirms it.",
      explicit_probability: null,
      category: "other",
      record_type: "take",
      imputation_note: null,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("take_missing_imputation_note");
  });

  it("accepts a take when the imputation note explains what was imputed", () => {
    const result = validateExtractedPrediction("It will happen by 2027.", "2026-01-01Z", {
      normalized_claim: "It happens by 2027.",
      source_quote: "It will happen by 2027.",
      resolution_date: "2027-12-31",
      resolution_criteria: "A named public data source confirms it.",
      explicit_probability: null,
      category: "other",
      record_type: "take",
      imputation_note: "Author said 'by 2027'; deadline pinned to year-end.",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts predictions with a valid future resolution date", () => {
    const result = validateExtractedPrediction("Inflation will fall below 3% by end of 2027.", "2026-01-01Z", {
      normalized_claim: "US CPI year-over-year will print below 3% for December 2027.",
      source_quote: "Inflation will fall below 3% by end of 2027.",
      resolution_date: "2027-12-31",
      resolution_criteria: "BLS December 2027 CPI YoY release shows <3.0%.",
      explicit_probability: null,
      category: "economy-rates",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("applies every auto-publication threshold", () => {
    const candidate = { sourceIsUsable: true, speakerIsAuthor: true, extractionConfidence: 0.93, sourceFidelityScore: 0.98, falsifiabilityScore: 0.9, verifierVerdict: "faithful", verifierConfidence: 0.96, sourceQuoteLiteral: true, hasResolutionCriteria: true, hasResolutionDate: true };
    expect(canAutoPublish(candidate)).toBe(true);
    expect(canAutoPublish({ ...candidate, sourceFidelityScore: 0.96 })).toBe(false);
  });
});
