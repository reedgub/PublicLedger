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

  return (
    <div className="container-receipts py-12 sm:py-20">
      <p className="eyebrow">Adjusted rankings / Binary resolutions only</p>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_430px] lg:items-end">
        <h1 className="editorial text-6xl font-semibold tracking-[-0.05em] sm:text-8xl">Leaderboard</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Default rank uses the lower bound of an 80% Wilson confidence interval. At least 5
          correct/incorrect resolutions are required; fewer than 20 is marked provisional.
        </p>
      </div>

      {eligible.length > 0 ? (
        <>
          <LeaderboardTable scorecards={eligible} />
          <p className="mt-5 text-xs text-muted-foreground">
            Lower Brier scores indicate better calibration. Partial, ambiguous, and void outcomes
            never enter binary accuracy.
          </p>
        </>
      ) : (
        <>
          <RosterPreview
            experts={rosterExperts}
            eyebrow={`Roster / ${rosterExperts.length} profiles / 0 eligible`}
          />
          <p className="mt-5 text-xs text-muted-foreground">
            Project Lighthouse intentionally starts empty. The extraction pipeline (X + OpenAI) must run
            against real posts, produce candidates that clear the strict publication thresholds,
            and accumulate at least five resolved binary outcomes per expert before that expert
            appears on the ranked leaderboard.
          </p>
        </>
      )}
    </div>
  );
}
