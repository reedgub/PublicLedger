// Stage 3: ONE frontier verification call per surviving candidate.
//
// Replaces the legacy verifier + auto-approver pair (two calls) with a single
// structured audit that returns both the faithfulness verdict and the
// editorial decision. Runs through the OpenAI Batch API by default (~50%
// cheaper; results within 24h) with a stable system prompt first, so the
// provider's automatic prompt caching applies to the shared prefix.

import { z } from "zod";
import { env } from "@/lib/env";
import type { ExtractedPrediction } from "@/lib/ai/schemas";

export const CASCADE_VERIFIER_VERSION = "2026-10-05.4-web-quotes";

export const cascadeVerdictSchema = z.object({
  verdict: z.enum([
    "faithful",
    "unsupported",
    "overstated",
    "understated",
    "ambiguous",
    "wrong_speaker",
    "not_prediction",
    "bad_deadline",
    "bad_resolution_criteria",
    "hindsight_leak",
  ]),
  decision: z.enum(["approve", "reject", "review"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type CascadeVerdict = z.infer<typeof cascadeVerdictSchema>;

// Hand-written so it satisfies OpenAI strict structured outputs exactly.
export const CASCADE_VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "decision", "confidence", "reason"],
  properties: {
    verdict: { type: "string", enum: cascadeVerdictSchema.shape.verdict.options },
    decision: { type: "string", enum: ["approve", "reject", "review"] },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
} as const;

export const CASCADE_VERIFIER_SYSTEM_PROMPT = `You are the single final auditor for PublicLedger, a public, source-backed database of falsifiable predictions. A cheaper model proposed the extraction below. Compare it ONLY with the supplied source text and decide whether it may be published.

Return verdict = the most serious problem found, or "faithful" if none:
- unsupported: the claim, a detail, a threshold or a date is not supported by the source.
- overstated / understated: certainty was strengthened ("might" -> "will") or weakened.
- wrong_speaker: the forecast belongs to someone other than the author. This INCLUDES the author reporting or summarising another party's projection or expectation: central-bank or government forecasts ("the Fed sees core PCE at 2.6%", "the ECB projects inflation at 3%"), market pricing or betting odds ("markets assign a 30% probability", "Polymarket has X at 50%"), economists' or analysts' consensus ("unemployment is expected to remain at 4.3%"), poll numbers, company guidance, and third-person reports ("Hayes said…"). Only approve when the author personally asserts the outcome in their own voice.
- not_prediction: commentary, mood, opinion, joke, rhetorical question, or a statement about the past/present. This INCLUDES retrospective claims of having been right ("as I predicted, it was bogus", "just like I told you"), descriptions of current positions or facts, and statements whose subject is unclear without outside context ("2026 has a clear shot at $100M+" — what does?).
- bad_deadline: the resolution_date is neither stated nor clearly inferable from the source (for record_type "prediction"), or the imputation is not defensible (for "take").
- bad_resolution_criteria: criteria are vague, unscorable, or do not name a specific public data source.
- hindsight_leak: the claim or criteria contain information that was not knowable from the source on its date (e.g. later events, outcome-specific framing).
- ambiguous: the source genuinely supports several materially different readings.

Then decide:
- approve: verdict is faithful, the claim is concrete and falsifiable, criteria name a specific public data source, no probability was invented, and a careful editor would publish it as-is.
- reject: any substantive problem above.
- review: faithful but you are not sure an editor would publish it, or the source is a machine transcript where the speaker is uncertain.

When source_type is "web", the source is a third-party article ABOUT the author, not by them. Approve only if source_quote is the author's own words, inside quotation marks attributed to the author in the article. A journalist's paraphrase, summary, headline or chapter title is wrong_speaker even when it describes the author's view.

There is no human editor after you: only a confident approve is published; review and reject are both left unpublished.

confidence is your confidence in the decision (0-1). reason is one sentence. Be strict: when in doubt, do not approve. A wrong attribution on a public track record is far worse than a missed prediction.`;

export type VerifierInput = {
  authorName: string;
  authorHandle: string | null;
  sourceType: string;
  sourceTimestamp: string;
  sourceText: string;
  candidate: ExtractedPrediction;
};

/** Keep verifier input bounded for long documents: the quote plus surrounding context. */
export function verifierContext(sourceText: string, quote: string, radius = 1500): string {
  if (sourceText.length <= radius * 2 + quote.length) return sourceText;
  const index = sourceText.indexOf(quote);
  if (index < 0) return sourceText.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(sourceText.length, index + quote.length + radius);
  return `${start > 0 ? "[…] " : ""}${sourceText.slice(start, end)}${end < sourceText.length ? " […]" : ""}`;
}

export function buildVerifierUserPrompt(input: VerifierInput): string {
  return JSON.stringify({
    author: input.authorHandle ? `${input.authorName} (@${input.authorHandle})` : input.authorName,
    source_type: input.sourceType,
    source_timestamp: input.sourceTimestamp,
    source_text: verifierContext(input.sourceText, input.candidate.source_quote),
    proposed: {
      record_type: input.candidate.record_type,
      source_quote: input.candidate.source_quote,
      normalized_claim: input.candidate.normalized_claim,
      resolution_date: input.candidate.resolution_date,
      resolution_criteria: input.candidate.resolution_criteria,
      explicit_probability: input.candidate.explicit_probability,
      confidence_language: input.candidate.confidence_language,
      imputation_note: input.candidate.imputation_note,
    },
  });
}

function supportsReasoningEffort(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model);
}

export function buildVerifierRequestBody(input: VerifierInput, model = env.CASCADE_VERIFIER_MODEL) {
  return {
    model,
    messages: [
      { role: "system" as const, content: CASCADE_VERIFIER_SYSTEM_PROMPT },
      { role: "user" as const, content: buildVerifierUserPrompt(input) },
    ],
    response_format: {
      type: "json_schema" as const,
      json_schema: { name: "publicledger_cascade_verdict", strict: true, schema: CASCADE_VERDICT_JSON_SCHEMA },
    },
    // Medium reasoning: attribution errors cost far more than the extra
    // output tokens (still well under a cent per candidate in batch mode).
    ...(supportsReasoningEffort(model) ? { reasoning_effort: "medium" as const } : {}),
  };
}

/** One JSONL line for the OpenAI Batch API. custom_id is the candidate id. */
export function buildBatchLine(candidateId: string, input: VerifierInput, model = env.CASCADE_VERIFIER_MODEL): string {
  return JSON.stringify({ custom_id: candidateId, method: "POST", url: "/v1/chat/completions", body: buildVerifierRequestBody(input, model) });
}

export type BatchOutputLine = {
  candidateId: string;
  verdict: CascadeVerdict | null;
  usage: { inputTokens: number; outputTokens: number };
  error: string | null;
};

export function parseBatchOutputLine(line: string): BatchOutputLine | null {
  if (!line.trim()) return null;
  const row = JSON.parse(line) as {
    custom_id: string;
    response?: { status_code?: number; body?: { choices?: Array<{ message?: { content?: string; refusal?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } } };
    error?: { message?: string } | null;
  };
  const usage = { inputTokens: row.response?.body?.usage?.prompt_tokens ?? 0, outputTokens: row.response?.body?.usage?.completion_tokens ?? 0 };
  if (row.error || (row.response?.status_code ?? 200) >= 400) {
    return { candidateId: row.custom_id, verdict: null, usage, error: row.error?.message ?? `status ${row.response?.status_code}` };
  }
  const content = row.response?.body?.choices?.[0]?.message?.content;
  if (!content) return { candidateId: row.custom_id, verdict: null, usage, error: row.response?.body?.choices?.[0]?.message?.refusal ?? "empty response" };
  const parsed = cascadeVerdictSchema.safeParse(JSON.parse(content));
  return parsed.success
    ? { candidateId: row.custom_id, verdict: parsed.data, usage, error: null }
    : { candidateId: row.custom_id, verdict: null, usage, error: "verdict failed schema validation" };
}

// ---- Decision policy (pure) -------------------------------------------------

export type CandidateFlags = {
  recordType: "prediction" | "take";
  /** Source kinds whose speaker attribution is uncertain (e.g. guest podcast transcripts). */
  forceReview: boolean;
  hasResolutionDate: boolean;
};

export type CandidateAction =
  | { action: "publish"; verificationMode: "auto" }
  | { action: "reject"; reason: string };

// There is no human review queue: the verifier either publishes a candidate or
// it is rejected (kept in prediction_candidates with the reason, never shown).
export function decideCandidate(verdict: CascadeVerdict, flags: CandidateFlags): CandidateAction {
  if (verdict.decision === "reject" || verdict.verdict !== "faithful") {
    return { action: "reject", reason: `${verdict.verdict}: ${verdict.reason}` };
  }
  if (flags.forceReview) return { action: "reject", reason: `speaker_uncertain: ${verdict.reason}` };
  if (!flags.hasResolutionDate) return { action: "reject", reason: "no resolution date" };
  // The launch spot-check found the 0.75–0.9 band too unreliable to publish.
  if (verdict.decision === "approve" && verdict.confidence >= 0.9) {
    return { action: "publish", verificationMode: "auto" };
  }
  return { action: "reject", reason: `not_confident (${verdict.decision}, ${verdict.confidence}): ${verdict.reason}` };
}
