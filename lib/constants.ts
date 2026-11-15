export const CATEGORY_SLUGS = [
  "ai-tech",
  "economy-rates",
  "markets-investing",
  "crypto",
  "politics-elections",
  "geopolitics-conflict",
  "business-startups",
  "energy-climate",
  "science-space",
  "sports",
  "media-culture",
  "other",
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export const CATEGORIES: ReadonlyArray<{
  slug: CategorySlug;
  name: string;
  shortName: string;
}> = [
  { slug: "ai-tech", name: "AI & Technology", shortName: "AI / Tech" },
  { slug: "economy-rates", name: "Economy & Rates", shortName: "Economy" },
  { slug: "markets-investing", name: "Markets & Investing", shortName: "Markets" },
  { slug: "crypto", name: "Crypto", shortName: "Crypto" },
  { slug: "politics-elections", name: "Politics & Elections", shortName: "Elections" },
  { slug: "geopolitics-conflict", name: "Geopolitics & Conflict", shortName: "Geopolitics" },
  { slug: "business-startups", name: "Business & Startups", shortName: "Business" },
  { slug: "energy-climate", name: "Energy & Climate", shortName: "Climate" },
  { slug: "science-space", name: "Science & Space", shortName: "Science" },
  { slug: "sports", name: "Sports", shortName: "Sports" },
  { slug: "media-culture", name: "Media & Culture", shortName: "Culture" },
  { slug: "other", name: "Other", shortName: "Other" },
];

export const EXTRACTION_SCHEMA_VERSION = "2026-09-08.4-named-source-and-dedupe";
export const RESOLUTION_SCHEMA_VERSION = "2026-08-27.1";

export const SITE_NAME = "PublicLedger";
export const SITE_TAGLINE = "The public record of what pundits actually said.";
export const SITE_DESCRIPTION =
  "The public, source-backed record of what influential people predicted — with the exact quote, the deadline, and the outcome, captured before anyone can quietly delete it.";
export const SITE_ORIGIN_DEFAULT = "https://publicledger.dev";
