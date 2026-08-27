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
      {!topics.length && <p className="mt-10 border border-dashed py-16 text-center text-sm text-muted-foreground">No active topics are available.</p>}
    </div>
  );
}
