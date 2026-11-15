// Run the low-cost cascade over unprocessed sources, then hand surviving
// candidates to stage 3 (batch verification by default).
//
//   pnpm cascade                     # live sources, daily budget
//   pnpm cascade --mode backfill     # backfilled sources, backfill budget
//   pnpm cascade --max-sources 500 --budget 1.50
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { revalidateLive } from "@/lib/http/revalidate";
import { runCascade } from "@/lib/pipeline/cascade";
import { createBudgetGuard, type SpendScope } from "@/lib/pipeline/spend";
import { submitVerificationBatch, verifyPendingSync } from "@/lib/pipeline/verifyRunner";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function processCascade(options: { mode?: "live" | "backfill"; maxSources?: number; budgetUsd?: number; skipVerify?: boolean } = {}) {
  const scope: SpendScope = options.mode === "backfill" ? "backfill" : "daily";
  const runId = randomUUID();
  const guard = await createBudgetGuard(scope, { capUsd: options.budgetUsd });
  console.log(JSON.stringify({ stage: "cascade_start", run_id: runId, scope, mode: options.mode ?? "all", budget_cap_usd: guard.capUsd, already_spent_usd: Number(guard.spentUsd.toFixed(4)) }));
  const cascade = await runCascade({ scope, guard, mode: options.mode, maxSources: options.maxSources, runId });
  console.log(JSON.stringify({ stage: "cascade_summary", ...cascade, costUsd: Number(cascade.costUsd.toFixed(4)) }));
  // A refused provider (no credits, bad key) should turn the workflow red, not pass silently.
  if (cascade.providerError) process.exitCode = 1;
  if (options.skipVerify) return { cascade, verify: null };
  if (env.VERIFIER_MODE === "sync") {
    const verify = await verifyPendingSync({ guard, scope, runId });
    console.log(JSON.stringify({ stage: "verify_sync_summary", ...verify }));
    if (verify.providerError) process.exitCode = 1;
    if (verify.published > 0) await revalidateLive(["/", "/leaderboard"]);
    return { cascade, verify };
  }
  const batch = await submitVerificationBatch({ guard, scope });
  console.log(JSON.stringify({ stage: "verify_batch_submitted", ...batch }));
  if (batch.providerError) process.exitCode = 1;
  return { cascade, verify: batch };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = arg("--mode");
  processCascade({
    mode: mode === "backfill" || mode === "live" ? mode : undefined,
    maxSources: arg("--max-sources") ? Number(arg("--max-sources")) : undefined,
    budgetUsd: arg("--budget") ? Number(arg("--budget")) : undefined,
    skipVerify: process.argv.includes("--skip-verify"),
  })
    .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
    .finally(closeDatabase);
}
