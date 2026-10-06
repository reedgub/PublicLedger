import { describe, expect, it } from "vitest";
import { captureModeFor, dedupeRows, locateQuote, manualRowSchema, parseXStatusUrl, statedProbability } from "@/lib/sources/manualImport";

const row = (overrides: Record<string, unknown> = {}) => manualRowSchema.parse({
  expertSlug: "jason-calacanis",
  sourcePath: "https://x.com/Jason/status/2106409025973989701",
  sourceQuote: "Wayve will have a driver out in commercial service within 12 months.",
  normalizedClaim: "Wayve will run commercial driverless service within 12 months.",
  resolutionCriteria: "Company announcement of commercial driverless operations by 2027-10-03.",
  resolutionDate: "2027-10-03",
  category: "ai-tech",
  ...overrides,
});

describe("manual import", () => {
  it("parses X status URLs and ignores other hosts", () => {
    expect(parseXStatusUrl("https://x.com/Jason/status/2106409025973989701")).toEqual({ handle: "Jason", id: "2106409025973989701" });
    expect(parseXStatusUrl("https://twitter.com/paulg/status/123?s=20")).toEqual({ handle: "paulg", id: "123" });
    expect(parseXStatusUrl("https://www.cnbc.com/video/2026/09/25/x.html")).toBeNull();
  });

  it("collapses the same quote pasted twice", () => {
    expect(dedupeRows([row(), row({ normalizedClaim: "reworded" }), row({ sourceQuote: "something else" })])).toHaveLength(2);
  });

  it("only accepts contiguous quotes and returns the exact source slice with a bounded excerpt", () => {
    const text = `${"x".repeat(3000)} He said: “If I had to pin it, I’d say the most explosive rally will be late 2027, early 2028.” ${"y".repeat(3000)}`;
    const located = locateQuote(text, "the most explosive rally will be late 2027, early 2028");
    expect(located?.quote).toBe("the most explosive rally will be late 2027, early 2028");
    expect(located!.excerpt.length).toBeLessThan(3000);
    expect(locateQuote(text, "If I had to pin it, I'd say the most explosive")?.quote).toBe("If I had to pin it, I’d say the most explosive");
    expect(locateQuote(text, "If I had to pin it ... early 2028")).toBeNull();
    expect(locateQuote(text, "Bitcoin will hit $1 million")).toBeNull();
  });

  it("treats statements older than a week as backfill", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    expect(captureModeFor(new Date("2026-10-03T15:40:21Z"), now)).toBe("live");
    expect(captureModeFor(new Date("2026-09-11T00:00:00Z"), now)).toBe("backfill");
  });

  it("keeps only probabilities the quote states", () => {
    expect(statedProbability("roughly a 50% chance of AGI by the end of the decade.", 0.5)).toBe(0.5);
    expect(statedProbability("85-90% Dem House takeover, Senate toss-up", 0.875)).toBeNull();
    expect(statedProbability("a 150% gain", 0.5)).toBeNull();
    expect(statedProbability("no number here", null)).toBeNull();
  });
});
