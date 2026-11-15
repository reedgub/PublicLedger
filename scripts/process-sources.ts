// Process collected sources through the ONE publish path: the low-cost
// cascade (heuristic → screen → extraction → deterministic checks) and the
// cascade verifier, which publishes or rejects. Kept as an entry point for
// seed-all and the legacy xAI discovery scripts; it no longer has its own
// extraction, auto-approver or publish logic.

import "dotenv/config";
import { closeDatabase } from "@/lib/db/postgres";
import { revalidateLive } from "@/lib/http/revalidate";
import { runCascade } from "@/lib/pipeline/cascade";
import { createBudgetGuard } from "@/lib/pipeline/spend";
import { verifyPendingSync } from "@/lib/pipeline/verifyRunner";

export type ProcessingSummary = {
  examined: number;
  rejectedByHeuristic: number;
  droppedByScreen: number;
  candidates: number;
  candidatesRejected: number;
  duplicates: number;
  published: number;
  verifierRejected: number;
  deferredByBudget: number;
  costUsd: number;
  errors: number;
};

export async function processSources(): Promise<ProcessingSummary> {
  const guard = await createBudgetGuard("daily");
  const cascade = await runCascade({ scope: "daily", guard });
  const verified = await verifyPendingSync({ guard, scope: "daily" });
  if (verified.published > 0) await revalidateLive(["/", "/leaderboard"]);
  return {
    examined: cascade.sourcesExamined,
    rejectedByHeuristic: cascade.droppedByHeuristic,
    droppedByScreen: cascade.droppedByScreen,
    candidates: cascade.candidatesPending,
    candidatesRejected: cascade.candidatesRejected,
    duplicates: cascade.duplicates + verified.duplicates,
    published: verified.published,
    verifierRejected: verified.rejected,
    deferredByBudget: cascade.deferredByBudget,
    costUsd: cascade.costUsd,
    errors: cascade.extractionErrors + verified.errors + (cascade.providerError ? 1 : 0),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  processSources()
    .then((summary) => console.log(JSON.stringify({ stage: "processing_summary", ...summary })))
    .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
    .finally(closeDatabase);
}
