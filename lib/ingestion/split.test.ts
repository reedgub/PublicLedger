import { describe, expect, it } from "vitest";
import { createSaturationQueue, splitWindow } from "@/lib/ingestion/split";

describe("splitWindow", () => {
  it("halves a wide window", () => {
    const parts = splitWindow({ fromDate: "2026-01-01T00:00:00Z", toDate: "2026-01-11T00:00:00Z" });
    expect(parts).not.toBeNull();
    expect(parts![0].fromDate).toBe("2026-01-01T00:00:00Z");
    expect(parts![0].toDate).toBe(parts![1].fromDate);
    expect(parts![1].toDate).toBe("2026-01-11T00:00:00Z");
  });

  it("refuses to split a 1-day window", () => {
    expect(splitWindow({ fromDate: "2026-01-01T00:00:00Z", toDate: "2026-01-02T00:00:00Z" })).toBeNull();
  });

  it("returns null for inverted windows", () => {
    expect(splitWindow({ fromDate: "2026-01-10T00:00:00Z", toDate: "2026-01-01T00:00:00Z" })).toBeNull();
  });
});

describe("createSaturationQueue", () => {
  it("advances linearly when nothing saturates", () => {
    const q = createSaturationQueue({ fromDate: "2026-01-01T00:00:00Z", toDate: "2026-01-15T00:00:00Z" });
    expect(q.next()).toEqual({ fromDate: "2026-01-01T00:00:00Z", toDate: "2026-01-15T00:00:00Z" });
    expect(q.next()).toBeNull();
  });

  it("re-splits when a window saturates", () => {
    const root = { fromDate: "2026-01-01T00:00:00Z", toDate: "2026-01-11T00:00:00Z" };
    const q = createSaturationQueue(root);
    const first = q.next()!;
    q.reportSaturated(first);
    const left = q.next()!;
    const right = q.next()!;
    expect(new Date(left.toDate).getTime()).toBeLessThan(new Date(right.toDate).getTime());
    expect(left.toDate).toBe(right.fromDate);
    expect(q.next()).toBeNull();
  });

  it("respects a max window cap", () => {
    const q = createSaturationQueue({ fromDate: "2026-01-01T00:00:00Z", toDate: "2026-02-01T00:00:00Z" }, { maxWindows: 2 });
    q.next();
    q.next();
    expect(q.next()).toBeNull();
  });
});
