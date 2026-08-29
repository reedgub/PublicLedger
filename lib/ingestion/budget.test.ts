import { describe, expect, it } from "vitest";
import { createBudgetTracker } from "@/lib/ingestion/budget";

describe("createBudgetTracker", () => {
  it("starts under both caps at zero spend", () => {
    const t = createBudgetTracker(0);
    expect(t.snapshot().spentUsd).toBe(0);
    expect(t.ensureUnderSoft()).toBe(true);
    expect(t.ensureUnderHard()).toBe(true);
  });

  it("crosses the soft cap before the hard cap", () => {
    const t = createBudgetTracker(0);
    t.spend(3.5);
    expect(t.ensureUnderSoft()).toBe(false);
    expect(t.ensureUnderHard()).toBe(true);
  });

  it("stops spending past the hard cap", () => {
    const t = createBudgetTracker(4.99);
    t.spend(1);
    expect(t.ensureUnderHard()).toBe(false);
    expect(t.snapshot().remainingHardUsd).toBe(0);
  });

  it("clamps negative spend to zero", () => {
    const t = createBudgetTracker(0);
    t.spend(-1);
    expect(t.snapshot().spentUsd).toBe(0);
  });
});
