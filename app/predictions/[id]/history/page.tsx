import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPredictionById, getPredictionHistory } from "@/lib/data/public";
import { formatUtcAuditTime } from "@/lib/dates";

export async function generateMetadata({ params }: PageProps<"/predictions/[id]/history">): Promise<Metadata> {
  const { id } = await params;
  const prediction = await getPredictionById(id);
  if (!prediction) return { title: "Prediction history not found" };
  return {
    title: `Audit history — ${prediction.normalizedClaim.slice(0, 80)}`,
    description: `Complete audit trail for a source-backed prediction by ${prediction.expert.displayName}.`,
    alternates: { canonical: `/predictions/${id}/history` },
    robots: { index: false, follow: false },
  };
}

// Actor-type + action → friendly label. We keep this off the DB so we can
// evolve wording without a migration. Unknown actions render as-is.
const ACTION_LABELS: Record<string, string> = {
  prediction_admin_approved: "Admin approved & published",
  prediction_auto_verified: "Auto-verified by pipeline",
  prediction_auto_approved: "Auto-approved by LLM judge",
  prediction_rejected: "Rejected",
  duplicate_merged: "Merged as duplicate",
  resolution_proposed: "Resolution proposed",
  resolution_approved: "Resolution approved",
  resolution_changed: "Resolution changed",
  source_unavailable_marked: "Source marked unavailable",
  correction_applied: "Correction applied",
};

export default async function PredictionHistoryPage({ params }: PageProps<"/predictions/[id]/history">) {
  const { id } = await params;
  const [prediction, history] = await Promise.all([getPredictionById(id), getPredictionHistory(id)]);
  if (!prediction) notFound();
  return (
    <div className="container-receipts py-10 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <Link href={`/predictions/${prediction.id}`} className="eyebrow flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-3" /> Back to receipt
        </Link>
        <p className="eyebrow mt-6">Audit trail / Prediction {prediction.id.slice(0, 8)}</p>
        <h1 className="editorial mt-3 text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">Full history</h1>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
          Every state change we record for this receipt, in order. Published prediction substance is immutable; if a
          correction was needed it appears here with the reason.
        </p>
        <blockquote className="editorial mt-8 border-l-2 border-foreground pl-4 text-lg leading-snug">
          &ldquo;{prediction.normalizedClaim}&rdquo;
          <span className="eyebrow mt-2 block">{prediction.expert.displayName}</span>
        </blockquote>

        {history.length === 0 ? (
          <p className="mt-10 border border-dashed py-16 text-center text-sm text-muted-foreground">No audit rows recorded yet.</p>
        ) : (
          <ol className="mt-10 border-l border-border pl-5">
            {history.map((entry) => (
              <li key={entry.id} className="relative pb-8 before:absolute before:-left-[23px] before:top-2 before:size-1.5 before:bg-foreground">
                <p className="font-semibold">{ACTION_LABELS[entry.action] ?? entry.action}</p>
                <p className="metric mt-1 text-[10px] text-muted-foreground">
                  {entry.actorType.toUpperCase()} · {formatUtcAuditTime(entry.createdAt)}
                </p>
                {entry.reason && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{entry.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
