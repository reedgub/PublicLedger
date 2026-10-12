// Run reports for Slack via an Incoming Webhook. Silent no-op when
// SLACK_WEBHOOK_URL is unset, and a Slack outage never fails a run.
// Message builders are pure so they can be tested without a network.

export type SlackMessage = { text: string; blocks: unknown[] };

export type PublishedItem = { id: string; expertName: string; claim: string; resolutionDate: string | null };

export type SiteSnapshot = {
  newlyPublished: PublishedItem[];
  newlyPublishedCount: number;
  totalPublished: number;
  spendTodayUsd: number;
  spend7dUsd: number;
};

export type DailyReport = {
  x: { experts: number; posts: number; newSources: number; errors: number; stoppedByBudget: boolean } | null;
  feeds: { feeds: number; newSources: number; errors: number } | null;
  podcasts: { shows: number; episodes: number; errors: number; stoppedByBudget: boolean } | null;
  cascade: { sourcesExamined: number; extracted: number; candidatesPending: number; candidatesRejected: number; deferredByBudget: number; providerError?: string } | null;
  verified: { published: number; rejected: number };
  batchSubmitted: number;
  runCostUsd: number;
  durationS: number;
  error?: string | null;
};

export type ResolveReport = {
  due: number;
  verdicts: Array<{ id: string; claim: string; outcome: string }>;
  heldBack: number;
  errors: number;
  costUsd: number;
  stoppedByBudget: boolean;
};

const MAX_LISTED = 8;

/** Slack mrkdwn treats &, < and > as control characters. */
export function escapeSlack(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const money = (value: number) => `$${value.toFixed(2)}`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const clip = (value: string, max = 140) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

function link(origin: string | null, path: string, label: string): string {
  return origin ? `<${origin.replace(/\/$/, "")}${path}|${escapeSlack(label)}>` : escapeSlack(label);
}

function runLink(): string | null {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = process.env;
  return server && repo && run ? `<${server}/${repo}/actions/runs/${run}|GitHub run>` : null;
}

function footer(origin: string | null): unknown {
  const parts = [origin ? `<${origin}|Site>` : null, origin ? `<${origin.replace(/\/$/, "")}/leaderboard|Leaderboard>` : null, runLink()].filter(Boolean);
  return { type: "context", elements: [{ type: "mrkdwn", text: parts.length ? parts.join("  ·  ") : "PublicLedger" }] };
}

function publishedList(snapshot: SiteSnapshot, origin: string | null): string {
  const rows = snapshot.newlyPublished.slice(0, MAX_LISTED).map((item) =>
    `• *${escapeSlack(item.expertName)}*: ${link(origin, `/predictions/${item.id}`, clip(item.claim))}${item.resolutionDate ? ` _(due ${item.resolutionDate})_` : ""}`);
  const more = snapshot.newlyPublishedCount - rows.length;
  return rows.join("\n") + (more > 0 ? `\n…and ${more} more` : "");
}

export function dailyMessage(report: DailyReport, snapshot: SiteSnapshot, origin: string | null): SlackMessage {
  const warnings: string[] = [];
  if (report.error) warnings.push(`Run crashed: \`${clip(report.error, 300)}\``);
  if (report.cascade?.providerError) warnings.push(`Model provider refused: ${escapeSlack(clip(report.cascade.providerError, 200))}`);
  if (report.x?.stoppedByBudget || report.podcasts?.stoppedByBudget || (report.cascade?.deferredByBudget ?? 0) > 0) warnings.push("Hit the daily budget cap; the rest carries over to tomorrow.");
  if (report.x && report.x.errors > 0) warnings.push(`X search failed for ${plural(report.x.errors, "expert")}.`);
  if (report.feeds && report.feeds.errors > 0) warnings.push(`${plural(report.feeds.errors, "feed")} could not be read.`);
  if (report.x && report.x.experts === 0 && report.x.errors > 0) warnings.push("Every X lookup failed. Check the X API key and credits.");

  const live = snapshot.newlyPublishedCount;
  const icon = report.error || report.cascade?.providerError ? "❌" : warnings.length ? "⚠️" : live > 0 ? "🚀" : "🌙";
  const headline = live > 0 ? `${plural(live, "new prediction")} live` : "no new predictions today";

  const collected = [
    report.x ? `X: ${plural(report.x.posts, "matching post")} from ${plural(report.x.experts, "expert")}` : null,
    report.feeds ? `Feeds: ${plural(report.feeds.newSources, "new item")} from ${plural(report.feeds.feeds, "feed")}` : null,
    report.podcasts && report.podcasts.shows > 0 ? `Podcasts: ${plural(report.podcasts.episodes, "episode")}` : null,
  ].filter(Boolean).join("\n");
  const pipeline = report.cascade
    ? `${plural(report.cascade.sourcesExamined, "source")} screened → ${report.cascade.extracted} extracted → ${report.batchSubmitted || report.cascade.candidatesPending} sent to the verifier`
    : "Skipped";

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: `${icon} PublicLedger daily run: ${headline}`, emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Collected*\n${collected || "Nothing"}` },
        { type: "mrkdwn", text: `*Pipeline*\n${pipeline}` },
        { type: "mrkdwn", text: `*Verifier*\n${report.verified.published} published · ${report.verified.rejected} rejected` },
        { type: "mrkdwn", text: `*Cost*\nThis run ${money(report.runCostUsd)} · 24h ${money(snapshot.spendTodayUsd)} · 7d ${money(snapshot.spend7dUsd)}` },
        { type: "mrkdwn", text: `*On the site*\n${snapshot.totalPublished} predictions live` },
        { type: "mrkdwn", text: `*Runtime*\n${(report.durationS / 60).toFixed(1)} min` },
      ],
    },
  ];
  if (live > 0) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Published in the last 24 hours*\n${publishedList(snapshot, origin)}` } });
  if (report.batchSubmitted > 0) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `${plural(report.batchSubmitted, "candidate")} queued in the verification batch; results publish at the start of the next run.` }] });
  if (warnings.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Needs attention*\n${warnings.map((line) => `• ${line}`).join("\n")}` } });
  blocks.push(footer(origin));

  return { text: `PublicLedger daily run: ${headline}, ${money(report.runCostUsd)} spent`, blocks };
}

const outcomeIcon: Record<string, string> = { correct: "✅", incorrect: "❌", partial: "◐", ambiguous: "❔", void: "⦸" };

export function resolveMessage(report: ResolveReport, origin: string | null): SlackMessage {
  const scored = report.verdicts.length;
  const headline = scored > 0 ? `${plural(scored, "new verdict")}` : "no new verdicts";
  const icon = report.errors > 0 ? "⚠️" : scored > 0 ? "⚖️" : "🌙";
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: `${icon} PublicLedger scoring: ${headline}`, emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Past deadline*\n${plural(report.due, "prediction")} checked` },
        { type: "mrkdwn", text: `*Held back*\n${report.heldBack} below the confidence bar, retried in 30 days` },
        { type: "mrkdwn", text: `*Cost*\n${money(report.costUsd)}` },
        { type: "mrkdwn", text: `*Errors*\n${report.errors}${report.stoppedByBudget ? " · hit the budget cap" : ""}` },
      ],
    },
  ];
  if (scored > 0) {
    const rows = report.verdicts.slice(0, MAX_LISTED).map((item) =>
      `${outcomeIcon[item.outcome] ?? "•"} *${escapeSlack(item.outcome)}*: ${link(origin, `/predictions/${item.id}`, clip(item.claim))}`);
    if (scored > rows.length) rows.push(`…and ${scored - rows.length} more`);
    blocks.push({ type: "section", text: { type: "mrkdwn", text: rows.join("\n") } });
  }
  blocks.push(footer(origin));
  return { text: `PublicLedger scoring: ${headline}`, blocks };
}

export async function postSlack(message: SlackMessage): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message), signal: controller.signal });
    if (!response.ok) console.warn(`Slack webhook returned ${response.status}`);
  } catch (error) {
    console.warn("Slack notification failed:", error instanceof Error ? error.message : "unknown");
  } finally {
    clearTimeout(timer);
  }
}
