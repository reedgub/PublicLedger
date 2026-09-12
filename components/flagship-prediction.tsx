import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { CATEGORIES } from "@/lib/constants";
import { formatUtcDate } from "@/lib/dates";
import type { Prediction } from "@/types/domain";

// The single most important piece of content on the homepage: one resolved
// prediction shown almost at full-page fidelity. First-time visitors need to
// see the payoff (the verdict, next to the exact original quote) before they
// see aggregate stats — the aggregate story only lands after they believe the
// atomic story.

export function FlagshipPrediction({ prediction }: { prediction: Prediction }) {
  const outcome = prediction.resolution?.outcome ?? prediction.status;
  const category = CATEGORIES.find((item) => item.slug === prediction.categorySlug)?.name;
  const verdict = prediction.resolution
    ? prediction.resolution.outcome === "correct" ? "They were right."
      : prediction.resolution.outcome === "incorrect" ? "They were wrong."
        : prediction.resolution.outcome === "partial" ? "Partly right."
          : prediction.resolution.outcome === "ambiguous" ? "The evidence was ambiguous."
            : "Void."
    : "Still open.";
  return (
    <Link
      href={`/predictions/${prediction.id}`}
      className="group block border-y border-foreground bg-card px-5 py-7 transition hover:bg-muted sm:px-10 sm:py-10"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow flex items-center gap-2"><span className="h-px w-6 bg-foreground" />{prediction.resolution ? "Resolved prediction" : "Open prediction"}</p>
        <StatusBadge status={outcome} />
      </div>
      <p className="editorial mt-5 text-2xl font-semibold leading-[1.1] tracking-[-0.02em] sm:text-4xl">
        &ldquo;{prediction.sourceQuote}&rdquo;
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{prediction.expert.displayName}</span>
        {prediction.source.authorHandle && <span className="metric">@{prediction.source.authorHandle}</span>}
        <span className="metric">{formatUtcDate(prediction.predictionDate)}</span>
        {category && <span>· {category}</span>}
      </div>
      {prediction.resolution && (
        <div className="mt-7 border-t border-dashed border-border pt-5">
          <p className="eyebrow">The verdict</p>
          <p className="editorial mt-2 text-2xl font-semibold leading-[1.15] tracking-[-0.02em] sm:text-3xl">{verdict}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{prediction.resolution.explanation}</p>
        </div>
      )}
      <div className="mt-6 flex items-center justify-between border-t border-foreground pt-3 text-[10px] tracking-[0.14em] uppercase">
        <span>Source · deadline · audit trail</span>
        <ArrowUpRight className="size-4 opacity-40 group-hover:opacity-100" />
      </div>
    </Link>
  );
}
