import Link from "next/link";
import { formatUtcDate } from "@/lib/dates";
import { ArrowUpRight, BarChart3 } from "lucide-react";
import type { Market } from "@/types/domain";

const formatMoney = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", style: "currency", currency: "USD", maximumFractionDigits: 1 }).format(value);

export function MarketCard({ market, topicHref }: { market: Market; topicHref?: string }) {
  const probability = market.yesProbability === null ? "—" : `${Math.round(market.yesProbability * 100)}%`;
  return (
    <article className="group flex min-h-[250px] flex-col border border-foreground bg-card p-4 transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <span className="eyebrow flex items-center gap-1.5"><span className="size-1.5 bg-provisional" />Happening now</span>
        <BarChart3 className="size-4 text-muted-foreground" />
      </div>
      <h3 className="editorial mt-5 text-xl font-semibold leading-tight text-balance">{market.question}</h3>
      <div className="mt-auto pt-8">
        <div className="flex items-end justify-between border-b border-border pb-3">
          <span className="eyebrow">Implied Yes</span>
          <span className="metric text-4xl font-semibold tracking-[-0.08em]">{probability}</span>
        </div>
        <dl className="metric grid grid-cols-2 gap-3 pt-3 text-[10px] uppercase">
          <div><dt className="text-muted-foreground">Volume</dt><dd className="mt-1 text-xs">{formatMoney(market.volume)}</dd></div>
          <div><dt className="text-muted-foreground">Deadline</dt><dd className="mt-1 text-xs">{market.endAt ? formatUtcDate(market.endAt) : "Open"}</dd></div>
        </dl>
        {topicHref && <Link href={topicHref} className="mt-4 flex items-center justify-between border-t pt-3 text-xs font-semibold uppercase tracking-[0.08em]">View topic <ArrowUpRight className="size-4" /></Link>}
      </div>
    </article>
  );
}
