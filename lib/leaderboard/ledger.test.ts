import { describe, expect, it } from "vitest";
import { buildLedgers, comingDue, countdown, type LedgerRow } from "@/lib/leaderboard/ledger";

const now = new Date("2026-10-08T12:00:00Z");
const row = (id: string, expertId: string, resolutionDate: string | null, outcome: LedgerRow["outcome"] = null): LedgerRow => ({
  id, expertId, claim: `claim ${id}`, resolutionDate, status: outcome ? "resolved" : "open", outcome,
});

describe("leaderboard ledger", () => {
  const rows = [
    row("a", "e1", "2027-06-30"),
    row("b", "e1", "2026-03-01", "correct"),
    row("c", "e1", "2026-11-03"),
    row("d", "e1", "2025-12-31", "incorrect"),
    row("e", "e1", "2026-09-01"),
    row("f", "e2", "2030-12-31"),
  ];

  it("orders verdicts before open calls, each by deadline, and finds the next upcoming deadline", () => {
    const ledger = buildLedgers(rows, now).get("e1")!;
    expect(ledger.marks.map((mark) => mark.id)).toEqual(["d", "b", "e", "c", "a"]);
    expect(ledger.marks.map((mark) => mark.state)).toEqual(["incorrect", "correct", "open", "open", "open"]);
    expect(ledger.open).toBe(3);
    // "e" is past due but unresolved, so the next verdict to look forward to is "c".
    expect(ledger.nextDue?.id).toBe("c");
  });

  it("lists the soonest upcoming open calls across experts", () => {
    expect(comingDue(rows, 2, now).map((item) => item.id)).toEqual(["c", "a"]);
  });

  it("formats countdowns", () => {
    expect(countdown("2026-10-09", now)).toBe("tomorrow");
    expect(countdown("2026-10-15", now)).toBe("in 7 days");
    expect(countdown("2026-11-03", now)).toBe("in 4 weeks");
    expect(countdown("2027-06-30", now)).toBe("in 9 months");
    expect(countdown("2030-12-31", now)).toBe("in 4 years");
    expect(countdown("2026-10-01", now)).toBe("due now");
    expect(countdown(null, now)).toBe("no deadline");
  });
});
