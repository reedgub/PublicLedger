import { shortDate, type LedgerMark } from "@/lib/leaderboard/ledger";

const MAX_MARKS = 28;

const stateLabel: Record<LedgerMark["state"], string> = {
  correct: "Correct",
  incorrect: "Incorrect",
  partial: "Partial",
  ambiguous: "Ambiguous",
  void: "Void",
  open: "Open",
};

function markClass(state: LedgerMark["state"]): string {
  if (state === "correct") return "bg-correct";
  if (state === "incorrect") return "bg-incorrect";
  // Open calls are dim bars: on the record, not yet a verdict.
  if (state === "open") return "bg-foreground/15";
  // Partial, ambiguous and void are not wins or losses: neutral fill.
  return "bg-foreground/45";
}

/**
 * One mark per published prediction, verdicts first then open calls by
 * deadline. Green/red are approved verdicts; dim marks are still open and
 * never count toward accuracy.
 */
export function LedgerStrip({ marks, className = "" }: { marks: LedgerMark[]; className?: string }) {
  if (marks.length === 0) return <span className="metric text-[10px] text-muted-foreground">No predictions yet</span>;
  const shown = marks.slice(0, MAX_MARKS);
  const hidden = marks.length - shown.length;
  const verdicts = marks.filter((mark) => mark.state === "correct" || mark.state === "incorrect").length;
  return (
    <span
      className={`flex flex-wrap items-center gap-[3px] ${className}`}
      role="img"
      aria-label={`${marks.length} predictions on the record, ${verdicts} with a verdict, ${marks.filter((mark) => mark.state === "open").length} still open`}
    >
      {shown.map((mark) => (
        <span
          key={mark.id}
          title={`${stateLabel[mark.state]} · ${shortDate(mark.resolutionDate)} — ${mark.claim}`}
          className={`block h-3 w-1.5 rounded-full ${markClass(mark.state)}`}
        />
      ))}
      {hidden > 0 && <span className="metric ml-1 text-[10px] text-muted-foreground">+{hidden}</span>}
    </span>
  );
}

export function LedgerLegend() {
  return (
    <span className="eyebrow flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="block h-3 w-1.5 rounded-full bg-correct" />Correct</span>
      <span className="flex items-center gap-1.5"><span className="block h-3 w-1.5 rounded-full bg-incorrect" />Incorrect</span>
      <span className="flex items-center gap-1.5"><span className="block h-3 w-1.5 rounded-full bg-foreground/45" />Partial / void</span>
      <span className="flex items-center gap-1.5"><span className="block h-3 w-1.5 rounded-full bg-foreground/15" />Open, not scored</span>
    </span>
  );
}
