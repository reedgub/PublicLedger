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

export const EXTRACTION_SCHEMA_VERSION = "2026-08-27.1";
export const VERIFIER_SCHEMA_VERSION = "2026-08-27.1";
export const RESOLUTION_SCHEMA_VERSION = "2026-08-27.1";

export const AUTO_PUBLICATION_THRESHOLDS = {
  extractionConfidence: 0.92,
  sourceFidelity: 0.97,
  falsifiability: 0.85,
  verifierConfidence: 0.95,
} as const;

export const SITE_NAME = "Project Lighthouse";
export const SITE_TAGLINE = "Check the track record.";
export const SITE_DESCRIPTION =
  "A public record of what influential people predicted—and what actually happened.";
export const SITE_ORIGIN_DEFAULT = "https://projectlighthouse.dev";
