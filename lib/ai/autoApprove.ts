// LLM-as-judge auto-approver.
//
// Second AI pass that runs on candidates the strict `canAutoPublish` gate
// would send to human review. The judge asks "would a careful editorial
// reviewer approve this for public display?" — same standard a human admin
// would apply, but scalable.
//
// This is intentionally more skeptical than the extractor. The extractor's
// job is to find candidates; the judge's job is to defend the site's
// integrity. When in doubt, reject.

import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/ai/client";

export const autoApprovalSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export type AutoApprovalResult = z.infer<typeof autoApprovalSchema>;

const JUDGE_SYSTEM_PROMPT = `You are the final quality reviewer for PublicLedger, a public prediction-tracking site.
Your job is to decide whether a candidate is ready for public display, or should be rejected.

Approve when ALL of these hold:
- The claim is genuinely present in the source text.
- For record_type="prediction": the resolution date is either stated by the author or clearly inferable from the source itself.
- For record_type="take": the imputation_note defensibly explains what was imputed (a plausible horizon and named data source, not "polls will show" without naming which pollster).
- The resolution_criteria name a SPECIFIC public data source (SEC EDGAR, S&P index, Yahoo Finance, a named poll, an official roster page, etc.). Generic phrases like "market reaction" or "polls will show" without a named source are NOT acceptable.
- The interpretation preserves the author's certainty (didn't strengthen "might" into "will" or weaken "will" into "might").
- No numeric probability was invented if the author didn't state one.
- The author is the actual speaker — not a third party being quoted or paraphrased.
- The normalized_claim is a concrete, falsifiable outcome (not a vague direction, mood, or aesthetic judgment).

Reject when:
- The claim is a mood-forecast or general opinion ("everyone will hate X", "an era of Y").
- The extraction adds facts, dates, or thresholds not defensibly present in the source.
- The resolution criteria can't be objectively scored against a public record.
- The author is quoting or attributing someone else.
- The verifier flagged a substantive issue (unsupported, overstated, understated, wrong_speaker) with confidence >= 0.85.
- The candidate is essentially a duplicate of an existing published prediction from the same expert.

Output: exactly one of decision="approve" or decision="reject", a confidence 0-1 for that decision, and a one-sentence reason. Be strict — when in doubt, reject.`;

export type JudgeInput = {
  sourceText: string;
  sourceTimestamp: string;
  authorName: string;
  authorHandle: string | null;
  normalizedClaim: string;
  sourceQuote: string;
  resolutionDate: string | null;
  resolutionCriteria: string;
  recordType: "prediction" | "take";
  imputationNote: string | null;
  verifierVerdict: string | null;
  verifierConfidence: number | null;
  verifierReason: string | null;
};

export async function judgeCandidate(input: JudgeInput): Promise<AutoApprovalResult> {
  const client = getOpenAIClient();
  const userContent = [
    `Author: ${input.authorName}${input.authorHandle ? ` (@${input.authorHandle})` : ""}`,
    `Source timestamp (UTC): ${input.sourceTimestamp}`,
    `record_type: ${input.recordType}`,
    "",
    `Source text:`,
    input.sourceText,
    "",
    `Candidate extraction:`,
    `- source_quote: ${input.sourceQuote}`,
    `- normalized_claim: ${input.normalizedClaim}`,
    `- resolution_date: ${input.resolutionDate ?? "(none)"}`,
    `- resolution_criteria: ${input.resolutionCriteria}`,
    input.recordType === "take" ? `- imputation_note: ${input.imputationNote ?? "(missing)"}` : "",
    "",
    `Independent verifier:`,
    `- verdict: ${input.verifierVerdict ?? "(no verdict)"}`,
    `- confidence: ${input.verifierConfidence ?? "(none)"}`,
    input.verifierReason ? `- reason: ${input.verifierReason}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.responses.parse({
    model: env.OPENAI_VERIFIER_MODEL,
    input: [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    text: { format: zodTextFormat(autoApprovalSchema, "publicledger_auto_approval") },
  });
  if (!response.output_parsed) throw new Error("Auto-approver returned no parsed output.");
  return response.output_parsed;
}

export type AutoApprovalDecision = {
  action: "approve" | "reject";
  reason: string;
  judgeConfidence: number;
  lowConfidence: boolean;
};

// Apply thresholds to the judge's raw verdict.
// - Approve requires confidence >= 0.5 (below that we still trust the reject path).
// - The 0.5–0.8 band is flagged as low-confidence so it can be audited later.
export function applyAutoApprovalDecision(judgment: AutoApprovalResult): AutoApprovalDecision {
  if (judgment.decision === "reject") {
    return { action: "reject", reason: judgment.reason, judgeConfidence: judgment.confidence, lowConfidence: false };
  }
  return {
    action: "approve",
    reason: judgment.reason,
    judgeConfidence: judgment.confidence,
    lowConfidence: judgment.confidence < 0.8,
  };
}
