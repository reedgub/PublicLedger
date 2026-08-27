export type XQueryFamily = "forecast" | "probability" | "timing" | "topic";

const FAMILY_TERMS: Record<Exclude<XQueryFamily, "topic">, string[]> = {
  forecast: ["will", "expect", "predict", "prediction", "forecast"],
  probability: ["probability", "chance", "odds", "likely", "unlikely", '"%"'],
  timing: ['"by 2026"', '"by 2027"', '"by 2028"', '"by 2030"', '"next year"', "within", "before"],
};

export function buildXQuery(
  handle: string,
  family: XQueryFamily,
  topicKeywords: string[] = [],
): string {
  const safeHandle = handle.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(safeHandle)) throw new Error("Invalid X handle");
  const rawTerms = family === "topic" ? topicKeywords : FAMILY_TERMS[family];
  const terms = rawTerms
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((term) => (term.includes(" ") && !term.startsWith('"') ? `"${term.replaceAll('"', "")}"` : term));
  if (terms.length === 0) throw new Error("At least one query term is required");
  const query = `from:${safeHandle} (${terms.join(" OR ")}) lang:en -is:retweet`;
  if (query.length > 512) throw new Error("X query exceeds 512 characters");
  return query;
}

export function encodeXQuery(query: string): string {
  return encodeURIComponent(query);
}
