import Link from "next/link";
import { formatUtcDate } from "@/lib/dates";
import { ArrowUpRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { CATEGORIES } from "@/lib/constants";
import type { Prediction } from "@/types/domain";

export function PredictionList({ predictions }: { predictions: Prediction[] }) {
  return (
    <div className="border-t border-foreground">
      {predictions.map((prediction) => {
        const status = prediction.resolution?.outcome ?? prediction.status;
        return (
          <Link key={prediction.id} href={`/predictions/${prediction.id}`} className="group grid gap-3 border-b border-border py-5 sm:grid-cols-[150px_1fr_auto] sm:items-start">
            <div>
              <p className="font-semibold">{prediction.expert.displayName}</p>
              <p className="metric mt-1 text-[10px] text-muted-foreground">{formatUtcDate(prediction.predictionDate)}</p>
            </div>
            <div>
              <p className="editorial text-xl font-medium leading-snug group-hover:underline group-hover:underline-offset-4">{prediction.normalizedClaim}</p>
              <p className="eyebrow mt-2">{CATEGORIES.find((item) => item.slug === prediction.categorySlug)?.shortName}</p>
            </div>
            <div className="flex items-center gap-3 sm:justify-end"><StatusBadge status={status} /><ArrowUpRight className="size-4 opacity-40 group-hover:opacity-100" /></div>
          </Link>
        );
      })}
    </div>
  );
}
