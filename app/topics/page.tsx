import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CATEGORIES } from "@/lib/constants";
import { getTopics } from "@/lib/data/public";

export const metadata: Metadata = { title: "Topics", description: "Current events and outcome questions linked to verified public predictions." };

export default async function TopicsPage() {
  const topics = await getTopics();
  return (
    <div className="container-receipts py-12 sm:py-20">
      <p className="eyebrow">Current uncertainty / Topic index</p>
      <div className="mt-4 grid gap-6 md:grid-cols-[1fr_380px] md:items-end"><h1 className="editorial text-6xl font-semibold tracking-[-0.05em] sm:text-8xl">Topics</h1><p className="text-sm leading-relaxed text-muted-foreground">High-interest public questions normalized from markets and linked to Receipts only when the outcome definition and timeframe match.</p></div>
      <div className="mt-10 grid gap-px bg-foreground sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((topic) => {
          const market = topic.markets?.[0];
          return <Link key={topic.id} href={`/topics/${topic.slug}`} className="group flex min-h-56 flex-col bg-card p-5 hover:bg-muted"><div className="flex justify-between"><span className="eyebrow">{CATEGORIES.find((item) => item.slug === topic.categorySlug)?.name}</span><ArrowUpRight className="size-4 opacity-40 group-hover:opacity-100" /></div><h2 className="editorial mt-5 text-3xl font-semibold leading-tight">{topic.title}</h2><div className="mt-auto flex items-end justify-between border-t pt-4"><span className="eyebrow">Current implied Yes</span><span className="metric text-3xl">{market?.yesProbability == null ? "—" : `${Math.round(market.yesProbability * 100)}%`}</span></div></Link>;
        })}
      </div>
      {!topics.length && (
        <div className="mt-10 border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <p className="editorial text-2xl font-semibold">No active topics yet</p>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Topics are normalized from live Polymarket events. They will appear here once{" "}
            <code className="metric">pnpm seed:polymarket</code> runs against a network that can
            reach <span className="metric">gamma-api.polymarket.com</span>, or once the hourly cron
            at <span className="metric">/api/cron/polymarket</span> refreshes the store.
          </p>
        </div>
      )}
    </div>
  );
}
