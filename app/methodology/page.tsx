import type { Metadata } from "next";
import Link from "next/link";
import { METHODOLOGY_SECTIONS as sections } from "@/lib/methodology";

export const metadata: Metadata = { title: "Methodology", description: "The methodology for prediction inclusion, resolution, scoring, markets, and corrections." };



export default function MethodologyPage() {
  return (
    <div className="container-page py-12 sm:py-20">
      <div className="grid gap-8 border-b border-foreground/20 pb-12 lg:grid-cols-[1fr_420px] lg:items-end"><div><p className="eyebrow">Methodology / Trust contract</p><h1 className="display-1 mt-4 ">Methodology</h1></div><p className="lede text-lg text-foreground/80">Precision is a feature. The source, normalization, deadline, criteria, evidence, and changes must all remain inspectable.</p></div>
      <div className="mx-auto mt-12 max-w-4xl divide-y divide-border border-y border-border">
        {sections.map(([index, title, body]) => <section key={index} className="grid gap-4 py-8 md:grid-cols-[80px_1fr]"><span className="metric text-sm text-muted-foreground">{index}</span><div><h2 className="editorial text-3xl">{title}</h2><p className="mt-4 text-[15px] leading-relaxed font-light text-muted-foreground">{body}</p></div></section>)}
      </div>
      <div className="surface-light mx-auto mt-16 max-w-4xl rounded-[20px] p-8 sm:p-12"><p className="eyebrow">Core principle</p><p className="editorial mt-4 text-3xl leading-tight sm:text-4xl">PublicLedger does not say an expert is trustworthy. It shows the source-backed track record so readers can evaluate it.</p><Link href="/submit" className="mt-5 inline-block text-sm font-semibold underline underline-offset-4">Submit a source for review</Link></div>
    </div>
  );
}
