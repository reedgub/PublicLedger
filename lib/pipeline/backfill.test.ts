import { describe, expect, it } from "vitest";
import { groupWindows, monthsAgo, planMonthlyPeriods, prioritizePeriods, priorityBand } from "@/lib/pipeline/coverage";
import { extractMentions } from "@/lib/pipeline/discovery";
import { forecastCost, DEFAULT_RATIOS } from "@/lib/pipeline/estimate";
import { excerptAppears, normalizeForMatch, pageTextFromHtml } from "@/lib/resolution/evidence";
import { canAutoResolve } from "@/lib/resolution/resolve";
import type { ResolutionProposal } from "@/lib/ai/schemas";

const now = new Date("2026-10-05T12:00:00Z");

describe("backfill coverage planning", () => {
  it("plans whole months ending before the current month", () => {
    const periods = planMonthlyPeriods(now, 2);
    expect(periods).toHaveLength(24);
    expect(periods[0].start.toISOString()).toBe("2024-10-01T00:00:00.000Z");
    expect(periods[periods.length - 1].end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    for (const period of periods) expect(period.end > period.start).toBe(true);
  });

  it("visits resolvable months (12–36 months old) first, newest first", () => {
    const ordered = prioritizePeriods(planMonthlyPeriods(now, 5), now);
    expect(monthsAgo(ordered[0], now)).toBe(12);
    expect(priorityBand(ordered[0], now)).toBe(0);
    const bands = ordered.map((period) => priorityBand(period, now));
    expect(bands).toEqual([...bands].sort((a, b) => a - b));
    expect(monthsAgo(ordered[ordered.length - 1], now)).toBe(60);
    const firstRecent = ordered.find((period) => priorityBand(period, now) === 1)!;
    expect(monthsAgo(firstRecent, now)).toBe(1);
  });
});

describe("cost forecast", () => {
  it("scales with volume and is dominated by X reads at default prices", () => {
    const small = forecastCost({ xPosts: 1000, audioHours: 0, writingDocs: 0, ratios: DEFAULT_RATIOS, withScreen: true });
    const large = forecastCost({ xPosts: 10_000, audioHours: 0, writingDocs: 0, ratios: DEFAULT_RATIOS, withScreen: true });
    expect(large.totalUsd).toBeGreaterThan(small.totalUsd * 9);
    expect(small.xReadUsd).toBeGreaterThan(small.screenUsd + small.extractUsd + small.verifyUsd);
    expect(small.expectedCandidates).toBeGreaterThan(0);
  });
});

describe("expert discovery", () => {
  it("extracts distinct mentions and ignores email addresses", () => {
    expect(extractMentions("Agree with @NateSilver538 and @nateSILVER538, cc @elerianm. mail me a@b.com")).toEqual(["natesilver538", "elerianm"]);
  });
});

describe("resolution evidence", () => {
  it("matches excerpts despite typography and whitespace differences", () => {
    const page = pageTextFromHtml("<html><body><nav>Menu</nav><p>The unemployment rate rose to 4.1 percent in June, the Bureau’s report said.</p></body></html>");
    expect(excerptAppears(page, "The unemployment rate rose to 4.1 percent in June, the Bureau's report said.")).toBe(true);
    expect(excerptAppears(page, "The unemployment rate fell to 3.2 percent")).toBe(false);
    expect(excerptAppears(page, "short")).toBe(false);
    expect(normalizeForMatch("A  “B” — c")).toBe('a "b" - c');
  });

  it("only auto-resolves on confirmed evidence", () => {
    const proposal: ResolutionProposal = {
      proposed_outcome: "correct", confidence: 0.99, explanation: "x", scoring_eligible: true,
      evidence: [{ title: "BLS", source_path: "https://www.bls.gov/news.release/empsit.nr0.htm", publisher: "BLS", excerpt: "e", is_primary_source: true }],
    };
    const verifier = { verdict: "approve" as const, confidence: 0.99, reason: "ok" };
    expect(canAutoResolve(proposal, verifier, proposal.evidence)).toBe(true);
    expect(canAutoResolve(proposal, verifier, [])).toBe(false);
  });
});

describe("window grouping", () => {
  const month = (y: number, m: number, estimated: number | null) => ({
    id: `${y}-${m}`, start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)), estimated,
  });

  it("merges adjacent low-volume months into one query window", () => {
    const windows = groupWindows([month(2024, 0, 3), month(2024, 1, 5), month(2024, 2, 2)]);
    expect(windows).toHaveLength(1);
    expect(windows[0].rows).toHaveLength(3);
    expect(windows[0].estimated).toBe(10);
    expect(windows[0].end.toISOString()).toBe("2024-04-01T00:00:00.000Z");
  });

  it("splits on volume, gaps, unknown counts and the month cap", () => {
    expect(groupWindows([month(2024, 0, 300), month(2024, 1, 300)], { maxItems: 450 })).toHaveLength(2);
    expect(groupWindows([month(2024, 0, 1), month(2024, 2, 1)])).toHaveLength(2);
    expect(groupWindows([month(2024, 0, 1), month(2024, 1, null), month(2024, 2, 1)])).toHaveLength(3);
    const year = Array.from({ length: 24 }, (_, index) => month(2023, index, 1));
    expect(groupWindows(year, { maxMonths: 12 }).map((window) => window.rows.length)).toEqual([12, 12]);
  });
});
