import type { Metadata } from "next";
import Link from "next/link";
import { SectionLabel } from "@/components/brand/section-label";
import { ExpertAvatar } from "@/components/expert-avatar";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { LedgerLegend } from "@/components/ledger-strip";
import { Reveal } from "@/components/motion/reveal";
import { RosterPreview } from "@/components/roster-preview";
import { getExpertScorecards, getLeaderboardLedgerRows } from "@/lib/data/public";
import { buildLedgers, comingDue, countdown, shortDate, type ExpertLedger } from "@/lib/leaderboard/ledger";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Every expert's full public record: verdicts ranked by the 80% Wilson lower confidence bound, open calls shown with their deadlines.",
};

export default async function LeaderboardPage() {
  const [scorecards, ledgerRows] = await Promise.all([getExpertScorecards(), getLeaderboardLedgerRows()]);
  const eligible = scorecards.filter((scorecard) => scorecard.leaderboardEligible);
  const rosterExperts = scorecards.map((scorecard) => scorecard.expert);

  if (eligible.length === 0) {
    return (
      <div className="container-page py-10 sm:py-14">
        <p className="eyebrow">Leaderboard / Awaiting first ranked track records</p>
        <h1 className="display-1 mt-4">Leaderboard</h1>
        <p className="lede mt-6 max-w-2xl">
          An expert appears here once they have at least one published prediction or take. Until then,
          this is the discovery roster the ingestion pipeline draws from — real handles, real profiles,
          zero fabricated numbers.
        </p>
        <div className="mt-8">
          <RosterPreview
            experts={rosterExperts}
            eyebrow={`Roster / ${rosterExperts.length} profiles / 0 eligible`}
          />
        </div>
      </div>
    );
  }

  const now = new Date();
  const ledgerMap = buildLedgers(ledgerRows, now);
  const ledgers: Record<string, ExpertLedger> = {};
  for (const row of ledgerRows) {
    const ledger = ledgerMap.get(row.expertId);
    if (ledger) ledgers[row.expertSlug] = ledger;
  }
  const experts = new Map(scorecards.map((scorecard) => [scorecard.expert.slug, scorecard.expert]));
  const upcoming = comingDue(ledgerRows, 4, now);
  const verdicts = ledgerRows.filter((row) => row.outcome === "correct" || row.outcome === "incorrect").length;
  const open = ledgerRows.filter((row) => row.outcome === null).length;
  const withinYear = ledgerRows.filter((row) => row.outcome === null && row.resolutionDate
    && new Date(row.resolutionDate).getTime() >= now.getTime()
    && new Date(row.resolutionDate).getTime() - now.getTime() <= 365 * 86_400_000).length;

  return (
    <div className="container-page py-12 sm:py-20">
      <p className="eyebrow">Full public record / Binary verdicts ranked</p>
      <h1 className="display-1 mt-4">Leaderboard</h1>

      <Reveal y={24}>
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-4">
          {[
            { label: "On the record", value: ledgerRows.length },
            { label: "Verdicts", value: verdicts },
            { label: "Still open", value: open },
            { label: "Resolving within a year", value: withinYear },
          ].map((stat) => (
            <div key={stat.label} className="bg-card p-4 sm:p-5">
              <dt className="eyebrow text-muted-foreground">{stat.label}</dt>
              <dd className="metric mt-2 text-3xl leading-none sm:text-4xl">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </Reveal>

      {upcoming.length > 0 && (
        <Reveal y={24} delay={0.06}>
          <section className="mt-10">
            <SectionLabel>Coming due</SectionLabel>
            <ul className="mt-4 divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
              {upcoming.map((row) => {
                const expert = experts.get(row.expertSlug);
                return (
                  <li key={row.id}>
                    <Link href={`/predictions/${row.id}`} className="flex items-start gap-3 p-4 transition-colors hover:bg-muted/60 sm:items-center sm:gap-4">
                      {expert && <ExpertAvatar expert={expert} size={32} />}
                      <span className="min-w-0 flex-1">
                        <span className="eyebrow block text-muted-foreground">{row.expertName}</span>
                        <span className="mt-1 block text-[15px] leading-snug font-light text-foreground/80">{row.claim}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="metric block text-xs">{shortDate(row.resolutionDate)}</span>
                        <span className="eyebrow block text-muted-foreground">{countdown(row.resolutionDate, now)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </Reveal>
      )}

      <Reveal y={24} delay={0.12}>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SectionLabel>Every expert, every call</SectionLabel>
          <LedgerLegend />
        </div>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed font-light text-muted-foreground">
          Each mark is one published prediction, verdicts first and open calls by deadline. Only correct and
          incorrect verdicts count toward accuracy; open calls are on the record until their deadline passes.
        </p>
      </Reveal>
      <LeaderboardTable scorecards={eligible} ledgers={ledgers} nowIso={now.toISOString()} />
    </div>
  );
}
