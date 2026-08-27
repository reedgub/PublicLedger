import { canonicalize } from "@/lib/predictions/fingerprint";

const STOP_WORDS = new Set(["the", "a", "an", "will", "would", "to", "of", "in", "on", "by", "before", "after", "and", "or"]);

function tokens(value: string): Set<string> {
  return new Set(
    (canonicalize(value).toLowerCase().match(/[a-z0-9$]+/g) ?? []).filter(
      (token) => token.length > 2 && !STOP_WORDS.has(token),
    ),
  );
}

export function tokenSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

export function isLikelyDuplicate(
  candidate: { expertId: string; claim: string; resolutionDate: string | null },
  existing: { expertId: string; claim: string; resolutionDate: string | null },
): boolean {
  if (candidate.expertId !== existing.expertId) return false;
  const dateDistance = candidate.resolutionDate && existing.resolutionDate
    ? Math.abs(new Date(candidate.resolutionDate).getTime() - new Date(existing.resolutionDate).getTime()) / 86_400_000
    : null;
  return tokenSimilarity(candidate.claim, existing.claim) >= 0.72 && (dateDistance === null || dateDistance <= 31);
}
