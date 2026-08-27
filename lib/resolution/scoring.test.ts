import { describe, expect, it } from "vitest";
import { assertResolutionScoring, isScoringEligibleOutcome } from "@/lib/resolution/scoring";

describe("resolution scoring eligibility", () => {
  it("only scores correct and incorrect outcomes", () => {
    expect(isScoringEligibleOutcome("correct")).toBe(true);
    expect(isScoringEligibleOutcome("partial")).toBe(false);
    expect(() => assertResolutionScoring("ambiguous", true)).toThrow();
  });
});
