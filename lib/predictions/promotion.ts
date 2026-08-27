import { AUTO_PUBLICATION_THRESHOLDS } from "@/lib/constants";

export type PromotionCandidate = {
  sourceIsUsable: boolean;
  speakerIsAuthor: boolean;
  extractionConfidence: number;
  sourceFidelityScore: number;
  falsifiabilityScore: number;
  verifierVerdict: string | null;
  verifierConfidence: number | null;
  sourceQuoteLiteral: boolean;
  hasResolutionCriteria: boolean;
  hasResolutionDate: boolean;
};

export function canAutoPublish(candidate: PromotionCandidate): boolean {
  return (
    candidate.sourceIsUsable &&
    candidate.speakerIsAuthor &&
    candidate.extractionConfidence >= AUTO_PUBLICATION_THRESHOLDS.extractionConfidence &&
    candidate.sourceFidelityScore >= AUTO_PUBLICATION_THRESHOLDS.sourceFidelity &&
    candidate.falsifiabilityScore >= AUTO_PUBLICATION_THRESHOLDS.falsifiability &&
    candidate.verifierVerdict === "faithful" &&
    (candidate.verifierConfidence ?? 0) >= AUTO_PUBLICATION_THRESHOLDS.verifierConfidence &&
    candidate.sourceQuoteLiteral &&
    candidate.hasResolutionCriteria &&
    candidate.hasResolutionDate
  );
}
