"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PredictionList } from "@/components/prediction-list";
import { CalibrationChart } from "@/components/calibration-chart";
import { EmptyState } from "@/components/empty-state";
import { CATEGORIES } from "@/lib/constants";
import type { Prediction } from "@/types/domain";

export function ExpertProfileTabs({ predictions }: { predictions: Prediction[] }) {
  const [category, setCategory] = useState("all");
  const [year, setYear] = useState("all");
  const [confidenceOnly, setConfidenceOnly] = useState(false);
  const years = useMemo(() => Array.from(new Set(predictions.map((prediction) => new Date(prediction.predictionDate).getUTCFullYear()))).sort((a, b) => b - a), [predictions]);
  const filtered = useMemo(() => predictions.filter((prediction) =>
    (category === "all" || prediction.categorySlug === category) &&
    (year === "all" || new Date(prediction.predictionDate).getUTCFullYear() === Number(year)) &&
    (!confidenceOnly || prediction.explicitProbability !== null || prediction.confidenceLanguage !== null),
  ), [predictions, category, year, confidenceOnly]);
  const open = filtered.filter((prediction) => ["open", "due", "resolution_pending"].includes(prediction.status));
  const resolved = filtered.filter((prediction) => prediction.resolution);
  const observations = predictions.flatMap((prediction) =>
    prediction.explicitProbability !== null && prediction.resolution?.outcome && ["correct", "incorrect"].includes(prediction.resolution.outcome)
      ? [{ probability: prediction.explicitProbability, outcome: (prediction.resolution.outcome === "correct" ? 1 : 0) as 0 | 1 }]
      : [],
  );
  const topics = Array.from(new Map(predictions.flatMap((prediction) => prediction.topics).map((topic) => [topic.id, topic])).values());

  const list = (items: Prediction[], title: string) => items.length ? <PredictionList predictions={items} /> : <EmptyState title={title} description="No verified Receipts match this view." />;

  return (
    <Tabs defaultValue="overview" className="mt-10">
      <div className="overflow-x-auto border-y border-foreground py-2">
        <TabsList variant="line" className="h-10 gap-5">
          {[["overview", "Overview"], ["open", "Open"], ["resolved", "Resolved"], ["calibration", "Calibration"], ["topics", "Topics"]].map(([value, label]) => <TabsTrigger key={value} value={value} className="rounded-none px-1 font-mono text-[10px] tracking-[0.08em] uppercase">{label}</TabsTrigger>)}
        </TabsList>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <label className="eyebrow flex items-center gap-2">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className="h-8 border bg-card px-2 font-mono text-[10px] text-foreground"><option value="all">All</option>{CATEGORIES.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
        <label className="eyebrow flex items-center gap-2">Year<select value={year} onChange={(event) => setYear(event.target.value)} className="h-8 border bg-card px-2 font-mono text-[10px] text-foreground"><option value="all">All</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="eyebrow flex items-center gap-2 border bg-card px-2"><input type="checkbox" checked={confidenceOnly} onChange={(event) => setConfidenceOnly(event.target.checked)} /> Confidence available</label>
      </div>
      <TabsContent value="overview" className="mt-8">
        <div className="grid gap-12 lg:grid-cols-2">
          <section><h2 className="editorial mb-4 text-3xl font-semibold">Latest calls</h2>{list(filtered.slice(0, 8), "No verified Receipts yet")}</section>
          <div className="space-y-12">
            <section><h2 className="editorial mb-4 text-3xl font-semibold">Notable hits</h2>{list(resolved.filter((prediction) => prediction.resolution?.outcome === "correct").slice(0, 4), "No resolved hits yet")}</section>
            <section><h2 className="editorial mb-4 text-3xl font-semibold">Largest misses</h2>{list(resolved.filter((prediction) => prediction.resolution?.outcome === "incorrect").slice(0, 4), "No resolved misses yet")}</section>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="open" className="mt-8">{list(open, "No open Receipts")}</TabsContent>
      <TabsContent value="resolved" className="mt-8">{list(resolved, "No resolved Receipts")}</TabsContent>
      <TabsContent value="calibration" className="mt-8"><CalibrationChart observations={observations} /></TabsContent>
      <TabsContent value="topics" className="mt-8">
        {topics.length ? <div className="grid gap-px bg-foreground sm:grid-cols-2">{topics.map((topic) => <a key={topic.id} href={`/topics/${topic.slug}`} className="bg-card p-5 hover:bg-muted"><span className="eyebrow">{topic.categorySlug}</span><h3 className="editorial mt-3 text-2xl font-semibold">{topic.title}</h3></a>)}</div> : <EmptyState title="No linked topics" description="Topics are linked only when the prediction and event are a high-confidence semantic match." />}
      </TabsContent>
    </Tabs>
  );
}
