import { describe, expect, it } from "vitest";
import { computeNextWindow, type ExpertCheckpoint } from "@/lib/ingestion/checkpoints";

const NOW = new Date("2026-08-29T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

function checkpoint(overrides: Partial<ExpertCheckpoint>): ExpertCheckpoint {
  return {
    expertId: "e1",
    sourceType: "x",
    lastStartedAt: null,
    lastSuccessAt: null,
    lastFromDate: null,
    lastToDate: null,
    lastStatus: null,
    lastError: null,
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("computeNextWindow", () => {
  it("uses backfillDays for first-run experts", () => {
    const w = computeNextWindow(null, { now: NOW, backfillDays: 90 })!;
    expect(new Date(w.toDate).getTime()).toBe(NOW.getTime());
    expect(NOW.getTime() - new Date(w.fromDate).getTime()).toBe(90 * day);
  });

  it("overlaps 2 days back from last success", () => {
    const last = new Date(NOW.getTime() - 7 * day).toISOString();
    const w = computeNextWindow(checkpoint({ lastSuccessAt: last }), { now: NOW })!;
    expect(new Date(w.fromDate).getTime()).toBe(new Date(last).getTime() - 2 * day);
  });

  it("clamps recovery to 30 days when the checkpoint is stale", () => {
    const last = new Date(NOW.getTime() - 120 * day).toISOString();
    const w = computeNextWindow(checkpoint({ lastSuccessAt: last }), { now: NOW })!;
    expect(NOW.getTime() - new Date(w.fromDate).getTime()).toBe(30 * day);
  });

  it("returns null if the computed range is empty", () => {
    const future = new Date(NOW.getTime() + day).toISOString();
    expect(computeNextWindow(checkpoint({ lastSuccessAt: future }), { now: NOW })).not.toBeNull();
  });
});
