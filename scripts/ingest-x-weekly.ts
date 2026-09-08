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
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://projectlighthouse.dev";
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
      },
      null,
      2,
    ),
  );

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
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
