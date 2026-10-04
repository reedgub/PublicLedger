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
      className="group block rounded-[20px] border border-border bg-muted px-6 py-8 transition-colors hover:bg-secondary sm:px-12 sm:py-12"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow flex items-center gap-2"><span className="hatch text-foreground" />{prediction.resolution ? "Resolved prediction" : "Open prediction"}</p>
        <StatusBadge status={outcome} />
      </div>
      <p className="editorial mt-8 text-3xl leading-[1.08] sm:text-5xl">
        &ldquo;{prediction.sourceQuote}&rdquo;
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{prediction.expert.displayName}</span>
        {prediction.source.authorHandle && <span className="metric">@{prediction.source.authorHandle}</span>}
        <span className="metric">{formatUtcDate(prediction.predictionDate)}</span>
        {category && <span>· {category}</span>}
      </div>
      {prediction.resolution && (
        <div className="mt-10 border-t border-border pt-8">
          <p className="eyebrow">The verdict</p>
          <p className="editorial mt-3 text-3xl leading-[1.1] sm:text-4xl">{verdict}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{prediction.resolution.explanation}</p>
        </div>
      )}
      <div className="mt-10 flex items-center justify-between border-t border-border pt-5 font-mono text-[11px] tracking-[0.04em] uppercase text-muted-foreground">
        <span>Source · deadline · audit trail</span>
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-foreground text-background"><ArrowUpRight className="size-4" /></span>
      </div>
    </Link>
  );
}
