import { createHash } from "node:crypto";

export type FingerprintInput = {
  expertId: string;
  sourceId: string;
  normalizedClaim: string;
  predictionDate: string | Date;
  resolutionDate: string | Date | null;
  resolutionCriteria: string;
  explicitProbability: number | null;
};

export function canonicalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function predictionFingerprint(input: FingerprintInput): string {
  const canonical = [
    input.expertId,
    input.sourceId,
    canonicalize(input.normalizedClaim),
    new Date(input.predictionDate).toISOString(),
    input.resolutionDate ? new Date(input.resolutionDate).toISOString() : "",
    canonicalize(input.resolutionCriteria),
    input.explicitProbability === null ? "" : input.explicitProbability.toString(),
  ].join("\u001f");
  return createHash("sha256").update(canonical).digest("hex");
}
