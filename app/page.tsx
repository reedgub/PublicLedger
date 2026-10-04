import Link from "next/link";
import { ArrowUpRight, CalendarClock, FileCheck2, Lock, Quote } from "lucide-react";
import { FlagshipPrediction } from "@/components/flagship-prediction";
import { GlobalSearch } from "@/components/global-search";
import { MarketCard } from "@/components/market-card";
import { PredictionList } from "@/components/prediction-list";
import { RosterPreview } from "@/components/roster-preview";
import { SectionHeading } from "@/components/section-heading";
import { EmptyState } from "@/components/empty-state";
import { HeroField } from "@/components/brand/hero-field";
import { PixelButton } from "@/components/brand/pixel-button";
import { SectionLabel } from "@/components/brand/section-label";
import { getHomepageData } from "@/lib/data/public";
import { METHODOLOGY_SECTIONS } from "@/lib/methodology";

const TICKER = ["Pundits", "CEOs", "Economists", "Forecasters"];

const ANATOMY = [
  { icon: Quote, title: "Exact quote", body: "Every record keeps the speaker's original words, verbatim, linked to the source they were published in." },
  { icon: Lock, title: "Frozen claim", body: "The normalized claim and its resolution criteria are locked at publication. Corrections are explicit and audited." },
  { icon: CalendarClock, title: "Hard deadline", body: "Each prediction carries the date it comes due, so nobody gets to move the goalposts after the fact." },
  { icon: FileCheck2, title: "Evidence-backed verdict", body: "Outcomes are resolved against cited evidence and independently reviewed before they reach a scorecard." },
];

const PRINCIPLES = [
  ["No invented numbers", "A probability is recorded only when the speaker states one. “Likely” stays a word, never a percentage."],
  ["Ambiguity isn’t a loss", "Partial, ambiguous, and void outcomes are shown as they are — never forced into a win or a miss."],
  ["Sources stay honest", "If a source is deleted or can’t be verified, its text comes off the page and out of the score."],
] as const;

export default async function HomePage() {
  const data = await getHomepageData();
  const stats = [
    { value: data.published, label: "Published predictions with a verified source quote." },
    { value: data.expertCount, label: "Public figures on the tracked roster." },
    { value: data.topics.length, label: "Topics on the record, from elections to AI." },
    { value: 0, label: "Probabilities inferred from tone of voice." },
  ];

  return (
    <>
      {/* Hero */}
      <section className="relative -mt-[72px] overflow-hidden pt-[72px]">
        <HeroField />
        <div className="container-page relative flex min-h-[calc(100svh-72px)] flex-col justify-end pt-24 pb-14 sm:pb-20">
          <div className="animate-rise mb-auto flex h-[34px] items-center gap-4 overflow-hidden" aria-label="Who we track">
            <span className="hatch text-white" aria-hidden="true" />
            <span className="relative block h-[34px] overflow-hidden">
              <span className="animate-ticker flex flex-col">
                {TICKER.map((word) => <span key={word} className="h-[34px] text-[27px] leading-[34px] tracking-[-0.03em] sm:text-[34px]">{word}</span>)}
              </span>
            </span>
          </div>
          <div className="grid gap-10 pt-24 lg:grid-cols-[1fr_380px] lg:items-end">
            <h1 className="display-1 animate-rise max-w-4xl text-balance" style={{ animationDelay: "80ms" }}>
              Public predictions. Public outcomes.
            </h1>
            <div className="animate-rise" style={{ animationDelay: "180ms" }}>
              <p className="lede text-white/80">
                See which pundits, CEOs, and forecasters actually got their public predictions right — every claim linked to its original quote, tied to a real deadline, and scored when it comes due.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <PixelButton href="/leaderboard">See the leaderboard</PixelButton>
                <PixelButton href="/methodology" variant="ghost">How it works</PixelButton>
              </div>
            </div>
          </div>
          {data.published >= 5 && (
            <div id="search" className="animate-rise mt-12 max-w-3xl" style={{ animationDelay: "260ms" }}><GlobalSearch /></div>
          )}
        </div>
      </section>

      {/* Statement + anatomy */}
      <section className="container-page pt-32 sm:pt-44">
        <p className="display-2 max-w-5xl text-balance">
          <span>A prediction is only worth something if you can check it later. </span>
          <span className="text-white/35">We keep the receipt — the exact quote, the frozen claim, the deadline, and the verdict — so the record outlives the news cycle.</span>
        </p>
        <div className="mt-20 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ANATOMY.map(({ icon: Icon, title, body }) => (
            <article key={title} className="flex min-h-[220px] flex-col rounded-[20px] sm:min-h-[280px] border border-white/10 bg-card p-7">
              <span className="flex size-11 items-center justify-center rounded-[12px] border border-white/10 bg-white/[0.06]"><Icon className="size-5" /></span>
              <h3 className="mt-auto font-mono text-lg font-medium tracking-[0.02em]">{title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed font-light text-white/65">{body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Statistics */}
      <section className="container-page pt-32 sm:pt-44">
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div>
            <SectionLabel>Statistics</SectionLabel>
            <h2 className="display-2 mt-5 max-w-xl text-balance">The record, by the numbers</h2>
          </div>
          <p className="lede max-w-md lg:justify-self-end">Counts come straight from the published database. Nothing is rounded up, estimated, or back-filled.</p>
        </div>
        <div className="mt-14 grid overflow-hidden rounded-[20px] border border-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div key={stat.label} className={`grid-field flex min-h-[230px] flex-col justify-between bg-card p-7 ${index > 0 ? "border-t border-white/10 sm:border-t-0 sm:border-l" : ""} ${index === 2 ? "sm:border-t lg:border-t-0 sm:border-l-0 lg:border-l" : ""} ${index === 3 ? "sm:border-t lg:border-t-0" : ""}`}>
              <span className="metric text-[11px] uppercase text-white/50">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <p className="text-[64px] leading-none tracking-[-0.05em]" style={{ fontVariationSettings: '"opsz" 32' }}>{new Intl.NumberFormat("en-US").format(stat.value)}</p>
                <p className="mt-4 max-w-[220px] text-sm leading-relaxed font-light text-white/65">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Featured record + track records on a light surface */}
      <section className="mt-32 px-3 sm:mt-44 sm:px-4">
        <div className="surface-light rounded-[20px] py-24 sm:py-32">
          <div className="container-page">
            <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
              <div>
                <SectionLabel>Featured record</SectionLabel>
                <h2 className="display-2 mt-5 max-w-xl text-balance">What one prediction looks like</h2>
              </div>
              <p className="lede max-w-md lg:justify-self-end">The quote, the speaker, the date it was made, and — once it comes due — the verdict and the evidence behind it.</p>
            </div>
            <div className="mt-12">
              {data.flagship ? (
                <FlagshipPrediction prediction={data.flagship} />
              ) : (
                <EmptyState title="No resolved predictions yet" description="This slot goes live the moment the first published prediction reaches its deadline and its resolution clears independent review." />
              )}
            </div>

            <div className="mt-28">
              <SectionHeading index="01" label="Leaderboard" title="Top track records" aside={<Link href="/leaderboard" className="eyebrow flex items-center gap-1 hover:text-foreground">Full leaderboard <ArrowUpRight className="size-3" /></Link>} />
              {data.scorecards.length ? (
                <div className="mt-10 divide-y divide-border overflow-hidden rounded-[20px] border border-border">
                  {data.scorecards.map((scorecard, index) => (
                    <Link key={scorecard.expert.id} href={`/experts/${scorecard.expert.slug}`} className="group grid grid-cols-[40px_1fr_auto] items-center gap-4 px-5 py-5 transition-colors hover:bg-muted sm:grid-cols-[56px_1fr_140px_160px] sm:px-7">
                      <span className="metric text-sm text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                      <span><span className="editorial block text-2xl">{scorecard.expert.displayName}</span><span className="eyebrow">{scorecard.expert.xHandle ? `@${scorecard.expert.xHandle}` : scorecard.expert.headline}</span></span>
                      <span className="hidden sm:block"><span className="editorial text-3xl">{scorecard.accuracy === null ? "—" : `${Math.round(scorecard.accuracy * 100)}%`}</span><span className="eyebrow block">accuracy</span></span>
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
            </div>
          </div>
        </div>
      </section>

      {/* Live market context, presented as a product panel */}
      {data.markets.length > 0 && (
        <section className="container-page pt-32 sm:pt-44">
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
            <div>
              <SectionLabel>Live market context</SectionLabel>
              <h2 className="display-2 mt-5 max-w-xl text-balance">What the crowd is pricing right now</h2>
            </div>
            <p className="lede max-w-md lg:justify-self-end">Prediction-market prices give context on open questions. They are informational only — never an expert&apos;s prediction, and never a score.</p>
          </div>
          <div className="grid-field mt-12 rounded-[20px] border border-white/10 bg-[#0a0a0a] p-3 sm:p-4">
            <div className="flex items-center justify-between px-2 pb-4 pt-1 sm:px-3">
              <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.04em] text-white/60"><span className="size-1.5 rounded-full bg-correct" />Polymarket feed</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-white/40">Informational</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {data.markets.map((market) => <MarketCard key={market.id} market={market} />)}
            </div>
          </div>
        </section>
      )}

      {/* Feeds */}
      <section className="container-page grid gap-20 pt-32 sm:pt-44 lg:grid-cols-2 lg:gap-12">
        <div>
          <SectionHeading index="02" label="Latest" title="Latest predictions" />
          <div className="mt-10">{data.latest.length ? <PredictionList predictions={data.latest} /> : <EmptyState title="No verified predictions yet" description="Verified predictions will appear after source ingestion, extraction, and independent review pass strict publication thresholds." />}</div>
        </div>
        <div>
          <SectionHeading index="03" label="Resolved" title="Recently resolved" />
          <div className="mt-10">{data.resolved.length ? <PredictionList predictions={data.resolved} /> : <EmptyState title="No resolutions yet" description="Due predictions enter a separate evidence-backed resolution workflow before results become public." />}</div>
        </div>
      </section>

      <section className="container-page pt-32 sm:pt-44">
        <SectionHeading index="04" label="Open" title="Big open calls" />
        <div className="mt-10">{data.open.length ? <PredictionList predictions={data.open} /> : <EmptyState title="No open calls yet" description="Only published, source-faithful predictions appear here." />}</div>
      </section>

      {data.takes.length > 0 && (
        <section className="container-page pt-32 sm:pt-44">
          <SectionHeading index="05" label="Not scored" title="Takes we're watching" />
          <p className="lede mt-5 max-w-2xl">
            Takes are forward-looking claims where at least one ingredient — usually the deadline or the resolution source — had to be imputed by an editor. They&apos;re shown for context and never enter the leaderboard.
          </p>
          <div className="mt-10"><PredictionList predictions={data.takes} /></div>
        </section>
      )}

      {/* Approach */}
      <section className="container-page pt-32 sm:pt-44">
        <SectionLabel>Our approach</SectionLabel>
        <h2 className="display-2 mt-5 max-w-2xl text-balance">Built to be checked, not trusted</h2>
        <div className="mt-14 grid gap-3 md:grid-cols-3">
          {PRINCIPLES.map(([title, body], index) => (
            <article key={title} className="rounded-[20px] border border-white/10 bg-card p-7">
              <span className="metric text-[11px] text-white/50">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="mt-16 text-[27px] leading-[1.2]">{title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed font-light text-white/65">{body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="container-page grid gap-12 pt-32 sm:pt-44 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <SectionLabel>FAQ</SectionLabel>
          <h2 className="display-2 mt-5 text-balance">Common questions</h2>
          <p className="lede mt-5 max-w-sm">How predictions get in, how they&apos;re scored, and what we refuse to guess. Can&apos;t find an answer?</p>
          <PixelButton href="/methodology" variant="ghost" className="mt-7">Read the methodology</PixelButton>
        </div>
        <div className="divide-y divide-white/10 border-y border-white/10">
          {METHODOLOGY_SECTIONS.slice(0, 6).map(([index, question, answer]) => (
            <details key={index} className="group py-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-xl tracking-[-0.02em] [&::-webkit-details-marker]:hidden">
                {question}
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-white/10 text-white/70 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed font-light text-white/65">{answer}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
