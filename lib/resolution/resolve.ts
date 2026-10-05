import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "@/lib/ai/client";
import { resolutionProposalSchema, resolutionVerifierSchema, type ResolutionProposal, type ResolutionVerifierResult } from "@/lib/ai/schemas";
import { env } from "@/lib/env";
import { parseSafePublicUrl } from "@/lib/security/urls";
import type { CheckedEvidence } from "@/lib/resolution/evidence";

export async function proposeResolution(input: {
  normalizedClaim: string;
  predictionDate: string;
  resolutionDate: string | null;
  resolutionCriteria: string;
}): Promise<ResolutionProposal & { usage?: ResolutionUsage }> {
  const response = await getOpenAIClient().responses.parse({
    model: env.OPENAI_MODEL,
    input: [
      {
        role: "system",
        content: `Resolve a frozen public prediction using current evidence. Apply the supplied resolution criteria exactly.
Never resolve based on popularity or what the speaker probably meant.
Prefer official government data, regulators, filings, company announcements, election authorities, league results and recognized primary datasets.
If primary evidence is unavailable, require multiple independent high-quality secondary sources.
If evidence is insufficient, choose ambiguous. If the event definition changed materially, choose void.
Only correct and incorrect can be scoring eligible. Include direct evidence URLs.
For every evidence item, the excerpt MUST be copied verbatim from that page: it is checked automatically against the live page and evidence whose excerpt cannot be found is discarded.`,
      },
      { role: "user", content: JSON.stringify(input) },
    ],
    // "medium" context: "high" multiplies search-content tokens for little
    // gain now that evidence is verified deterministically afterwards.
    tools: [{ type: "web_search", external_web_access: true, search_context_size: "medium" }],
    text: { format: zodTextFormat(resolutionProposalSchema, "publicledger_resolution_proposal") },
  });
  if (!response.output_parsed) throw new Error("OpenAI returned no parsed resolution proposal.");
  const searchCalls = (response.output ?? []).filter((item) => item.type === "web_search_call").length;
  return { ...response.output_parsed, usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0, searchCalls } };
}

export type ResolutionUsage = { inputTokens: number; outputTokens: number; searchCalls: number };

/**
 * Audit a proposal against the evidence pages WE fetched (no second web
 * search). Only evidence whose excerpt was found on the live page is shown.
 */
export async function verifyResolution(input: {
  normalizedClaim: string;
  resolutionCriteria: string;
  resolutionDate: string | null;
  proposal: ResolutionProposal;
  checkedEvidence: Array<CheckedEvidence<ResolutionProposal["evidence"][number]>>;
}): Promise<ResolutionVerifierResult & { usage?: ResolutionUsage }> {
  const confirmed = input.checkedEvidence.filter((item) => item.confirmed);
  const response = await getOpenAIClient().responses.parse({
    model: env.OPENAI_VERIFIER_MODEL,
    input: [
      {
        role: "system",
        content: "Independently audit a proposed resolution of a frozen public prediction. You are given ONLY evidence text that was fetched from the cited pages and confirmed to contain the cited excerpt. Approve only when the claimed outcome follows directly from that confirmed evidence under the frozen criteria and deadline, and source quality is adequate (primary source, or two independent reputable secondary sources). If the confirmed evidence does not establish the outcome, return needs_review. Never rely on outside knowledge.",
      },
      {
        role: "user",
        content: JSON.stringify({
          normalized_claim: input.normalizedClaim,
          resolution_criteria: input.resolutionCriteria,
          resolution_date: input.resolutionDate,
          proposed_outcome: input.proposal.proposed_outcome,
          proposed_explanation: input.proposal.explanation,
          confirmed_evidence: confirmed.map((item) => ({ url: item.source_path, publisher: item.publisher, is_primary_source: item.is_primary_source, excerpt: item.excerpt, page_context: item.fetchedContext })),
          unconfirmed_evidence_count: input.checkedEvidence.length - confirmed.length,
        }),
      },
    ],
    text: { format: zodTextFormat(resolutionVerifierSchema, "publicledger_resolution_verifier") },
  });
  if (!response.output_parsed) throw new Error("OpenAI returned no parsed resolution verification.");
  return { ...response.output_parsed, usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0, searchCalls: 0 } };
}

export function validateResolutionEvidence(proposal: ResolutionProposal): {
  validUrls: ResolutionProposal["evidence"];
  meetsAutoEvidenceThreshold: boolean;
} {
  const validUrls = proposal.evidence.filter((evidence) => {
    try { parseSafePublicUrl(evidence.source_path); return true; } catch { return false; }
  });
  const hasPrimary = validUrls.some((evidence) => evidence.is_primary_source);
  const secondaryHosts = new Set(validUrls.filter((evidence) => !evidence.is_primary_source).map((evidence) => new URL(evidence.source_path).hostname.replace(/^www\./, "")));
  return { validUrls, meetsAutoEvidenceThreshold: hasPrimary || secondaryHosts.size >= 2 };
}

export function canAutoResolve(
  proposal: ResolutionProposal,
  verifier: ResolutionVerifierResult,
  confirmedEvidence: ResolutionProposal["evidence"] = proposal.evidence,
): boolean {
  const binary = proposal.proposed_outcome === "correct" || proposal.proposed_outcome === "incorrect";
  const scoringConsistent = proposal.scoring_eligible === binary;
  return proposal.confidence >= 0.97 && verifier.verdict === "approve" && verifier.confidence >= 0.97 && scoringConsistent
    && validateResolutionEvidence({ ...proposal, evidence: confirmedEvidence }).meetsAutoEvidenceThreshold;
}
