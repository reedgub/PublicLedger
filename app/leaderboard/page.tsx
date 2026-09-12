import type { Metadata } from "next";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { RosterPreview } from "@/components/roster-preview";
import { getExpertScorecards } from "@/lib/data/public";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Expert track records ranked by the 80% Wilson lower confidence bound—not raw accuracy.",
};

export default async function LeaderboardPage() {
  const scorecards = await getExpertScorecards();
  const eligible = scorecards.filter((scorecard) => scorecard.leaderboardEligible);
  const rosterExperts = scorecards.map((scorecard) => scorecard.expert);

  if (eligible.length === 0) {
    return (
      <div className="container-page py-10 sm:py-14">
        <p className="eyebrow">Leaderboard / Awaiting first ranked track records</p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          An expert appears on the ranked leaderboard once they have five verified binary resolutions.
          Until then, this is the discovery roster the ingestion pipeline draws from — real handles,
          real profiles, zero fabricated numbers.
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

  return (
    <div className="container-page py-12 sm:py-20">
      <p className="eyebrow">Adjusted rankings / Binary resolutions only</p>
      <h1 className="editorial mt-4 text-6xl font-semibold tracking-[-0.05em] sm:text-8xl">Leaderboard</h1>
      <LeaderboardTable scorecards={eligible} />
    </div>
  );
}
