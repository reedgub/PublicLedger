import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, CircleDotDashed, FileCheck2, Landmark } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { ShareButton } from "@/components/share-button";
import { CATEGORIES } from "@/lib/constants";
import { getPredictionById } from "@/lib/data/public";
import { formatUtcAuditTime, formatUtcDate, formatUtcDateTime } from "@/lib/dates";

export async function generateMetadata({ params }: PageProps<"/predictions/[id]">): Promise<Metadata> {
  const { id } = await params;
  const prediction = await getPredictionById(id);
  if (!prediction) return { title: "Prediction not found" };
  return {
    title: `${prediction.expert.displayName}: ${prediction.normalizedClaim}`,
    description: `A source-backed prediction by ${prediction.expert.displayName}, recorded on ${formatUtcDate(prediction.predictionDate, "long")}.`,
    alternates: { canonical: `/predictions/${id}` },
  };
}

function sourceHref(sourceType: string, path: string | null): string | null {
  if (!path) return null;
  if (sourceType === "x" && path.startsWith("/") && !path.startsWith("//")) return `https://x.com${path}`;
  try {
    const url = new URL(path);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

export default async function PredictionPage({ params }: PageProps<"/predictions/[id]">) {
  const { id } = await params;
  const prediction = await getPredictionById(id);
  if (!prediction) notFound();
  const displayStatus = prediction.resolution?.outcome ?? prediction.status;
  const sourceUrl = sourceHref(prediction.source.sourceType, prediction.source.canonicalPath);
  const category = CATEGORIES.find((item) => item.slug === prediction.categorySlug)?.name;
  return (
    <div className="container-page py-10 sm:py-16">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center justify-between gap-4"><p className="eyebrow">Record / {prediction.id.slice(0, 8)}</p><ShareButton title={`${prediction.expert.displayName} — PublicLedger`} text={prediction.normalizedClaim} /></div>
        <article className="paper-edge border-y border-foreground bg-card px-5 py-8 sm:px-12 sm:py-12">
          <header className="border-b border-dashed border-border pb-10 text-center">
            <p className="font-mono text-sm font-black tracking-[0.24em]">PUBLICLEDGER</p>
            <div className="mt-5 flex items-center justify-center gap-2">
              {prediction.recordType === "take" && (
                <span className="border border-provisional px-2 py-1 font-mono text-[9px] text-provisional uppercase tracking-[0.14em]">Take</span>
              )}
              <StatusBadge status={displayStatus} />
            </div>
            <h1 className="editorial mx-auto mt-7 max-w-3xl text-4xl font-semibold leading-[1.03] tracking-[-0.035em] text-balance sm:text-6xl">{prediction.normalizedClaim}</h1>
            {prediction.recordType === "take" && prediction.imputationNote && (
              <p className="mx-auto mt-6 max-w-2xl border border-provisional/40 bg-provisional/5 p-3 text-left text-xs leading-relaxed text-muted-foreground">
                <span className="eyebrow mb-1 block text-provisional">Editor&apos;s note</span>
                {prediction.imputationNote}
              </p>
            )}
          </header>

          <dl className="metric grid grid-cols-2 gap-px border-b border-dashed border-border bg-border py-px sm:grid-cols-5">
            {[
              ["Expert", prediction.expert.displayName],
              ["Prediction date", formatUtcDate(prediction.predictionDate)],
              ["Deadline", prediction.resolutionDate ? formatUtcDate(prediction.resolutionDate) : "Event-defined"],
              ["Category", category ?? "Other"],
              ["Explicit confidence", prediction.explicitProbability === null ? prediction.confidenceLanguage ?? "Not stated" : `${Math.round(prediction.explicitProbability * 100)}%`],
            ].map(([label, value]) => <div key={label} className="bg-card px-3 py-4"><dt className="text-[8px] tracking-[0.12em] text-muted-foreground uppercase">{label}</dt><dd className="mt-2 text-[11px] leading-snug">{value}</dd></div>)}
          </dl>

          <section className="border-b border-dashed border-border py-9">
            <p className="eyebrow">Original statement</p>
            {prediction.source.deletedAt || prediction.status === "source_unavailable" ? (
              <div className="mt-4 border border-provisional bg-provisional/5 p-5"><p className="font-semibold uppercase">Source unavailable</p><p className="mt-2 text-sm text-muted-foreground">This source is no longer available through its original platform. This prediction has been removed from public scoring pending alternate verification.</p></div>
            ) : (
              <blockquote className="editorial mt-4 border-l-2 border-foreground pl-5 text-2xl leading-relaxed">“{prediction.source.exactText ?? prediction.sourceQuote}”</blockquote>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span>{prediction.expert.displayName}</span>{prediction.source.authorHandle && <span className="metric">@{prediction.source.authorHandle}</span>}<span className="metric">{formatUtcDateTime(prediction.source.publishedAt)}</span>
              {sourceUrl && !prediction.source.deletedAt && <Link href={sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-semibold text-foreground hover:underline">View source <ArrowUpRight className="size-3" /></Link>}
            </div>
          </section>

          {/*
            When the prediction is resolved, put the payoff here — right under
            the original quote. A reader who shared the link came here to see
            the outcome, not to scroll past three sections of criteria first.
          */}
          {prediction.resolution && (
            <section className="border-b border-dashed border-border py-9">
              <p className="eyebrow flex items-center gap-2"><FileCheck2 className="size-3.5" />Resolution</p>
              <div className="mt-4"><StatusBadge status={prediction.resolution.outcome} /><p className="editorial mt-4 text-2xl leading-snug">{prediction.resolution.explanation}</p><div className="mt-6 space-y-3">{prediction.resolution.evidence.map((evidence) => <Link key={evidence.id} href={evidence.sourcePath} target="_blank" rel="noopener noreferrer" className="block border p-4 hover:bg-muted"><span className="eyebrow">{evidence.isPrimarySource ? "Primary evidence" : "Supporting evidence"}</span><p className="mt-2 font-semibold">{evidence.sourceTitle ?? evidence.publisher ?? "Evidence source"}</p>{evidence.excerpt && <p className="mt-2 text-sm text-muted-foreground">{evidence.excerpt}</p>}</Link>)}</div><p className="metric mt-5 text-[9px] text-muted-foreground">Resolved {formatUtcDateTime(prediction.resolution.resolvedAt)}</p></div>
            </section>
          )}

          <section className="grid border-b border-dashed border-border md:grid-cols-2">
            <div className="py-9 md:border-r md:pr-8"><p className="eyebrow">Normalized claim</p><p className="editorial mt-4 text-2xl font-semibold leading-snug">{prediction.normalizedClaim}</p><p className="mt-4 text-xs text-muted-foreground">A falsifiable interpretation, separate from the exact source text.</p></div>
            <div className="py-9 md:pl-8"><p className="eyebrow">Resolution criteria</p><p className="mt-4 text-sm leading-relaxed">{prediction.resolutionCriteria}</p></div>
          </section>

          <section className="border-b border-dashed border-border py-9">
            <p className="eyebrow flex items-center gap-2"><Landmark className="size-3.5" />Market context</p>
            {prediction.markets.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{prediction.markets.map((market) => <div key={market.id} className="border p-4"><p className="text-sm font-semibold">{market.question}</p><div className="mt-4 flex items-end justify-between"><span className="eyebrow">Current implied Yes</span><span className="metric text-3xl">{market.yesProbability === null ? "—" : `${Math.round(market.yesProbability * 100)}%`}</span></div><p className="metric mt-3 text-[9px] text-muted-foreground">Updated {formatUtcDateTime(market.fetchedAt)}</p></div>)}</div>
              : <p className="mt-4 text-sm text-muted-foreground">No high-confidence matching market is linked. Loose thematic matches are not shown.</p>}
          </section>

          {!prediction.resolution && (
            <section className="border-b border-dashed border-border py-9">
              <p className="eyebrow flex items-center gap-2"><FileCheck2 className="size-3.5" />Resolution</p>
              <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><CircleDotDashed className="size-4" />This prediction remains open.</p>
            </section>
          )}

          <section className="py-9"><p className="eyebrow flex items-center justify-between"><span>Audit trail</span><Link href={`/predictions/${prediction.id}/history`} className="text-[10px] font-semibold text-foreground uppercase tracking-[0.14em] hover:underline">View full history</Link></p><ol className="mt-5 border-l border-border pl-5 text-sm"><li className="relative pb-5 before:absolute before:-left-[23px] before:top-1.5 before:size-1.5 before:bg-foreground"><span className="font-semibold">Source recorded</span><span className="metric ml-3 text-[9px] text-muted-foreground">{formatUtcAuditTime(prediction.source.publishedAt)}</span></li>{prediction.publishedAt && <li className="relative pb-5 before:absolute before:-left-[23px] before:top-1.5 before:size-1.5 before:bg-foreground"><span className="font-semibold">Prediction verified and frozen</span><span className="metric ml-3 text-[9px] text-muted-foreground">{formatUtcAuditTime(prediction.publishedAt)}</span></li>}{prediction.resolution?.approvedAt && <li className="relative before:absolute before:-left-[23px] before:top-1.5 before:size-1.5 before:bg-foreground"><span className="font-semibold">Resolution approved</span><span className="metric ml-3 text-[9px] text-muted-foreground">{formatUtcAuditTime(prediction.resolution.approvedAt)}</span></li>}</ol></section>
        </article>
        <div className="mt-6 flex items-center justify-between gap-4 text-xs text-muted-foreground"><Link href="/methodology" className="hover:underline">Methodology</Link><Link href={`/submit?type=issue&prediction=${prediction.id}`} className="hover:underline">Report an issue</Link></div>
      </div>
    </div>
  );
}
