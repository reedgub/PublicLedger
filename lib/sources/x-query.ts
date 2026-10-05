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

// ---------------------------------------------------------------------------
// Cascade query: ONE server-side-filtered query per expert window.
//
// X bills per returned post. Running the forecast/probability/timing families
// as three separate queries returns (and bills) a post once per family it
// matches, so everything goes into a single OR query. Timing terms are
// generated from the window being scanned: a 2022 window needs "by 2023",
// not the hard-coded "by 2026".."by 2030" of the legacy families.
// ---------------------------------------------------------------------------

export type XQueryTier = "precision" | "recall";

/** Bump when the term list changes so coverage rows record what was scanned. */
export const CASCADE_X_QUERY_VERSION = "2026-10-05.1";

// Strong forecast vocabulary. Deliberately excludes "will", which matches a
// large share of all posts and would multiply billed reads.
const PRECISION_TERMS = [
  "predict", "predicting", "prediction", "predictions", "forecast", "forecasting",
  "expect", "expecting", "bet", "odds", "chance", "probability", "likely", "unlikely",
  '"mark my words"', '"next year"', '"end of the year"', '"within a year"',
];

// Broader vocabulary for experts whose counts show the precision tier misses
// too much. Costs more reads; use per expert, not by default.
const RECALL_TERMS = ["will", "won't", '"going to"', "gonna"];

export const X_QUERY_MAX_LENGTH = 512;

export function windowYearTerms(start: Date, end: Date, horizonYears = 4): string[] {
  const first = start.getUTCFullYear();
  const last = end.getUTCFullYear() + horizonYears;
  const terms: string[] = [];
  for (let year = first; year <= last; year += 1) terms.push(`"by ${year}"`);
  return terms;
}

export function buildCascadeXQuery(
  handle: string,
  options: { start: Date; end: Date; tier?: XQueryTier; includeReplies?: boolean; maxLength?: number },
): string {
  const safeHandle = handle.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(safeHandle)) throw new Error("Invalid X handle");
  const maxLength = options.maxLength ?? X_QUERY_MAX_LENGTH;
  const suffix = ` lang:en -is:retweet${options.includeReplies ? "" : " -is:reply"}`;
  const prefix = `from:${safeHandle} (`;
  const base = [...PRECISION_TERMS, ...(options.tier === "recall" ? RECALL_TERMS : [])];
  const years = windowYearTerms(options.start, options.end);
  // Base vocabulary always fits; year terms are added nearest-first until the
  // length budget is spent.
  const terms = [...base];
  for (const term of years) {
    const candidate = `${prefix}${[...terms, term].join(" OR ")})${suffix}`;
    if (candidate.length > maxLength) break;
    terms.push(term);
  }
  const query = `${prefix}${terms.join(" OR ")})${suffix}`;
  if (query.length > maxLength) throw new Error("X query exceeds maximum length");
  return query;
}
