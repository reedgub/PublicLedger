import Link from "next/link";
import { ArrowRight, Database, ShieldCheck } from "lucide-react";
import { GlobalSearch } from "@/components/global-search";
import { MarketCard } from "@/components/market-card";
import { PredictionList } from "@/components/prediction-list";
import { RosterPreview } from "@/components/roster-preview";
import { SectionHeading } from "@/components/section-heading";
import { EmptyState } from "@/components/empty-state";
import { getHomepageData } from "@/lib/data/public";
import { normalizeMarketTopic } from "@/lib/topics/normalize";

export default async function HomePage() {
  const data = await getHomepageData();
  return (
    <>
      <section className="container-receipts pt-12 sm:pt-20">
        <div className="border-b border-foreground pb-12 lg:pb-16">
          <p className="eyebrow mb-3 flex items-center gap-2 sm:mb-5"><span className="h-px w-8 bg-foreground" />The public prediction record</p>
          <h1 className="editorial max-w-5xl text-[clamp(3.75rem,9vw,9rem)] font-semibold leading-[0.88] tracking-[-0.06em] text-balance">
            PUBLIC PREDICTIONS.<br />PUBLIC OUTCOMES.
          </h1>
          <p className="editorial mt-8 max-w-2xl text-xl leading-snug text-balance sm:text-2xl">
            Project Lighthouse keeps a public record of what influential people predicted — and what actually happened.
          </p>
          <div className="mt-6 flex gap-5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            <span className="flex items-center gap-1.5"><Database className="size-3.5" />Source-backed</span>
            <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" />Auditable</span>
          </div>
        </div>
        {data.published >= 20 && (
          <div className="relative z-20 mx-auto -mt-px max-w-3xl translate-y-1/2"><GlobalSearch /></div>
        )}
      </section>

      <section className="container-receipts mt-16 sm:mt-24">
        <SectionHeading index="01" title="Happening Now" aside={<span className="eyebrow">Live market context</span>} />
        {data.markets.length ? (
          <div className="mt-6 grid gap-px bg-foreground sm:grid-cols-2 lg:grid-cols-3">
            {data.markets.map((market) => <MarketCard key={market.id} market={market} topicHref={`/topics/${normalizeMarketTopic(market.question).topicSlug}`} />)}
          </div>
        ) : <div className="mt-6"><EmptyState title="Market feed unavailable" description="Live Polymarket context will appear here when its public API is reachable or after the database is seeded." /></div>}
      </section>

      <section className="container-receipts mt-14 sm:mt-20">
        <SectionHeading index="02" title="Top Track Records" aside={<Link href="/leaderboard" className="eyebrow flex items-center gap-1 hover:text-foreground">Full leaderboard <ArrowRight className="size-3" /></Link>} />
        {data.scorecards.length ? (
          <div className="mt-2 divide-y divide-border border-b border-foreground">
            {data.scorecards.map((scorecard, index) => (
              <Link key={scorecard.expert.id} href={`/experts/${scorecard.expert.slug}`} className="group grid grid-cols-[40px_1fr_auto] items-center gap-4 py-4 sm:grid-cols-[50px_1fr_120px_140px]">
                <span className="metric text-sm text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                <span><span className="editorial block text-xl font-semibold group-hover:underline">{scorecard.expert.displayName}</span><span className="eyebrow">{scorecard.expert.xHandle ? `@${scorecard.expert.xHandle}` : scorecard.expert.headline}</span></span>
                <span className="hidden sm:block"><span className="metric text-2xl">{scorecard.accuracy === null ? "—" : `${Math.round(scorecard.accuracy * 100)}%`}</span><span className="eyebrow block">accuracy</span></span>
                <span className="text-right"><span className="metric text-sm">{scorecard.correctPredictions} / {scorecard.resolvedPredictions}</span><span className="eyebrow block">correct / resolved</span></span>
              </Link>
            ))}
          </div>
        ) : (
          <RosterPreview
            experts={data.rosterPreview.map((scorecard) => scorecard.expert)}
            eyebrow={`Roster / ${data.rosterPreview.length} of the discovery pool`}
            title="Awaiting first ranked track records"
            description="An expert needs at least five verified binary resolutions before appearing on the leaderboard. Until then, this is the roster the extraction pipeline draws from — real handles, real profiles, zero fabricated numbers."
          />
        )}
      </section>

      <section className="container-receipts mt-14 grid gap-12 sm:mt-20 lg:grid-cols-2">
        <div>
          <SectionHeading index="03" title="Latest predictions" />
          <div className="mt-5">{data.latest.length ? <PredictionList predictions={data.latest} /> : <EmptyState title="No verified predictions yet" description="Verified predictions will appear after source ingestion, extraction, and independent review pass strict publication thresholds." />}</div>
        </div>
        <div>
          <SectionHeading index="04" title="Recently Resolved" />
          <div className="mt-5">{data.resolved.length ? <PredictionList predictions={data.resolved} /> : <EmptyState title="No resolutions yet" description="Due predictions enter a separate evidence-backed resolution workflow before results become public." />}</div>
        </div>
      </section>

      <section className="container-receipts mt-14 sm:mt-20">
        <SectionHeading index="05" title="Big Open Calls" />
        <div className="mt-5">{data.open.length ? <PredictionList predictions={data.open} /> : <EmptyState title="No open calls yet" description="Only published, source-faithful predictions appear here. Market questions above are context—not attributed expert claims." />}</div>
      </section>
    </>
  );
}
