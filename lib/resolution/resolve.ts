import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "@/lib/ai/client";
import { resolutionProposalSchema, resolutionVerifierSchema, type ResolutionProposal, type ResolutionVerifierResult } from "@/lib/ai/schemas";
import { env } from "@/lib/env";
import { parseSafePublicUrl } from "@/lib/security/urls";

export async function proposeResolution(input: {
  normalizedClaim: string;
  predictionDate: string;
  resolutionDate: string | null;
  resolutionCriteria: string;
}): Promise<ResolutionProposal> {
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
Only correct and incorrect can be scoring eligible. Include direct evidence URLs.`,
      },
      { role: "user", content: JSON.stringify(input) },
    ],
    tools: [{ type: "web_search", external_web_access: true, search_context_size: "high" }],
    text: { format: zodTextFormat(resolutionProposalSchema, "receipts_resolution_proposal") },
  });
  if (!response.output_parsed) throw new Error("OpenAI returned no parsed resolution proposal.");
  return response.output_parsed;
}

export async function verifyResolution(input: {
  normalizedClaim: string;
  resolutionCriteria: string;
  proposal: ResolutionProposal;
}): Promise<ResolutionVerifierResult> {
  const response = await getOpenAIClient().responses.parse({
    model: env.OPENAI_VERIFIER_MODEL,
    input: [
      { role: "system", content: "Independently audit the proposed prediction resolution against its frozen criteria and cited evidence. Re-check evidence with web search. Approve only when the claimed outcome follows directly and source quality thresholds are satisfied." },
      { role: "user", content: JSON.stringify(input) },
    ],
    tools: [{ type: "web_search", external_web_access: true, search_context_size: "high" }],
    text: { format: zodTextFormat(resolutionVerifierSchema, "receipts_resolution_verifier") },
  });
  if (!response.output_parsed) throw new Error("OpenAI returned no parsed resolution verification.");
  return response.output_parsed;
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

export function canAutoResolve(proposal: ResolutionProposal, verifier: ResolutionVerifierResult): boolean {
  const binary = proposal.proposed_outcome === "correct" || proposal.proposed_outcome === "incorrect";
  const scoringConsistent = proposal.scoring_eligible === binary;
  return proposal.confidence >= 0.97 && verifier.verdict === "approve" && verifier.confidence >= 0.97 && scoringConsistent && validateResolutionEvidence(proposal).meetsAutoEvidenceThreshold;
}
