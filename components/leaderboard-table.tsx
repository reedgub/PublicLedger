"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { flexRender, type SortingState } from "@tanstack/react-table";
import { getCoreRowModel, getSortedRowModel, legacyCreateColumnHelper, useLegacyTable, type LegacyColumnDef } from "@tanstack/react-table/legacy";
import { ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES } from "@/lib/constants";
import { track } from "@/lib/analytics/client";
import type { ExpertScorecard } from "@/types/domain";

const columnHelper = legacyCreateColumnHelper<ExpertScorecard>();
const percentage = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;
const decimal = (value: number | null) => value === null ? "—" : value.toFixed(3);

export function LeaderboardTable({ scorecards }: { scorecards: ExpertScorecard[] }) {
  const [category, setCategory] = useState("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "wilsonRankScore", desc: true }]);
  const data = useMemo(() => scorecards.filter((row) => category === "all" || row.expert.primaryCategorySlug === category), [scorecards, category]);
  const columns = useMemo(() => ([
    columnHelper.display({ id: "rank", header: "Rank", cell: ({ row }) => <span className="metric text-muted-foreground">{String(row.index + 1).padStart(2, "0")}</span> }),
    columnHelper.accessor((row) => row.expert.displayName, { id: "expert", header: "Expert", cell: ({ row }) => <Link href={`/experts/${row.original.expert.slug}`} className="font-semibold hover:underline"><span className="block">{row.original.expert.displayName}</span><span className="metric text-[9px] font-normal text-muted-foreground">{row.original.expert.xHandle ? `@${row.original.expert.xHandle}` : row.original.expert.headline}</span></Link> }),
    columnHelper.accessor("wilsonRankScore", { header: "Adjusted", cell: ({ getValue }) => <span className="metric font-semibold">{decimal(getValue())}</span> }),
    columnHelper.accessor("accuracy", { header: "Accuracy", cell: ({ getValue }) => <span className="metric">{percentage(getValue())}</span> }),
    columnHelper.accessor("resolvedPredictions", { header: "Resolved", cell: ({ getValue }) => <span className="metric">{getValue()}</span> }),
    columnHelper.accessor("correctPredictions", { header: "Correct", cell: ({ getValue }) => <span className="metric text-correct">{getValue()}</span> }),
    columnHelper.accessor("incorrectPredictions", { header: "Incorrect", cell: ({ getValue }) => <span className="metric text-incorrect">{getValue()}</span> }),
    columnHelper.accessor("openPredictions", { header: "Open", cell: ({ getValue }) => <span className="metric">{getValue()}</span> }),
    columnHelper.accessor("brierScore", { header: "Brier", cell: ({ getValue }) => <span className="metric">{decimal(getValue())}</span> }),
    columnHelper.accessor("totalPredictions", { header: "Total", cell: ({ getValue }) => <span className="metric">{getValue()}</span> }),
  ] as unknown as LegacyColumnDef<ExpertScorecard, unknown>[]), []);
  const table = useLegacyTable({ data, columns, state: { sorting }, onSortingChange: (updater) => { setSorting(updater); track("leaderboard_sort"); }, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });

  return (
    <>
      <div className="mt-8 flex gap-2 overflow-x-auto border-y border-foreground py-3">
        <button onClick={() => { setCategory("all"); track("leaderboard_filter", { category: "all" }); }} className={`metric shrink-0 border px-3 py-2 text-[9px] uppercase ${category === "all" ? "border-foreground bg-foreground text-background" : "bg-card"}`}>All categories</button>
        {CATEGORIES.map((item) => <button key={item.slug} onClick={() => { setCategory(item.slug); track("leaderboard_filter", { category: item.slug }); }} className={`metric shrink-0 border px-3 py-2 text-[9px] uppercase ${category === item.slug ? "border-foreground bg-foreground text-background" : "bg-card"}`}>{item.shortName}</button>)}
      </div>
      <div className="mt-5 hidden overflow-x-auto border border-foreground md:block">
        <table className="w-full min-w-[1000px] border-collapse text-left text-xs">
          <thead className="border-b border-foreground bg-muted">
            {table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id} className="eyebrow px-3 py-3"><button className="flex items-center gap-1" onClick={header.column.getToggleSortingHandler()} disabled={!header.column.getCanSort()}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}{header.column.getCanSort() && <ArrowUpDown className="size-3" />}</button></th>)}</tr>)}
          </thead>
          <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} className="border-b last:border-0 hover:bg-muted/60">{row.getVisibleCells().map((cell) => <td key={cell.id} className="px-3 py-4 align-top">{flexRender(cell.column.columnDef.cell, cell.getContext())}{cell.column.id === "expert" && row.original.provisional && <Badge variant="outline" className="mt-2 rounded-none px-1 text-[8px] text-provisional">Provisional</Badge>}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="mt-5 grid gap-3 md:hidden">
        {table.getRowModel().rows.map((row) => <Link key={row.id} href={`/experts/${row.original.expert.slug}`} className="border border-foreground bg-card p-4"><div className="flex items-start justify-between"><span className="metric text-muted-foreground">#{row.index + 1}</span>{row.original.provisional && <Badge variant="outline" className="rounded-none text-[8px] text-provisional">Provisional</Badge>}</div><h2 className="editorial mt-4 text-2xl font-semibold">{row.original.expert.displayName}</h2><dl className="metric mt-4 grid grid-cols-4 gap-2 border-t pt-3 text-[9px]"><div><dt className="text-muted-foreground">Accuracy</dt><dd className="mt-1 text-sm">{percentage(row.original.accuracy)}</dd></div><div><dt className="text-muted-foreground">Resolved</dt><dd className="mt-1 text-sm">{row.original.resolvedPredictions}</dd></div><div><dt className="text-muted-foreground">Open</dt><dd className="mt-1 text-sm">{row.original.openPredictions}</dd></div><div><dt className="text-muted-foreground">Brier</dt><dd className="mt-1 text-sm">{decimal(row.original.brierScore)}</dd></div></dl></Link>)}
      </div>
      {!table.getRowModel().rows.length && <p className="border border-dashed py-16 text-center text-sm text-muted-foreground">No experts have at least five binary resolutions in this category yet.</p>}
    </>
  );
}
