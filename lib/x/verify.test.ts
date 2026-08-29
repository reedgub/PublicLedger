import { describe, expect, it } from "vitest";
import { normalizeForCompare, quoteIsPresent } from "@/lib/x/verify";

describe("normalizeForCompare", () => {
  it("collapses whitespace but preserves words", () => {
    expect(normalizeForCompare("hello   world\n\n")).toBe("hello world");
  });

  it("normalizes curly quotes to straight quotes", () => {
    expect(normalizeForCompare("“smart” ‘quotes’")).toBe('"smart" \'quotes\'');
  });

  it("does not alter numbers, dates, or negations", () => {
    const raw = "In 2026 Q1 not going to hit 3.5% — 0.42 probability";
    expect(normalizeForCompare(raw)).toContain("3.5%");
    expect(normalizeForCompare(raw)).toContain("0.42");
    expect(normalizeForCompare(raw)).toContain("not going to hit");
  });
});

describe("quoteIsPresent", () => {
  const body =
    "I think the Fed cuts twice by June. Then “inflation” prints under 2.5% by year-end.";

  it("finds an exact substring", () => {
    expect(quoteIsPresent("Fed cuts twice by June", body)).toBe(true);
  });

  it("finds across curly-quote normalization", () => {
    expect(quoteIsPresent('"inflation" prints under 2.5%', body)).toBe(true);
  });

  it("rejects invented content", () => {
    expect(quoteIsPresent("Fed cuts THREE times by June", body)).toBe(false);
  });

  it("rejects too-short quotes", () => {
    expect(quoteIsPresent("Fed", body)).toBe(false);
  });

  it("handles undefined inputs", () => {
    expect(quoteIsPresent(null, body)).toBe(false);
    expect(quoteIsPresent("x", undefined)).toBe(false);
  });
});
