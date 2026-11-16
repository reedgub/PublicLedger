// Calibrate a new verifier against past OpenAI verdicts before trusting it.
//
//   pnpm verify:compare [--limit 40]
//
// Re-verifies already-decided cascade candidates with the CONFIGURED verifier
// (e.g. VERIFIER_API_KEY + VERIFIER_MODEL for a free Gemini tier) and compares
// its publish/reject decision with the stored OpenAI verdict, using the same
// decideCandidate() rule as production. Read-only: nothing is written.
//
// The sample takes every past approval (rare and the riskiest to get wrong)
// plus a random sample of rejections. The number that matters most is "new
// publishes, OpenAI rejected": each one is a candidate the new verifier would
// have put on the site that the current one kept off.

import "dotenv/config";
import { appendFileSync } from "node:fs";
import { closeDatabase, getDatabase } from "@/lib/db/postgres";
import type { ExtractedPrediction } from "@/lib/ai/schemas";
import { decideCandidate, type CascadeVerdict } from "@/lib/pipeline/verify";
import { runPanel, verifierPanel } from "@/lib/pipeline/verifierTarget";

type Row = {
  id: string;
  raw_extraction: { candidate: ExtractedPrediction; force_review?: boolean; verifier: CascadeVerdict; verifier_model?: string };
  exact_text: string;
  published_at: string;
  source_type: string;
  display_name: string;
  x_handle: string | null;
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const decision = (verdict: CascadeVerdict, row: Row) => decideCandidate(verdict, {
  recordType: row.raw_extraction.candidate.record_type ?? "prediction",
  forceReview: row.raw_extraction.force_review === true,
  hasResolutionDate: Boolean(row.raw_extraction.candidate.resolution_date),
}).action;

async function main() {
  const panel = verifierPanel("compare");
  if (!panel) throw new Error("No verifier configured.");
  if (panel.members.length === 1 && panel.members[0].provider === "openai") throw new Error("Set VERIFIER_API_KEY and VERIFIER_MODEL to compare an alternative verifier against the stored OpenAI verdicts.");
  const limit = Number(arg("--limit") ?? panel.maxPerRun ?? 40);
  const sql = getDatabase();
  const base = sql`
    select pc.id, pc.raw_extraction, s.exact_text, s.published_at::text, s.source_type, e.display_name, e.x_handle
    from public.prediction_candidates pc
    join public.sources s on s.id = pc.source_id
    join public.experts e on e.id = pc.expert_id
    where pc.pipeline = 'cascade' and pc.raw_extraction ? 'verifier' and pc.raw_extraction ? 'candidate'
      and s.exact_text is not null and s.deleted_at is null`;
  const approvals = await sql<Row[]>`${base} and pc.raw_extraction->'verifier'->>'decision' = 'approve' order by pc.created_at desc limit ${limit}`;
  const rejections = await sql<Row[]>`${base} and pc.raw_extraction->'verifier'->>'decision' <> 'approve' order by random() limit ${Math.max(0, limit - approvals.length)}`;
  const rows = [...approvals, ...rejections];
  console.log(JSON.stringify({ stage: "compare_start", verifier: panel.label, members: panel.members.map((member) => `${member.model} @ ${member.provider}`), sample: rows.length, past_approvals: approvals.length }));

  const tally = { agree_publish: 0, agree_reject: 0, new_publishes_openai_rejected: 0, new_rejects_openai_published: 0, errors: 0 };
  const disagreements: Array<{ id: string; claim: string; openai: string; candidate_verifier: string }> = [];
  let compared = 0;
  let stoppedEarly: string | null = null;
  const startedAt = Date.now();
  for (const row of rows) {
    if (panel.runBudgetMs !== null && Date.now() - startedAt > panel.runBudgetMs) {
      stoppedEarly = `time budget reached after ${compared} comparison(s)`;
      break;
    }
    const callStarted = Date.now();
    try {
      const { verdict, members } = await runPanel(panel, {
        authorName: row.display_name, authorHandle: row.x_handle, sourceType: row.source_type,
        sourceTimestamp: new Date(row.published_at).toISOString(), sourceText: row.exact_text, candidate: row.raw_extraction.candidate,
      });
      compared += 1;
      const before = decision(row.raw_extraction.verifier, row);
      const after = decision(verdict, row);
      // Streamed as it goes, so a cut-off run still shows what was compared.
      console.log(JSON.stringify({ stage: "compared", n: compared, of: rows.length, ms: Date.now() - callStarted, openai: before, candidate_verifier: after,
        members: members.map((member) => `${member.model}:${member.verdict.decision}/${member.verdict.verdict}/${member.verdict.confidence}`) }));
      if (before === after) tally[after === "publish" ? "agree_publish" : "agree_reject"] += 1;
      else {
        tally[after === "publish" ? "new_publishes_openai_rejected" : "new_rejects_openai_published"] += 1;
        disagreements.push({
          id: row.id,
          claim: row.raw_extraction.candidate.normalized_claim.slice(0, 160),
          openai: `${before} (${row.raw_extraction.verifier.verdict}, ${row.raw_extraction.verifier.confidence}): ${row.raw_extraction.verifier.reason.slice(0, 160)}`,
          candidate_verifier: `${after} (${verdict.verdict}, ${verdict.confidence}): ${verdict.reason.slice(0, 160)}`,
        });
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      console.warn(`Compare failed for ${row.id} after ${Date.now() - callStarted} ms: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
      tally.errors += 1;
      if (status === 429 || status === 401 || status === 403) { stoppedEarly = `provider returned ${status}`; break; }
      // Repeated failures mean the provider or model id is wrong, not the candidates.
      if (tally.errors >= 3 && compared === 0) { stoppedEarly = "the first 3 calls all failed"; break; }
    }
  }
  const agreement = compared ? (tally.agree_publish + tally.agree_reject) / compared : 0;
  const summary = { stage: "compare_summary", verifier: panel.label, compared, agreement: Number(agreement.toFixed(3)), stopped_early: stoppedEarly, ...tally };
  console.log(JSON.stringify(summary));
  for (const item of disagreements) console.log(JSON.stringify({ stage: "disagreement", ...item }));

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      `## Verifier comparison: \`${panel.label}\` vs stored OpenAI verdicts`,
      "",
      `Compared **${compared}** candidates (${approvals.length} past approvals + random rejections). Agreement: **${(agreement * 100).toFixed(1)}%**.${stoppedEarly ? ` Stopped early: ${stoppedEarly}.` : ""}`,
      "",
      "| | Count |", "| --- | --- |",
      `| Both publish | ${tally.agree_publish} |`,
      `| Both reject | ${tally.agree_reject} |`,
      `| **New verifier publishes, OpenAI rejected** | **${tally.new_publishes_openai_rejected}** |`,
      `| New verifier rejects, OpenAI published | ${tally.new_rejects_openai_published} |`,
      `| Errors | ${tally.errors} |`,
      "",
      ...(disagreements.length ? ["### Disagreements", "", "| Claim | OpenAI | New verifier |", "| --- | --- | --- |",
        ...disagreements.map((item) => `| ${item.claim.replace(/\|/g, "\\|")} | ${item.openai.replace(/\|/g, "\\|")} | ${item.candidate_verifier.replace(/\|/g, "\\|")} |`)] : []),
    ];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(closeDatabase);
