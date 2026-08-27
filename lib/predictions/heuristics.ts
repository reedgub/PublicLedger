const POSITIVE_PATTERNS: Array<[RegExp, number]> = [
  [/\b(will|won't|will not|going to)\b/i, 3],
  [/\b(expect|expecting|predict|prediction|forecast)\b/i, 3],
  [/\b(chance|probability|odds|likely|unlikely)\b/i, 2],
  [/\bby\s+(20\d{2}|the end of|next (?:week|month|year))\b/i, 3],
  [/\b(before|within|next year|this year)\b/i, 2],
  [/\b(reach|hit|fall|rise|win|lose|launch|ship|cut|raise|approve|pass|invade)\b/i, 1],
  [/\b(recession|AGI|inflation|rates?)\b/i, 1],
  [/\b\d+(?:\.\d+)?%\b/, 2],
];

const NEGATIVE_PATTERNS: Array<[RegExp, number]> = [
  [/^\s*https?:\/\/\S+\s*$/i, -6],
  [/\b(subscribe|sign up|buy now|use code|limited time)\b/i, -3],
  [/\b(yesterday|last week|last year|has already|previously)\b/i, -1],
  [/^(rt|repost)\b/i, -4],
];

export type HeuristicResult = {
  score: number;
  shouldExtract: boolean;
  signals: string[];
};

export function scorePredictionHeuristic(text: string): HeuristicResult {
  const normalized = text.trim();
  if (!normalized) return { score: -10, shouldExtract: false, signals: ["empty"] };
  let score = 0;
  const signals: string[] = [];
  for (const [pattern, weight] of POSITIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      score += weight;
      signals.push(pattern.source);
    }
  }
  for (const [pattern, weight] of NEGATIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      score += weight;
      signals.push(`negative:${pattern.source}`);
    }
  }
  if (normalized.endsWith("?") && !/[.!]\s+[^?]+$/.test(normalized)) {
    score -= 3;
    signals.push("question_only");
  }
  if (normalized.length < 24) {
    score -= 1;
    signals.push("very_short");
  }
  return { score, shouldExtract: score >= 2, signals };
}
