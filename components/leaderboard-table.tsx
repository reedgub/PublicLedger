"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CATEGORIES } from "@/lib/constants";
import { track } from "@/lib/analytics/client";
import type { ExpertScorecard } from "@/types/domain";

type SortKey = "wilson" | "accuracy" | "calibration" | "sample";

const percentage = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;
const decimal = (value: number | null) => value === null ? "—" : value.toFixed(3);

// Sort options exposed as chips. Wilson stays the default because raw
// accuracy rewards tiny samples, but readers deserve to see the accuracy
// number as the hero — the abstract "0.412" beats the human "63%" for no one.
const SORTS: Array<{ key: SortKey; label: string; description: string }> = [
  { key: "wilson", label: "Adjusted rank", description: "80% Wilson lower bound" },
  { key: "accuracy", label: "Raw accuracy", description: "Ignores sample size" },
  { key: "calibration", label: "Calibration", description: "Lower Brier is better" },
  { key: "sample", label: "Most resolved", description: "Largest sample first" },
];

function compare(a: ExpertScorecard, b: ExpertScorecard, key: SortKey): number {
  if (key === "wilson") return (b.wilsonRankScore ?? -1) - (a.wilsonRankScore ?? -1);
  if (key === "accuracy") return (b.accuracy ?? -1) - (a.accuracy ?? -1);
  if (key === "calibration") {
    // Brier: lower is better; nulls sink.
    const av = a.brierScore ?? Number.POSITIVE_INFINITY;
    const bv = b.brierScore ?? Number.POSITIVE_INFINITY;
    return av - bv;
  }
  return b.resolvedPredictions - a.resolvedPredictions;
}

export function LeaderboardTable({ scorecards }: { scorecards: ExpertScorecard[] }) {
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<SortKey>("wilson");
  const filtered = useMemo(
    () => scorecards.filter((row) => category === "all" || row.expert.primaryCategorySlug === category),
    [scorecards, category],
  );
  const sorted = useMemo(() => [...filtered].sort((a, b) => compare(a, b, sort)), [filtered, sort]);
  const active = SORTS.find((option) => option.key === sort) ?? SORTS[0];

  return (
    <>
      <div className="mt-8 flex gap-2 overflow-x-auto border-y border-foreground py-3">
        <button onClick={() => { setCategory("all"); track("leaderboard_filter", { category: "all" }); }} className={`metric shrink-0 border px-3 py-2 text-[9px] uppercase ${category === "all" ? "border-foreground bg-foreground text-background" : "bg-card"}`}>All categories</button>
        {CATEGORIES.map((item) => <button key={item.slug} onClick={() => { setCategory(item.slug); track("leaderboard_filter", { category: item.slug }); }} className={`metric shrink-0 border px-3 py-2 text-[9px] uppercase ${category === item.slug ? "border-foreground bg-foreground text-background" : "bg-card"}`}>{item.shortName}</button>)}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <span className="eyebrow mr-2">Sort by</span>
        {SORTS.map((option) => (
          <button
            key={option.key}
            onClick={() => { setSort(option.key); track("leaderboard_sort", { sort: option.key }); }}
            title={option.description}
            className={`metric shrink-0 border px-3 py-2 text-[9px] uppercase ${sort === option.key ? "border-foreground bg-foreground text-background" : "bg-card"}`}
          >
            {option.label}
          </button>
        ))}
        <span className="eyebrow ml-auto text-muted-foreground">{active.description}</span>
      </div>

      <div className="mt-5 hidden overflow-x-auto border border-foreground md:block">
        <table className="w-full min-w-[1000px] border-collapse text-left text-xs">
          <thead className="border-b border-foreground bg-muted">
            <tr>
              <th className="eyebrow px-3 py-3">Rank</th>
              <th className="eyebrow px-3 py-3">Expert</th>
              <th className="eyebrow px-3 py-3 text-right">Accuracy</th>
              <th className="eyebrow px-3 py-3 text-right">Sample</th>
              <th className="eyebrow px-3 py-3 text-right">Adjusted</th>
              <th className="eyebrow px-3 py-3 text-right">Brier</th>
              <th className="eyebrow px-3 py-3 text-right">Open</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => (
              <tr key={row.expert.id} className="border-b last:border-0 hover:bg-muted/60">
                <td className="px-3 py-4 align-top"><span className="metric text-muted-foreground">{String(index + 1).padStart(2, "0")}</span></td>
                <td className="px-3 py-4 align-top">
                  <Link href={`/experts/${row.expert.slug}`} className="font-semibold hover:underline">
                    <span className="block">{row.expert.displayName}</span>
                    <span className="metric text-[9px] font-normal text-muted-foreground">{row.expert.xHandle ? `@${row.expert.xHandle}` : row.expert.headline}</span>
                  </Link>
                </td>
                <td className="px-3 py-4 text-right align-top">
                  <span className="metric text-2xl leading-none">{percentage(row.accuracy)}</span>
                </td>
                <td className="px-3 py-4 text-right align-top">
                  <span className="metric">{row.correctPredictions} / {row.resolvedPredictions}</span>
                  <span className="eyebrow block">correct / resolved</span>
                </td>
                <td className="px-3 py-4 text-right align-top"><span className="metric">{decimal(row.wilsonRankScore)}</span></td>
                <td className="px-3 py-4 text-right align-top"><span className="metric">{decimal(row.brierScore)}</span></td>
                <td className="px-3 py-4 text-right align-top"><span className="metric">{row.openPredictions}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-3 md:hidden">
        {sorted.map((row, index) => (
          <Link key={row.expert.id} href={`/experts/${row.expert.slug}`} className="border border-foreground bg-card p-4">
            <div className="flex items-start justify-between">
              <span className="metric text-muted-foreground">#{index + 1}</span>
            </div>
            <h2 className="editorial mt-3 text-2xl font-semibold">{row.expert.displayName}</h2>
            <div className="mt-4 flex items-baseline gap-4 border-t pt-3">
              <span className="metric text-5xl leading-none">{percentage(row.accuracy)}</span>
              <span className="eyebrow">{row.correctPredictions}/{row.resolvedPredictions} · Adj {decimal(row.wilsonRankScore)}</span>
            </div>
            <dl className="metric mt-4 grid grid-cols-3 gap-2 text-[9px]">
              <div><dt className="text-muted-foreground">Brier</dt><dd className="mt-1 text-sm">{decimal(row.brierScore)}</dd></div>
              <div><dt className="text-muted-foreground">Open</dt><dd className="mt-1 text-sm">{row.openPredictions}</dd></div>
              <div><dt className="text-muted-foreground">Total</dt><dd className="mt-1 text-sm">{row.totalPredictions}</dd></div>
            </dl>
          </Link>
        ))}
      </div>

      {!sorted.length && <p className="border border-dashed py-16 text-center text-sm text-muted-foreground">No experts have at least five binary resolutions in this category yet.</p>}
    </>
  );
}
