// Posts a compact ingestion summary to a Slack Incoming Webhook.
// Silent no-op when SLACK_WEBHOOK_URL is unset — safe to call from every
// script and CLI regardless of environment.

export type SlackIngestionSummary = {
  jobLabel: string; // "daily", "backfill 30d", etc.
  runId: string | null;
  siteOrigin: string;
  ingestion: {
    expertsAttempted: number;
    expertsSucceeded: number;
    candidatesReturned: number;
    candidatesInserted: number;
    costUsd: number;
    hitSoftBudget: boolean;
    hitHardBudget: boolean;
    perExpertTop?: Array<{ handle: string; candidatesInserted: number; costUsd: number; status: string }>;
  };
  extraction?: {
    examined: number;
    rejectedByHeuristic: number;
    aiPredictions: number;
    verifierRejected: number;
    autoApproved: number;
    autoRejected: number;
    autoApproverErrors?: number;
    published: number;
    duplicates: number;
    errors: number;
  } | null;
  durationMs: number;
  error?: string | null;
};

function money(v: number): string {
  return `$${v.toFixed(2)}`;
}

export async function postIngestionSummary(summary: SlackIngestionSummary): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;

  const ing = summary.ingestion;
  const ext = summary.extraction;
  const durationMin = (summary.durationMs / 60_000).toFixed(1);
  const budgetIcon = ing.hitHardBudget ? "🛑" : ing.hitSoftBudget ? "⚠️" : "🟢";
  const headerIcon = summary.error ? "❌" : ext?.published && ext.published > 0 ? "🚀" : ing.candidatesInserted > 0 ? "🔎" : "🌙";

  const linkCandidates = `<${summary.siteOrigin}/admin/candidates|Review queue>`;
  const linkIngestion = `<${summary.siteOrigin}/admin/ingestion/x|Ingestion dashboard>`;

  const fields: Array<{ type: "mrkdwn"; text: string }> = [
    { type: "mrkdwn", text: `*Experts*\n${ing.expertsSucceeded}/${ing.expertsAttempted} succeeded` },
    { type: "mrkdwn", text: `*Cost*\n${money(ing.costUsd)} ${budgetIcon}` },
    { type: "mrkdwn", text: `*Candidates*\n${ing.candidatesReturned} found, ${ing.candidatesInserted} verified` },
    { type: "mrkdwn", text: `*Runtime*\n${durationMin} min` },
  ];

  if (ext) {
    const judgeErrors = ext.autoApproverErrors ?? 0;
    const judgeSuffix = judgeErrors > 0 ? ` · ⚠️ ${judgeErrors} judge error(s)` : "";
    fields.push(
      { type: "mrkdwn", text: `*Predictions extracted*\n${ext.aiPredictions} (verifier kept ${ext.aiPredictions - ext.verifierRejected})` },
      { type: "mrkdwn", text: `*Auto-approver*\n${ext.autoApproved} approved · ${ext.autoRejected} rejected${judgeSuffix}` },
      { type: "mrkdwn", text: `*Published to site*\n${ext.published} live${ext.errors ? ` · ${ext.errors} error(s)` : ""}` },
    );
  }

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${headerIcon} Project Lighthouse — ${summary.jobLabel}`, emoji: true },
    },
    { type: "section", fields },
  ];

  if (summary.error) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Error*\n\`\`\`${summary.error.slice(0, 500)}\`\`\`` },
    });
  } else if (ing.perExpertTop && ing.perExpertTop.length > 0) {
    const rows = ing.perExpertTop
      .filter((row) => row.candidatesInserted > 0)
      .slice(0, 5)
      .map((row) => `• @${row.handle} — ${row.candidatesInserted} new · ${money(row.costUsd)}`)
      .join("\n");
    if (rows) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Top experts this run*\n${rows}` },
      });
    }
  }

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `${linkCandidates}  ·  ${linkIngestion}` },
      ...(summary.runId ? [{ type: "mrkdwn", text: `run_id: \`${summary.runId}\`` }] : []),
    ],
  });

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `Project Lighthouse — ${summary.jobLabel}: ${ext?.published ?? 0} published, ${ing.candidatesInserted} new sources, ${money(ing.costUsd)}`, blocks }),
    });
  } catch {
    // Slack failures never break the ingestion run.
  }
}
