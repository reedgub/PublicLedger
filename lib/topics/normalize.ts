import { CATEGORIES, type CategorySlug } from "@/lib/constants";

export type NormalizedTopic = {
  topicTitle: string;
  topicSlug: string;
  category: CategorySlug;
  description: string;
  isUsefulTopic: boolean;
  keywords: string[];
};

const STOP_WORDS = new Set(["will", "the", "a", "an", "be", "before", "after", "by", "in", "on", "of", "to", "at", "and", "or", "yes", "no"]);

export function slugifyTopic(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function inferCategory(text: string): CategorySlug {
  const value = text.toLowerCase();
  if (/bitcoin|ethereum|crypto|solana|token/.test(value)) return "crypto";
  if (/fed|fomc|inflation|recession|interest rate|gdp|unemployment/.test(value)) return "economy-rates";
  if (/stock|s&p|nasdaq|market cap|dow jones/.test(value)) return "markets-investing";
  if (/election|president|senate|house|governor|vote/.test(value)) return "politics-elections";
  if (/war|invasion|ceasefire|nato|sanction/.test(value)) return "geopolitics-conflict";
  if (/ai\b|artificial intelligence|agi|openai|model|robot/.test(value)) return "ai-tech";
  if (/climate|temperature|emission|energy|oil|solar|nuclear/.test(value)) return "energy-climate";
  if (/space|moon|mars|science|fda|drug|vaccine/.test(value)) return "science-space";
  if (/nba|nfl|mlb|nhl|championship|super bowl|world cup/.test(value)) return "sports";
  if (/company|startup|ipo|acquisition|merger/.test(value)) return "business-startups";
  return "other";
}

export function normalizeMarketTopic(question: string): NormalizedTopic {
  const clean = question.trim().replace(/[?]+$/, "");
  const bitcoin = clean.match(/will bitcoin (?:reach|hit|trade at) \$?([\d,.]+[km]?) (?:before|by) (.+)/i);
  let title = clean.replace(/^will\s+/i, "").replace(/\bby december 31,?\s*/i, "Before ");
  if (bitcoin) title = `Bitcoin $${bitcoin[1].toUpperCase()} Before ${bitcoin[2].replace(/^the end of /i, "")}`;
  const election = clean.match(/will (.+) win the (20\d{2}) (?:u\.?s\.? )?presidential election/i);
  if (election) title = `${election[2]} U.S. Presidential Election`;
  title = title.replace(/\b(yes|no)\b$/i, "").trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);
  const category = inferCategory(clean);
  const keywords = Array.from(new Set(clean.toLowerCase().match(/[a-z0-9$]{3,}/g) ?? []))
    .filter((token) => !STOP_WORDS.has(token))
    .slice(0, 10);
  const isUsefulTopic = clean.length >= 12 && title.length <= 120 && !/^(other|market)\b/i.test(title);
  const categoryName = CATEGORIES.find((item) => item.slug === category)?.name ?? "Other";
  return {
    topicTitle: title,
    topicSlug: slugifyTopic(title),
    category,
    description: `${categoryName} question tracked from public market activity.`,
    isUsefulTopic,
    keywords,
  };
}
