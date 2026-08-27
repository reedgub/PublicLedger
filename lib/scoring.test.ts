import { describe, expect, it } from "vitest";
import { accuracy, brierScore, calibrationBuckets, wilsonLowerBound } from "@/lib/scoring";

describe("scoring", () => {
  it("computes binary accuracy and excludes non-binary outcomes upstream", () => {
    expect(accuracy(8, 2)).toBe(0.8);
    expect(accuracy(0, 0)).toBeNull();
  });

  it("computes an 80% Wilson lower bound", () => {
    expect(wilsonLowerBound(8, 10)).toBeCloseTo(0.602, 2);
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("computes Brier score", () => {
    expect(brierScore([{ probability: 0.8, outcome: 1 }, { probability: 0.25, outcome: 0 }])).toBeCloseTo(0.05125);
    expect(brierScore([])).toBeNull();
  });

  it("buckets calibration values with 100% in the final bucket", () => {
    const buckets = calibrationBuckets([{ probability: 0, outcome: 0 }, { probability: 0.2, outcome: 1 }, { probability: 1, outcome: 1 }]);
    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 1, 0, 0, 1]);
  });
});
