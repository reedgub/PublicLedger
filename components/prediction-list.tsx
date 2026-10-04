import Link from "next/link";
import { formatUtcDate } from "@/lib/dates";
import { ArrowUpRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { CATEGORIES } from "@/lib/constants";
import type { Prediction } from "@/types/domain";

export function PredictionList({ predictions }: { predictions: Prediction[] }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
      {predictions.map((prediction) => {
        const status = prediction.resolution?.outcome ?? prediction.status;
        return (
          <Link key={prediction.id} href={`/predictions/${prediction.id}`} className="group grid gap-3 px-5 py-6 transition-colors hover:bg-muted sm:grid-cols-[150px_1fr_auto] sm:items-start sm:px-7">
            <div>
              <p className="font-medium">{prediction.expert.displayName}</p>
              <p className="metric mt-1 text-[10px] text-muted-foreground">{formatUtcDate(prediction.predictionDate)}</p>
            </div>
            <div>
              <p className="editorial text-xl leading-snug">{prediction.normalizedClaim}</p>
              <p className="eyebrow mt-2">{CATEGORIES.find((item) => item.slug === prediction.categorySlug)?.shortName}</p>
            </div>
            <div className="flex items-center gap-3 sm:justify-end">
              {prediction.recordType === "take" && (
                <span className="rounded-full border border-provisional/40 px-2 py-0.5 font-mono text-[9px] text-provisional uppercase tracking-[0.08em]">Take</span>
              )}
              <StatusBadge status={status} />
              <span className="flex size-8 items-center justify-center rounded-[10px] border border-border transition-colors group-hover:bg-foreground group-hover:text-background"><ArrowUpRight className="size-4" /></span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
