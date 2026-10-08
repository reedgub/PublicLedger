// Per-expert "ledger" for the leaderboard: every published prediction as a
// mark, scored or not. Open predictions are shown but never counted toward
// accuracy; only approved correct/incorrect resolutions are verdicts.

export type LedgerOutcome = "correct" | "incorrect" | "partial" | "ambiguous" | "void";

export type LedgerRow = {
  id: string;
  expertId: string;
  claim: string;
  resolutionDate: string | null;
  status: string;
  /** Approved resolution outcome, if any. */
  outcome: LedgerOutcome | null;
};

export type LedgerMark = {
  id: string;
  claim: string;
  resolutionDate: string | null;
  state: LedgerOutcome | "open";
};

export type ExpertLedger = {
  marks: LedgerMark[];
  open: number;
  nextDue: LedgerMark | null;
};

const time = (value: string | null) => (value ? new Date(value).getTime() : Number.POSITIVE_INFINITY);

/** Verdicts first (oldest deadline first), then open calls by deadline: the record reads left to right in time. */
export function buildLedgers(rows: LedgerRow[], now = new Date()): Map<string, ExpertLedger> {
  const byExpert = new Map<string, LedgerMark[]>();
  for (const row of rows) {
    const mark: LedgerMark = { id: row.id, claim: row.claim, resolutionDate: row.resolutionDate, state: row.outcome ?? "open" };
    const list = byExpert.get(row.expertId) ?? [];
    list.push(mark);
    byExpert.set(row.expertId, list);
  }
  const ledgers = new Map<string, ExpertLedger>();
  for (const [expertId, marks] of byExpert) {
    marks.sort((a, b) => Number(a.state === "open") - Number(b.state === "open") || time(a.resolutionDate) - time(b.resolutionDate));
    const open = marks.filter((mark) => mark.state === "open");
    const upcoming = open.filter((mark) => time(mark.resolutionDate) >= now.getTime());
    ledgers.set(expertId, { marks, open: open.length, nextDue: upcoming[0] ?? null });
  }
  return ledgers;
}

/** Soonest open predictions across all experts. */
export function comingDue<T extends LedgerRow>(rows: T[], limit: number, now = new Date()): T[] {
  return rows
    .filter((row) => row.outcome === null && time(row.resolutionDate) >= now.getTime())
    .sort((a, b) => time(a.resolutionDate) - time(b.resolutionDate))
    .slice(0, limit);
}

/** "today", "in 3 days", "in 5 weeks", "in 7 months", "in 4 years". */
export function countdown(date: string | null, now = new Date()): string {
  if (!date) return "no deadline";
  const days = Math.ceil((new Date(date).getTime() - now.getTime()) / 86_400_000);
  if (days <= 0) return "due now";
  if (days === 1) return "tomorrow";
  if (days < 21) return `in ${days} days`;
  if (days < 90) return `in ${Math.round(days / 7)} weeks`;
  if (days < 730) return `in ${Math.round(days / 30.44)} months`;
  return `in ${Math.round(days / 365.25)} years`;
}

export function shortDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
