import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { ExpertProfileTabs } from "@/components/expert-profile-tabs";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES } from "@/lib/constants";
import { getExpertBySlug } from "@/lib/data/public";

export async function generateMetadata({ params }: PageProps<"/experts/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const result = await getExpertBySlug(slug);
  if (!result) return { title: "Expert not found" };
  return {
    title: result.scorecard.expert.displayName,
    description: `Verified prediction track record for ${result.scorecard.expert.displayName}.`,
    alternates: { canonical: `/experts/${slug}` },
  };
}

export default async function ExpertPage({ params }: PageProps<"/experts/[slug]">) {
  const { slug } = await params;
  const result = await getExpertBySlug(slug);
  if (!result) notFound();
  const { scorecard, predictions } = result;
  const expert = scorecard.expert;
  const accuracy = scorecard.accuracy === null ? "—" : `${Math.round(scorecard.accuracy * 100)}%`;
  return (
    <div className="container-receipts py-12 sm:py-20">
      <div className="grid gap-8 border-b border-foreground pb-10 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="flex items-start gap-5">
          {expert.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={expert.avatarUrl}
              alt=""
              className="size-16 shrink-0 border border-foreground bg-card object-cover sm:size-20"
              loading="lazy"
            />
          ) : (
            <div className="metric flex size-16 shrink-0 items-center justify-center border border-foreground bg-card text-xl font-bold sm:size-20">
              {expert.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}
            </div>
          )}
          <div>
            <p className="eyebrow">Expert record</p>
            <h1 className="editorial mt-2 text-5xl font-semibold tracking-[-0.04em] sm:text-7xl">{expert.displayName}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {expert.xHandle && <span className="metric">@{expert.xHandle}</span>}
              {expert.sourceStatus === "verified" ? <Badge variant="outline" className="rounded-none text-[9px] uppercase"><BadgeCheck className="size-3" />Identity verified</Badge> : <Badge variant="outline" className="rounded-none text-[9px] uppercase">{expert.sourceStatus}</Badge>}
              <span>{expert.headline}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="rounded-none">{CATEGORIES.find((item) => item.slug === expert.primaryCategorySlug)?.name}</Badge>
          {expert.sourceStatus === "verified" && expert.xHandle && <Link href={`https://x.com/${expert.xHandle}`} target="_blank" rel="noopener noreferrer" className="metric flex items-center gap-1 text-[10px] uppercase hover:underline">Source profile <ArrowUpRight className="size-3" /></Link>}
        </div>
      </div>

      <dl className="grid border-b border-foreground sm:grid-cols-2 lg:grid-cols-4">
        <div className="border-b py-7 sm:border-r lg:border-b-0"><dt className="eyebrow">Accuracy</dt><dd className="metric mt-2 text-5xl font-semibold tracking-[-0.08em]">{accuracy}</dd>{scorecard.provisional && scorecard.resolvedPredictions > 0 && <span className="mt-2 inline-block border border-provisional px-1.5 font-mono text-[8px] text-provisional uppercase">Provisional</span>}</div>
        <div className="border-b py-7 sm:pl-6 lg:border-b-0"><dt className="eyebrow">Resolved</dt><dd className="metric mt-2 text-3xl">{scorecard.correctPredictions} / {scorecard.resolvedPredictions}</dd><dd className="eyebrow mt-1">Correct / resolved</dd></div>
        <div className="border-b py-7 sm:border-r lg:border-y-0 lg:border-l lg:pl-6"><dt className="eyebrow">Total predictions</dt><dd className="metric mt-2 text-3xl">{scorecard.totalPredictions}</dd></div>
        <div className="py-7 sm:pl-6"><dt className="eyebrow">Open</dt><dd className="metric mt-2 text-3xl">{scorecard.openPredictions}</dd></div>
      </dl>
      <ExpertProfileTabs predictions={predictions} />
    </div>
  );
}
