// Stage 3 batch lifecycle.
//
//   pnpm verify:collect            # apply results of finished batches
//   pnpm verify:submit [--backfill] # submit pending candidates as a new batch
//   pnpm verify:sync  [--backfill]  # verify pending candidates immediately (small volumes)
import "dotenv/config";
import { closeDatabase } from "@/lib/db/postgres";
import { revalidateLive } from "@/lib/http/revalidate";
import { createBudgetGuard } from "@/lib/pipeline/spend";
import { collectVerificationBatches, submitVerificationBatch, verifyPendingSync } from "@/lib/pipeline/verifyRunner";

async function main() {
  const command = process.argv[2] ?? "collect";
  const scope = process.argv.includes("--backfill") ? "backfill" : "daily";
  if (command === "collect") {
    const result = await collectVerificationBatches({ scope });
    console.log(JSON.stringify({ stage: "verify_collect_summary", ...result }));
    if (result.published > 0) await revalidateLive(["/", "/leaderboard"]);
    return;
  }
  const guard = await createBudgetGuard(scope);
  if (command === "submit") {
    console.log(JSON.stringify({ stage: "verify_batch_submitted", ...(await submitVerificationBatch({ guard, scope })) }));
    return;
  }
  if (command === "sync") {
    const result = await verifyPendingSync({ guard, scope });
    console.log(JSON.stringify({ stage: "verify_sync_summary", ...result }));
    if (result.published > 0) await revalidateLive(["/", "/leaderboard"]);
    return;
  }
  throw new Error(`Unknown command "${command}". Use collect, submit or sync.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(closeDatabase);
