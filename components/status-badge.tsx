import { Badge } from "@/components/ui/badge";
import type { PredictionStatus, ResolutionOutcome } from "@/types/domain";

const labels: Record<PredictionStatus | ResolutionOutcome, string> = {
  open: "Open", due: "Due", resolution_pending: "Resolution pending", resolved: "Resolved",
  source_unavailable: "Source unavailable", correct: "Correct", incorrect: "Incorrect", partial: "Partial",
  ambiguous: "Ambiguous", void: "Void",
};

export function StatusBadge({ status }: { status: PredictionStatus | ResolutionOutcome }) {
  const color = status === "correct" ? "border-correct/40 bg-correct/10 text-correct"
    : status === "incorrect" ? "border-incorrect/40 bg-incorrect/10 text-incorrect"
      : "border-border bg-muted text-foreground";
  return <Badge variant="outline" className={`metric rounded-full px-2.5 py-0.5 text-[10px] tracking-[0.06em] uppercase ${color}`}>{labels[status]}</Badge>;
}
