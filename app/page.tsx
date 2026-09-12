import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FlagshipReceipt } from "@/components/flagship-receipt";
import { GlobalSearch } from "@/components/global-search";
import { PredictionList } from "@/components/prediction-list";
import { RosterPreview } from "@/components/roster-preview";
import { SectionHeading } from "@/components/section-heading";
import { EmptyState } from "@/components/empty-state";
import { getHomepageData } from "@/lib/data/public";

export default async function HomePage() {
  const data = await getHomepageData();
  return (
    <>
      <section className="container-receipts pt-6 sm:pt-10">
        <div className="border-b border-foreground pb-6 lg:pb-8">
          <p className="eyebrow mb-2 flex items-center gap-2 sm:mb-3"><span className="h-px w-8 bg-foreground" />The public prediction record</p>
          <h1 className="editorial max-w-5xl text-[clamp(2.25rem,6.5vw,5.5rem)] font-semibold leading-[0.9] tracking-[-0.05em] text-balance">
            PUBLIC PREDICTIONS.<br />PUBLIC OUTCOMES.
          </h1>
          <p className="editorial mt-4 max-w-2xl text-base leading-snug text-balance sm:mt-5 sm:text-lg">
            See which pundits, CEOs, and forecasters actually got their public predictions right. Every claim linked to the original quote, tied to a real deadline, and scored when it comes due.
          </p>
        </div>
        {data.published >= 5 && (
          <div className="relative z-20 mx-auto -mt-px max-w-3xl translate-y-1/2"><GlobalSearch /></div>
        )}
      </section>

      {data.flagship ? (
        <section className="container-receipts mt-8 sm:mt-12">
          <FlagshipReceipt prediction={data.flagship} />
        </section>
      ) : (
        <section className="container-receipts mt-8 sm:mt-12">
          <SectionHeading index="01" title="Featured receipt" aside={<span className="eyebrow">Awaiting first resolution</span>} />
          <div className="mt-6"><EmptyState title="No resolved predictions yet" description="The featured receipt slot goes live the moment the first published prediction reaches its deadline and its resolution clears independent review." /></div>
        </section>
      )}

      <section className="container-receipts mt-14 sm:mt-20">
        <SectionHeading index="02" title="Top track records" aside={<Link href="/leaderboard" className="eyebrow flex items-center gap-1 hover:text-foreground">Full leaderboard <ArrowRight className="size-3" /></Link>} />
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
          <SectionHeading index="04" title="Recently resolved" />
          <div className="mt-5">{data.resolved.length ? <PredictionList predictions={data.resolved} /> : <EmptyState title="No resolutions yet" description="Due predictions enter a separate evidence-backed resolution workflow before results become public." />}</div>
        </div>
      </section>

      <section className="container-receipts mt-14 sm:mt-20">
        <SectionHeading index="05" title="Big open calls" />
        <div className="mt-5">{data.open.length ? <PredictionList predictions={data.open} /> : <EmptyState title="No open calls yet" description="Only published, source-faithful predictions appear here." />}</div>
      </section>

      {data.takes.length > 0 && (
        <section className="container-receipts mt-14 sm:mt-20">
          <SectionHeading index="06" title="Takes we're watching" aside={<span className="eyebrow">Not scored</span>} />
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Takes are forward-looking claims where at least one ingredient — usually the deadline or the resolution source — had to be imputed by an editor. They&apos;re shown for context and never enter the leaderboard.
          </p>
          <div className="mt-5"><PredictionList predictions={data.takes} /></div>
        </section>
      )}
    </>
  );
}
