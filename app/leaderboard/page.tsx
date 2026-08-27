import type { Metadata } from "next";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { getExpertScorecards } from "@/lib/data/public";

export const metadata: Metadata = { title: "Leaderboard", description: "Expert track records ranked by the 80% Wilson lower confidence bound—not raw accuracy." };

export default async function LeaderboardPage() {
  const scorecards = (await getExpertScorecards()).filter((scorecard) => scorecard.leaderboardEligible);
  return (
    <div className="container-receipts py-12 sm:py-20">
      <p className="eyebrow">Adjusted rankings / Binary resolutions only</p>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_430px] lg:items-end">
        <h1 className="editorial text-6xl font-semibold tracking-[-0.05em] sm:text-8xl">Leaderboard</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">Default rank uses the lower bound of an 80% Wilson confidence interval. At least 5 correct/incorrect resolutions are required; fewer than 20 is marked provisional.</p>
      </div>
      <LeaderboardTable scorecards={scorecards} />
      <p className="mt-5 text-xs text-muted-foreground">Lower Brier scores indicate better calibration. Partial, ambiguous, and void outcomes never enter binary accuracy.</p>
    </div>
  );
}
