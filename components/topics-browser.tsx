"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import { CATEGORIES } from "@/lib/constants";
import type { Topic } from "@/types/domain";

export function TopicsBrowser({ topics }: { topics: Topic[] }) {
  const [category, setCategory] = useState<string>("all");
  const countsBySlug = useMemo(() => {
    const map = new Map<string, number>();
    for (const topic of topics) map.set(topic.categorySlug, (map.get(topic.categorySlug) ?? 0) + 1);
    return map;
  }, [topics]);
  const visible = useMemo(
    () => (category === "all" ? topics : topics.filter((topic) => topic.categorySlug === category)),
    [topics, category],
  );
  const activeCategories = CATEGORIES.filter((c) => (countsBySlug.get(c.slug) ?? 0) > 0);

  return (
    <>
      <div className="mt-8 flex gap-2 overflow-x-auto border-y border-border py-3">
        <button
          onClick={() => setCategory("all")}
          className={`metric shrink-0 rounded-[10px] border px-3.5 py-2 text-[11px] uppercase tracking-[0.04em] transition-colors ${category === "all" ? "border-transparent bg-foreground text-background" : "bg-card hover:bg-muted"}`}
        >
          All <span className="ml-1 opacity-60">{topics.length}</span>
        </button>
        {activeCategories.map((item) => (
          <button
            key={item.slug}
            onClick={() => setCategory(item.slug)}
            className={`metric shrink-0 rounded-[10px] border px-3.5 py-2 text-[11px] uppercase tracking-[0.04em] transition-colors ${category === item.slug ? "border-transparent bg-foreground text-background" : "bg-card hover:bg-muted"}`}
          >
            {item.shortName} <span className="ml-1 opacity-60">{countsBySlug.get(item.slug) ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-px overflow-hidden rounded-[20px] border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((topic) => {
          const market = topic.markets?.[0];
          return (
            <Link
              key={topic.id}
              href={`/topics/${topic.slug}`}
              className="group flex min-h-56 flex-col bg-card p-5 hover:bg-muted"
            >
              <div className="flex justify-between">
                <span className="eyebrow">{CATEGORIES.find((item) => item.slug === topic.categorySlug)?.name}</span>
                <ArrowUpRight className="size-4 opacity-40 group-hover:opacity-100" />
              </div>
              <h2 className="editorial mt-5 text-3xl leading-tight">{topic.title}</h2>
              <div className="mt-auto flex items-end justify-between border-t pt-4">
                <span className="eyebrow">Current implied Yes</span>
                <span className="metric text-3xl">
                  {market?.yesProbability == null ? "—" : `${Math.round(market.yesProbability * 100)}%`}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {!visible.length && (
        <p className="mt-6 border border-dashed py-16 text-center text-sm text-muted-foreground">
          No topics match this filter.
        </p>
      )}
    </>
  );
}
