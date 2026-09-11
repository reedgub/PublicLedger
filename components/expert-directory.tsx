"use client";

import Image from "next/image";
import Link from "next/link";
import { Search, ArrowUpRight, BadgeCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { CATEGORIES } from "@/lib/constants";
import type { Expert } from "@/types/domain";

export function ExpertDirectory({ experts }: { experts: Expert[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const filtered = useMemo(() => experts.filter((expert) => {
    const lower = query.toLowerCase();
    return (category === "all" || expert.categorySlugs.includes(category as Expert["primaryCategorySlug"]) || expert.primaryCategorySlug === category) &&
      (expert.displayName.toLowerCase().includes(lower) || expert.xHandle?.toLowerCase().includes(lower));
  }), [experts, query, category]);

  return (
    <>
      <div className="mt-8 grid gap-3 border-y border-foreground py-4 md:grid-cols-[1fr_auto]">
        <label className="relative"><span className="sr-only">Filter experts</span><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 rounded-none border-foreground bg-card pl-9" placeholder="Filter by name or handle…" /></label>
        <div className="flex gap-2 overflow-x-auto pb-1 md:max-w-[620px]">
          <button onClick={() => setCategory("all")} className={`metric shrink-0 border px-3 py-2 text-[9px] uppercase ${category === "all" ? "border-foreground bg-foreground text-background" : "bg-card"}`}>All</button>
          {CATEGORIES.slice(0, -1).map((item) => <button key={item.slug} onClick={() => setCategory(item.slug)} className={`metric shrink-0 border px-3 py-2 text-[9px] uppercase ${category === item.slug ? "border-foreground bg-foreground text-background" : "bg-card"}`}>{item.shortName}</button>)}
        </div>
      </div>
      <div className="mt-6 grid gap-px bg-foreground sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((expert) => (
          <Link key={expert.id} href={`/experts/${expert.slug}`} className="group min-h-48 bg-card p-5 hover:bg-muted">
            <div className="flex items-start justify-between gap-4">
              {expert.avatarUrl ? (
                <Image
                  src={expert.avatarUrl}
                  alt=""
                  width={44}
                  height={44}
                  className="size-11 border border-foreground bg-card object-cover"
                />
              ) : (
                <span className="metric flex size-11 items-center justify-center border border-foreground text-sm font-semibold">
                  {expert.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}
                </span>
              )}
              <ArrowUpRight className="size-4 opacity-40 group-hover:opacity-100" />
            </div>
            <h2 className="editorial mt-8 text-2xl font-semibold group-hover:underline group-hover:underline-offset-4">{expert.displayName}</h2>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              {expert.xHandle && <span className="metric">@{expert.xHandle}</span>}
              {expert.sourceStatus === "verified" && <BadgeCheck className="size-3.5" aria-label="X identity verified" />}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{expert.headline}</p>
          </Link>
        ))}
      </div>
      {!filtered.length && <p className="py-16 text-center text-sm text-muted-foreground">No experts match those filters.</p>}
    </>
  );
}
