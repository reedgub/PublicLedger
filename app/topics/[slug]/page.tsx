import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BarChart3, CalendarClock, FileText } from "lucide-react";
import { MarketCard } from "@/components/market-card";
import { PredictionList } from "@/components/prediction-list";
import { SectionHeading } from "@/components/section-heading";
import { EmptyState } from "@/components/empty-state";
import { CATEGORIES } from "@/lib/constants";
import { getTopicBySlug } from "@/lib/data/public";
import { formatUtcDate } from "@/lib/dates";

const money = (value: number | null) => value == null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", style: "currency", currency: "USD" }).format(value);

export async function generateMetadata({ params }: PageProps<"/topics/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const result = await getTopicBySlug(slug);
  if (!result) return { title: "Topic not found" };
  return { title: result.topic.title, description: result.topic.description, alternates: { canonical: `/topics/${slug}` } };
}

export default async function TopicPage({ params }: PageProps<"/topics/[slug]">) {
  const { slug } = await params;
  const result = await getTopicBySlug(slug);
  if (!result) notFound();
  const { topic, predictions } = result;
  const markets = topic.markets ?? [];
  const primaryMarket = markets[0];
  const open = predictions.filter((prediction) => ["open", "due", "resolution_pending"].includes(prediction.status));
  const resolved = predictions.filter((prediction) => prediction.resolution);
  return (
    <div className="container-page py-12 sm:py-20">
      <div className="border-b border-foreground/20 pb-10">
        <p className="eyebrow">Topic / {CATEGORIES.find((item) => item.slug === topic.categorySlug)?.name}</p>
        <h1 className="display-1 mt-4 max-w-5xl text-balance">{topic.title}</h1>
        {topic.description && <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">{topic.description}</p>}
      </div>
      <dl className="grid border-b border-foreground/20 sm:grid-cols-3">
        <div className="border-b py-6 sm:border-r sm:border-b-0"><dt className="eyebrow flex items-center gap-2"><BarChart3 className="size-3.5" />Market probability</dt><dd className="metric mt-2 text-5xl tracking-[-0.08em]">{primaryMarket?.yesProbability == null ? "—" : `${Math.round(primaryMarket.yesProbability * 100)}%`}</dd></div>
        <div className="border-b py-6 sm:border-r sm:border-b-0 sm:pl-6"><dt className="eyebrow">Market volume</dt><dd className="metric mt-2 text-3xl">{money(primaryMarket?.volume ?? null)}</dd></div>
        <div className="py-6 sm:pl-6"><dt className="eyebrow flex items-center gap-2"><CalendarClock className="size-3.5" />Deadline</dt><dd className="metric mt-2 text-xl">{primaryMarket?.endAt ? formatUtcDate(primaryMarket.endAt) : "Event-defined"}</dd></div>
      </dl>

      <section className="mt-16"><SectionHeading index="01" title="Open predictions" aside={<span className="eyebrow flex items-center gap-1"><FileText className="size-3" />{open.length} records</span>} /><div className="mt-5">{open.length ? <PredictionList predictions={open} /> : <EmptyState title="No open predictions" description="No verified open expert predictions are linked to this topic." />}</div></section>
      <section className="mt-16"><SectionHeading index="02" title="Expert positions" /><div className="mt-5 border border-dashed p-8 text-sm text-muted-foreground">PublicLedger does not assign Yes/No orientation unless an expert claim is naturally binary and the direction is explicit. Linked claims appear in the lists above and below without manufactured positioning.</div></section>
      <section className="mt-16"><SectionHeading index="03" title="Resolved predictions" /><div className="mt-5">{resolved.length ? <PredictionList predictions={resolved} /> : <EmptyState title="No resolved predictions" description="Evidence-backed resolutions will appear here when linked predictions reach their deadline." />}</div></section>
      <section className="mt-16"><SectionHeading index="04" title="Related markets" /><div className="mt-6 grid gap-px bg-foreground sm:grid-cols-2 lg:grid-cols-3">{markets.map((market) => <MarketCard key={market.id} market={market} />)}</div>{!markets.length && <p className="mt-5 text-sm text-muted-foreground">No related markets are currently stored.</p>}</section>
    </div>
  );
}
