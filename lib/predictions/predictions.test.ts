import { describe, expect, it } from "vitest";
import { predictionFingerprint } from "@/lib/predictions/fingerprint";
import { scorePredictionHeuristic } from "@/lib/predictions/heuristics";
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
});

describe("confidence language is the author's own words", () => {
  it("keeps verbatim wording and drops paraphrases, truncations and inventions", async () => {
    const { statedConfidence } = await import("@/lib/predictions/validation");
    const quote = "(For what it is worth, I am in the 25 bps camp regarding what the Fed will ultimately do.)";
    expect(statedConfidence(quote, "I am in the 25 bps camp")).toBe("I am in the 25 bps camp");
    expect(statedConfidence(quote, " I am in the 25 bps camp ")).toBe("I am in the 25 bps camp");
    expect(statedConfidence(quote, "For what it is worth, I am in the...")).toBeNull();
    expect(statedConfidence("No, AI is not going to kill all humans by 2030.", "categorical ('is not going to')")).toBeNull();
    expect(statedConfidence("A gift to the dems in the midterms, though.", "will be")).toBeNull();
    expect(statedConfidence(quote, "")).toBeNull();
    expect(statedConfidence(quote, null)).toBeNull();
  });
});

describe("probabilities are never inferred", () => {
  it("accepts percentages phrased as probabilities", async () => {
    const { probabilityIsStated } = await import("@/lib/predictions/validation");
    expect(probabilityIsStated("roughly a 50% chance of AGI by the end of the decade", 0.5)).toBe(true);
    expect(probabilityIsStated("I'd put the odds at 60% that it passes", 0.6)).toBe(true);
    expect(probabilityIsStated("I am 90 per cent confident", 0.9)).toBe(true);
    expect(probabilityIsStated("a 33.3 percent chance", 0.333)).toBe(true);
    expect(probabilityIsStated("Republicans have an 84-in-100 chance of taking control", 0.84)).toBe(true);
    expect(probabilityIsStated("about 30 out of 100 odds", 0.3)).toBe(true);
    expect(probabilityIsStated("72% D probability of House majority", 0.72)).toBe(true);
    expect(probabilityIsStated("Kamala Harris won in 40,012 (50.015%) cases. She did not win in 39,988 simulations (49.985%).", 0.50015)).toBe(true);
    expect(probabilityIsStated("Democrats win the House in 72% of our simulations", 0.72)).toBe(true);
    expect(probabilityIsStated("anything", null)).toBe(true);
  });

  it("rejects thresholds, ranges and qualitative language", async () => {
    const { probabilityIsStated } = await import("@/lib/predictions/validation");
    expect(probabilityIsStated("there is a 70% chance rates fall below 3% by 2027", 0.03)).toBe(false);
    expect(probabilityIsStated("85-90% Dem House takeover", 0.875)).toBe(false);
    expect(probabilityIsStated("a 150% gain", 0.5)).toBe(false);
    expect(probabilityIsStated("very likely", 0.8)).toBe(false);
    expect(probabilityIsStated("more likely than not", 0.5)).toBe(false);
    expect(probabilityIsStated("probably in the three quarters range", 0.75)).toBe(false);
    expect(probabilityIsStated("Biden 6535, approaching 7030.", 0.65)).toBe(false);
    expect(probabilityIsStated("an 85-90% chance Democrats retake the House", 0.875)).toBe(false);
    // A threshold followed by an unrelated word and then a probability word elsewhere still doesn't count.
    expect(probabilityIsStated("rates fall below 3% by 2027, likely", 0.03)).toBe(false);
    expect(probabilityIsStated("inflation falls below 3% very likely", 0.03)).toBe(false);
    // The other side's share in the same sentence is not the stated probability of this outcome's value.
    expect(probabilityIsStated("Kamala Harris won in 40,012 (50.015%) cases.", 0.6)).toBe(false);
  });

  it("rejects a candidate whose probability the quote does not state", () => {
    const result = validateExtractedPrediction("Inflation will very likely fall below 3% by 2027.", "2026-01-01Z", {
      normalized_claim: "Inflation falls below 3% by 2027.", source_quote: "Inflation will very likely fall below 3% by 2027.",
      resolution_date: "2027-12-31", resolution_criteria: "CPI YoY below 3%.", explicit_probability: 0.8, category: "economy-rates",
    });
    expect(result.errors).toContain("probability_not_stated_in_quote");
  });

  it("allows a deadline on the day of the statement", () => {
    const result = validateExtractedPrediction("It closes today.", "2026-05-04T18:30:00Z", {
      normalized_claim: "It closes today.", source_quote: "It closes today.", resolution_date: "2026-05-04",
      resolution_criteria: "Closing announced.", explicit_probability: null, category: "other",
    });
    expect(result.errors).not.toContain("resolution_before_prediction");
  });
});
