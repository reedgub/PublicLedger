import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { CATEGORIES } from "@/lib/constants";
import { formatUtcDate } from "@/lib/dates";
import type { Prediction } from "@/types/domain";

// The single most important piece of content on the homepage: one resolved
// Receipt shown almost at full-Receipt fidelity. First-time visitors need to
// see the payoff (the outcome, next to the exact original quote) before they
// see aggregate stats — the aggregate story only lands after they believe
// the atomic story.

export function FlagshipReceipt({ prediction }: { prediction: Prediction }) {
  const outcome = prediction.resolution?.outcome ?? prediction.status;
  const category = CATEGORIES.find((item) => item.slug === prediction.categorySlug)?.name;
  const outcomeLabel = prediction.resolution
    ? prediction.resolution.outcome === "correct" ? "They were right"
      : prediction.resolution.outcome === "incorrect" ? "They were wrong"
        : prediction.resolution.outcome === "partial" ? "Partly right"
          : prediction.resolution.outcome === "ambiguous" ? "The evidence was ambiguous"
            : "Void"
    : "Currently open";
  return (
    <Link
      href={`/predictions/${prediction.id}`}
      className="group block border-y border-foreground bg-card px-5 py-8 transition hover:bg-muted sm:px-10 sm:py-12"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow flex items-center gap-2"><span className="h-px w-6 bg-foreground" />{prediction.resolution ? "Resolved receipt" : "Open receipt"}</p>
        <StatusBadge status={outcome} />
      </div>
      <p className="editorial mt-6 text-3xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
        &ldquo;{prediction.sourceQuote}&rdquo;
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{prediction.expert.displayName}</span>
        {prediction.source.authorHandle && <span className="metric">@{prediction.source.authorHandle}</span>}
        <span className="metric">{formatUtcDate(prediction.predictionDate)}</span>
        {category && <span>· {category}</span>}
      </div>
      {prediction.resolution && (
        <div className="mt-8 border-t border-dashed border-border pt-6">
          <p className="eyebrow">{outcomeLabel}</p>
          <p className="editorial mt-3 text-xl leading-snug sm:text-2xl">{prediction.resolution.explanation}</p>
        </div>
      )}
      <div className="mt-8 flex items-center justify-between border-t border-foreground pt-4 text-[10px] tracking-[0.14em] uppercase">
        <span>Full receipt · source · audit trail</span>
        <ArrowUpRight className="size-4 opacity-40 group-hover:opacity-100" />
      </div>
    </Link>
  );
}
