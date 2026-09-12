import type { Metadata } from "next";
import { TopicsBrowser } from "@/components/topics-browser";
import { getTopics } from "@/lib/data/public";

export const metadata: Metadata = {
  title: "Topics",
  description: "Current events and outcome questions linked to verified public predictions.",
};

export default async function TopicsPage() {
  const topics = await getTopics();
  return (
    <div className="container-page py-12 sm:py-20">
      <p className="eyebrow">Current uncertainty / Topic index</p>
      <div className="mt-4 grid gap-6 md:grid-cols-[1fr_380px] md:items-end">
        <h1 className="editorial text-6xl font-semibold tracking-[-0.05em] sm:text-8xl">Topics</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          High-interest public questions normalized from markets and linked to predictions only when the outcome
          definition and timeframe match.
        </p>
      </div>

      {topics.length ? (
        <TopicsBrowser topics={topics} />
      ) : (
        <div className="mt-10 border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <p className="editorial text-2xl font-semibold">No active topics yet</p>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Topics are normalized from live Polymarket events. They will appear here once{" "}
            <code className="metric">pnpm seed:polymarket</code> runs against a network that can reach{" "}
            <span className="metric">gamma-api.polymarket.com</span>, or once the daily cron at{" "}
            <span className="metric">/api/cron/polymarket</span> refreshes the store.
          </p>
        </div>
      )}
    </div>
  );
}
