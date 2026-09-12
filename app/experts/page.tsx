import type { Metadata } from "next";
import { ExpertDirectory } from "@/components/expert-directory";
import { getExperts } from "@/lib/data/public";

export const metadata: Metadata = { title: "Experts", description: "Browse the public-figure discovery roster and verified prediction track records." };

export default async function ExpertsPage() {
  const experts = await getExperts();
  return (
    <div className="container-page py-12 sm:py-20">
      <p className="eyebrow">Directory / {experts.length} profiles</p>
      <div className="mt-4 grid gap-6 md:grid-cols-[1fr_380px] md:items-end">
        <h1 className="editorial text-6xl font-semibold tracking-[-0.05em] sm:text-8xl">Experts</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">A discovery roster of influential public figures. Handles remain unverified until confirmed through the official X API; inclusion is not an endorsement.</p>
      </div>
      <ExpertDirectory experts={experts} />
    </div>
  );
}
