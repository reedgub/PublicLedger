import { describe, expect, it } from "vitest";
import { formatUtcAuditTime, formatUtcDate, formatUtcDateTime } from "@/lib/dates";

describe("UTC display formatting", () => {
  it("does not relabel local time as UTC", () => {
    const value = "2026-01-15T12:05:00.000Z";
    expect(formatUtcDate(value)).toBe("Jan 15, 2026");
    expect(formatUtcDateTime(value)).toBe("Jan 15, 2026 · 12:05 UTC");
    expect(formatUtcAuditTime(value)).toBe("2026-01-15 12:05 UTC");
  });

  it("fails closed for invalid data", () => {
    expect(formatUtcDate("not-a-date")).toBe("—");
  });
});
