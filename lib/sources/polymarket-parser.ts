function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value.split(",").map((item) => item.trim());
    }
  }
  return [];
}

export function parseProbability(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return null;
  const normalized = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  return normalized >= 0 && normalized <= 1 ? normalized : null;
}

export function parseBinaryOutcomePrices(
  outcomesValue: unknown,
  pricesValue: unknown,
): { yesProbability: number | null; noProbability: number | null } {
  const outcomes = parseArray(outcomesValue).map((value) => String(value).trim().toLowerCase());
  const prices = parseArray(pricesValue).map(parseProbability);
  const yesIndex = outcomes.findIndex((outcome) => outcome === "yes");
  const noIndex = outcomes.findIndex((outcome) => outcome === "no");
  if (yesIndex < 0 || noIndex < 0) return { yesProbability: null, noProbability: null };
  return {
    yesProbability: prices[yesIndex] ?? null,
    noProbability: prices[noIndex] ?? null,
  };
}
