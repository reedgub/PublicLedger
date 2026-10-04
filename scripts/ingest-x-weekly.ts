import "dotenv/config";
import { closeDatabase } from "@/lib/db/postgres";
import { runXaiWeekly } from "@/lib/ingestion/x-runner";
import { postIngestionSummary } from "@/lib/ingestion/slack";
import { processSources, type ProcessingSummary } from "@/scripts/process-sources";

type Flags = {
  expert?: string;
  backfillDays?: number;
  maxCandidates?: number;
  maxWindows?: number;
  concurrency?: number;
  dryRun: boolean;
  skipExtraction: boolean;
};

function parseFlags(argv: string[]): Flags {
  const get = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const num = (name: string) => {
    const raw = get(name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  return {
    expert: get("--expert"),
    backfillDays: num("--backfill-days"),
    maxCandidates: num("--max-candidates"),
    maxWindows: num("--max-windows"),
    concurrency: num("--concurrency"),
    dryRun: argv.includes("--dry-run"),
    skipExtraction: argv.includes("--skip-extraction"),
  };
}

function jobLabel(flags: Flags): string {
  if (flags.dryRun) return "dry-run preview";
  if (flags.expert && flags.backfillDays) return `backfill ${flags.backfillDays}d for @${flags.expert.replace(/^@/, "")}`;
  if (flags.expert) return `daily for @${flags.expert.replace(/^@/, "")}`;
  if (flags.backfillDays && flags.backfillDays > 14) return `backfill ${flags.backfillDays}d (all experts)`;
  return "daily ingestion";
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const startedAt = Date.now();
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://publicledger.dev";
  let extraction: ProcessingSummary | null = null;
  let fatalError: string | null = null;

  const summary = await runXaiWeekly({
    onlyExpertSlug: flags.expert,
    backfillDays: flags.backfillDays,
    maxCandidatesPerWindow: flags.maxCandidates,
    maxWindowsPerExpert: flags.maxWindows,
    concurrency: flags.concurrency,
    dryRun: flags.dryRun,
  }).catch((error) => {
    fatalError = error instanceof Error ? error.message : String(error);
    throw error;
  });

  console.log(
    JSON.stringify(
      {
        stage: "xai_weekly_summary",
        run_id: summary.runId,
        experts_attempted: summary.expertsAttempted,
        experts_succeeded: summary.expertsSucceeded,
        candidates_returned: summary.totalCandidatesReturned,
        candidates_inserted: summary.totalCandidatesInserted,
        cost_usd: Number(summary.totalCostUsd.toFixed(4)),
        hit_soft_budget: summary.hitSoftBudget,
        hit_hard_budget: summary.hitHardBudget,
        auth_failure: summary.authFailure,
      },
      null,
      2,
    ),
  );

  // Two conditions promote a "successful" run to a visible failure so the
  // daily GitHub Action lights up red instead of green-with-zero-rows:
  //   1. An xAI auth rejection (out of credits, revoked key) — we already
  //      short-circuited the batch, and continuing tomorrow will just hit
  //      the same wall.
  //   2. A total wipeout — every attempted expert failed for some other
  //      reason. Zero candidates over ~80 experts is not a normal day.
  // Both cases used to exit 0 with a Slack post nobody reads. Now the
  // Actions email and the check on the ingest-x workflow surface the
  // failure the same day it happens.
  const totalWipeout =
    summary.expertsAttempted > 0 && summary.expertsSucceeded === 0 && !summary.hitHardBudget;
  if (summary.authFailure || totalWipeout) {
    const banner = summary.authFailure
      ? `xAI auth failure (${summary.perExpert.find((r) => r.reason)?.reason ?? "401/403"}). ` +
        `Top up credits at https://console.x.ai or rotate XAI_API_KEY.`
      : `Total wipeout: 0 / ${summary.expertsAttempted} experts produced candidates. ` +
        `Inspect x_discovery_runs.raw for the underlying error.`;
    console.error(`\n[31mDaily ingestion failed:[0m ${banner}\n`);
    fatalError = fatalError ?? banner;
  }

  if (!flags.skipExtraction && !flags.dryRun) {
    console.log(JSON.stringify({ stage: "extraction_start" }));
    try {
      extraction = await processSources();
      console.log(JSON.stringify({ stage: "extraction_summary", ...extraction }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "extraction failed";
      console.error(`Extraction stage failed: ${message}`);
      fatalError = fatalError ?? message;
    }
  }

  await postIngestionSummary({
    jobLabel: jobLabel(flags),
    runId: summary.runId,
    siteOrigin,
    durationMs: Date.now() - startedAt,
    ingestion: {
      expertsAttempted: summary.expertsAttempted,
      expertsSucceeded: summary.expertsSucceeded,
      candidatesReturned: summary.totalCandidatesReturned,
      candidatesInserted: summary.totalCandidatesInserted,
      costUsd: summary.totalCostUsd,
      hitSoftBudget: summary.hitSoftBudget,
      hitHardBudget: summary.hitHardBudget,
      perExpertTop: summary.perExpert
        .slice()
        .sort((a, b) => b.candidatesInserted - a.candidatesInserted)
        .map((row) => ({
          handle: row.handle,
          candidatesInserted: row.candidatesInserted,
          costUsd: row.costUsd,
          status: row.status,
        })),
    },
    extraction,
    error: fatalError,
  });

  if (fatalError) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
