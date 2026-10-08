"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ExpertAvatar } from "@/components/expert-avatar";
import { LedgerStrip } from "@/components/ledger-strip";
import { CATEGORIES } from "@/lib/constants";
import { track } from "@/lib/analytics/client";
import { countdown, shortDate, type ExpertLedger } from "@/lib/leaderboard/ledger";
import type { ExpertScorecard } from "@/types/domain";

type SortKey = "wilson" | "record" | "soonest" | "accuracy" | "calibration";

const percentage = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;
const decimal = (value: number | null) => value === null ? "—" : value.toFixed(3);
const EMPTY_LEDGER: ExpertLedger = { marks: [], open: 0, nextDue: null };

// Wilson stays the default ranking because raw accuracy rewards tiny samples.
// "On the record" and "Resolving soonest" surface experts whose calls are
// still open; open calls are shown, never scored.
const SORTS: Array<{ key: SortKey; label: string; description: string }> = [
  { key: "wilson", label: "Adjusted rank", description: "80% Wilson lower bound on verdicts" },
  { key: "record", label: "On the record", description: "Most published predictions" },
  { key: "soonest", label: "Resolving soonest", description: "Next verdict first" },
  { key: "accuracy", label: "Raw accuracy", description: "Ignores sample size" },
  { key: "calibration", label: "Calibration", description: "Lower Brier is better" },
];

const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : Number.POSITIVE_INFINITY);

function compare(a: ExpertScorecard, b: ExpertScorecard, key: SortKey, ledgers: Record<string, ExpertLedger>): number {
  const tie = b.totalPredictions - a.totalPredictions;
  if (key === "wilson") return (b.wilsonRankScore ?? -1) - (a.wilsonRankScore ?? -1) || tie;
  if (key === "record") return tie || b.resolvedPredictions - a.resolvedPredictions;
  if (key === "soonest") return time(ledgers[a.expert.slug]?.nextDue?.resolutionDate) - time(ledgers[b.expert.slug]?.nextDue?.resolutionDate) || tie;
  if (key === "accuracy") return (b.accuracy ?? -1) - (a.accuracy ?? -1) || tie;
  // Brier: lower is better; nulls sink.
  return (a.brierScore ?? Number.POSITIVE_INFINITY) - (b.brierScore ?? Number.POSITIVE_INFINITY) || tie;
}

function NextVerdict({ ledger, now }: { ledger: ExpertLedger; now: Date }) {
  const next = ledger.nextDue;
  if (!next) return <span className="metric text-[10px] text-muted-foreground">No upcoming deadline</span>;
  return (
    <span className="block" title={next.claim}>
      <span className="metric block">{shortDate(next.resolutionDate)}</span>
      <span className="eyebrow block text-muted-foreground">{countdown(next.resolutionDate, now)}</span>
    </span>
  );
}

export function LeaderboardTable({ scorecards, ledgers, nowIso }: { scorecards: ExpertScorecard[]; ledgers: Record<string, ExpertLedger>; nowIso: string }) {
  // Server render time, so countdowns match between server HTML and hydration.
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<SortKey>("wilson");
  const filtered = useMemo(
    () => scorecards.filter((row) => category === "all" || row.expert.primaryCategorySlug === category),
    [scorecards, category],
  );
  const sorted = useMemo(() => [...filtered].sort((a, b) => compare(a, b, sort, ledgers)), [filtered, sort, ledgers]);
  const active = SORTS.find((option) => option.key === sort) ?? SORTS[0];

  return (
    <>
      <div className="mt-8 flex gap-2 overflow-x-auto border-y border-border py-3">
        <button onClick={() => { setCategory("all"); track("leaderboard_filter", { category: "all" }); }} className={`metric shrink-0 rounded-[10px] border px-3.5 py-2 text-[11px] uppercase tracking-[0.04em] transition-colors ${category === "all" ? "border-transparent bg-foreground text-background" : "bg-card hover:bg-muted"}`}>All categories</button>
        {CATEGORIES.map((item) => <button key={item.slug} onClick={() => { setCategory(item.slug); track("leaderboard_filter", { category: item.slug }); }} className={`metric shrink-0 rounded-[10px] border px-3.5 py-2 text-[11px] uppercase tracking-[0.04em] transition-colors ${category === item.slug ? "border-transparent bg-foreground text-background" : "bg-card hover:bg-muted"}`}>{item.shortName}</button>)}
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto border-b border-border pb-3 sm:flex-wrap sm:items-center">
        <span className="eyebrow mr-2 hidden shrink-0 self-center sm:inline">Sort by</span>
        {SORTS.map((option) => (
          <button
            key={option.key}
            onClick={() => { setSort(option.key); track("leaderboard_sort", { sort: option.key }); }}
            title={option.description}
            className={`metric shrink-0 rounded-[10px] border px-3.5 py-2 text-[11px] uppercase tracking-[0.04em] transition-colors ${sort === option.key ? "border-transparent bg-foreground text-background" : "bg-card hover:bg-muted"}`}
          >
            {option.label}
          </button>
        ))}
        <span className="eyebrow ml-auto hidden shrink-0 self-center text-muted-foreground sm:inline">{active.description}</span>
      </div>

      <div className="mt-5 hidden overflow-x-auto rounded-[20px] border border-border md:block">
        <table className="w-full min-w-[1000px] border-collapse text-left text-xs">
          <thead className="border-b border-foreground/20 bg-muted">
            <tr>
              <th className="eyebrow px-3 py-3">Rank</th>
              <th className="eyebrow px-3 py-3">Expert</th>
              <th className="eyebrow px-3 py-3">On the record</th>
              <th className="eyebrow px-3 py-3 text-right">Accuracy</th>
              <th className="eyebrow px-3 py-3 text-right">Verdicts</th>
              <th className="eyebrow px-3 py-3 text-right">Adjusted</th>
              <th className="eyebrow px-3 py-3 text-right">Brier</th>
              <th className="eyebrow px-3 py-3 text-right">Next verdict</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => {
              const ledger = ledgers[row.expert.slug] ?? EMPTY_LEDGER;
              return (
                <tr key={row.expert.slug} className="border-b last:border-0 hover:bg-muted/60">
                  <td className="px-3 py-4 align-top"><span className="metric text-muted-foreground">{String(index + 1).padStart(2, "0")}</span></td>
                  <td className="px-3 py-4 align-top">
                    <Link href={`/experts/${row.expert.slug}`} className="flex items-center gap-3 hover:underline">
                      <ExpertAvatar expert={row.expert} size={32} />
                      <span>
                        <span className="block font-medium">{row.expert.displayName}</span>
                        <span className="metric text-[9px] font-normal text-muted-foreground">{row.expert.xHandle ? `@${row.expert.xHandle}` : row.expert.headline}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="w-[280px] px-3 py-4 align-top">
                    <LedgerStrip marks={ledger.marks} />
                    <span className="eyebrow mt-2 block whitespace-nowrap text-muted-foreground">
                      {row.totalPredictions} predictions · {ledger.open} open{row.totalTakes ? ` · ${row.totalTakes} ${row.totalTakes === 1 ? "take" : "takes"}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-4 text-right align-top">
                    <span className="metric text-2xl leading-none">{percentage(row.accuracy)}</span>
                    {row.resolvedPredictions === 0 && <span className="eyebrow mt-1 block text-muted-foreground">Awaiting verdicts</span>}
                  </td>
                  <td className="px-3 py-4 text-right align-top">
                    <span className="metric">{row.correctPredictions} / {row.resolvedPredictions}</span>
                    <span className="eyebrow block">correct / resolved</span>
                  </td>
                  <td className="px-3 py-4 text-right align-top"><span className="metric">{decimal(row.wilsonRankScore)}</span></td>
                  <td className="px-3 py-4 text-right align-top"><span className="metric">{decimal(row.brierScore)}</span></td>
                  <td className="px-3 py-4 text-right align-top"><NextVerdict ledger={ledger} now={now} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-3 md:hidden">
        {sorted.map((row, index) => {
          const ledger = ledgers[row.expert.slug] ?? EMPTY_LEDGER;
          return (
            <Link key={row.expert.slug} href={`/experts/${row.expert.slug}`} className="rounded-[20px] border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <span className="metric text-muted-foreground">#{index + 1}</span>
                <ExpertAvatar expert={row.expert} size={32} />
                <h2 className="min-w-0 truncate text-[22px] tracking-[-0.03em]">{row.expert.displayName}</h2>
              </div>
              <div className="mt-4 flex items-baseline gap-4 border-t pt-3">
                <span className="metric text-5xl leading-none">{percentage(row.accuracy)}</span>
                <span className="eyebrow">
                  {row.resolvedPredictions === 0 ? "Awaiting verdicts" : `${row.correctPredictions}/${row.resolvedPredictions} · Adj ${decimal(row.wilsonRankScore)}`}
                </span>
              </div>
              <div className="mt-4">
                <LedgerStrip marks={ledger.marks} />
                <span className="eyebrow mt-2 block text-muted-foreground">{row.totalPredictions} predictions · {ledger.open} open</span>
              </div>
              <div className="metric mt-4 flex items-baseline justify-between border-t pt-3 text-[10px]">
                <span className="text-muted-foreground">Next verdict</span>
                <span>{ledger.nextDue ? `${shortDate(ledger.nextDue.resolutionDate)} · ${countdown(ledger.nextDue.resolutionDate, now)}` : "—"}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {!sorted.length && <p className="mt-5 rounded-[20px] border border-dashed py-16 text-center text-sm text-muted-foreground">No experts with published predictions in this category yet.</p>}
    </>
  );
}
