import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Methodology", description: "The methodology for prediction inclusion, resolution, scoring, markets, and corrections." };

const sections = [
  ["01", "What counts as a prediction?", "A public statement must describe a future, observable outcome with defensible resolution criteria. Opinions, rhetorical questions, vague futurism, jokes, and claims that need invented precision are rejected."],
  ["02", "Why are some predictions rejected?", "Project Lighthouse prefers a smaller set of defensible records. A claim is rejected when the author is not the speaker, the exact quote cannot be verified, the deadline is unsupported, the normalized meaning is stronger or weaker than the source, or the outcome cannot be measured objectively."],
  ["03", "Why don’t we infer probabilities?", "Words such as likely, probably, and almost certainly remain verbal confidence. A numeric probability is stored only when the source explicitly states one. Calibration and Brier scoring use only those explicit numbers."],
  ["04", "How is correctness determined?", "Every published Receipt freezes its normalized claim and resolution criteria. At the deadline, evidence is checked in priority order: an exactly equivalent resolved market, authoritative primary evidence, then multiple independent high-quality secondary sources. A separate verifier audits proposed outcomes."],
  ["05", "What do Partial, Ambiguous, and Void mean?", "Partial means a multi-part or threshold claim was only partly satisfied. Ambiguous means available evidence cannot support a defensible binary outcome. Void means the event definition changed materially or the claim became unresolvable. None enters binary accuracy."],
  ["06", "How does leaderboard ranking work?", "Raw accuracy rewards tiny samples. The default leaderboard therefore uses the lower bound of an 80% Wilson confidence interval on Correct and Incorrect outcomes. At least five binary resolutions are required; fewer than twenty is Provisional."],
  ["07", "Why does sample size matter?", "A perfect 2–0 record is not comparable with a long track record. Sample size changes how much confidence a reader should place in an observed accuracy, which is why counts are displayed beside every percentage."],
  ["08", "How are prediction markets used?", "Polymarket is an informational source for current-event discovery, probability context, topic creation, and possible resolution support. It is not a trading feature. A market is linked only when outcome definition and timeframe match; today’s price is never substituted for an unavailable historical price."],
  ["09", "How do corrections work?", "Published prediction substance is immutable in normal operations. Administrative corrections require a reason and create an audit event. Deleted sources are treated neutrally as unavailable; stale deleted text is not displayed or scored without valid alternate evidence."],
] as const;

export default function MethodologyPage() {
  return (
    <div className="container-receipts py-12 sm:py-20">
      <div className="grid gap-8 border-b border-foreground pb-12 lg:grid-cols-[1fr_420px] lg:items-end"><div><p className="eyebrow">Methodology / Trust contract</p><h1 className="editorial mt-4 text-6xl font-semibold tracking-[-0.05em] sm:text-8xl">Methodology</h1></div><p className="editorial text-2xl leading-snug">Precision is a feature. The source, normalization, deadline, criteria, evidence, and changes must all remain inspectable.</p></div>
      <div className="mx-auto mt-12 max-w-4xl divide-y divide-border border-y border-foreground">
        {sections.map(([index, title, body]) => <section key={index} className="grid gap-4 py-8 md:grid-cols-[80px_1fr]"><span className="metric text-sm text-muted-foreground">{index}</span><div><h2 className="editorial text-3xl font-semibold">{title}</h2><p className="mt-4 leading-relaxed text-muted-foreground">{body}</p></div></section>)}
      </div>
      <div className="mx-auto mt-10 max-w-4xl border border-foreground bg-card p-6"><p className="eyebrow">Core principle</p><p className="editorial mt-3 text-3xl font-semibold">Project Lighthouse does not say an expert is trustworthy. It shows the source-backed track record so readers can evaluate it.</p><Link href="/submit" className="mt-5 inline-block text-sm font-semibold underline underline-offset-4">Submit a source for review</Link></div>
    </div>
  );
}
