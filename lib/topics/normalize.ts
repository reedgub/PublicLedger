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
  // Order matters: check specific sports/geopolitics/crypto patterns before
  // more generic finance/tech ones so, e.g., a Bitcoin market doesn't get
  // routed to markets-investing.
  if (/bitcoin|ethereum|\bbtc\b|\beth\b|\bsol\b|solana|\bxrp\b|dogecoin|\bltc\b|litecoin|crypto|token|blockchain|stablecoin|memecoin|nft/.test(value)) return "crypto";

  // Sports coverage: leagues, common match-format tokens, individual sport
  // names, and the "vs." / "O/U" / "Exact Score" phrasings used by
  // Polymarket sport markets.
  if (
    /\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|\bmls\b|\bepl\b|\bufc\b|\bwnba\b|\bpga\b|\bwta\b|\batp\b|\bf1\b|nascar|formula\s?1|premier league|la\s?liga|bundesliga|serie\s?a|ligue\s?1|champions league|europa league|copa|liga mx|mlb|nba|championship|super bowl|world cup|world series|stanley cup|nba finals|playoffs|boxing|heavyweight|welterweight|lightweight|middleweight|title fight|\bufc \d|match|final|semifinal|quarterfinal|game \d|exact score|both teams to score|total corners|o\/u [\d.]+|innings|inning|goals?|scorer|goalscorer|striker|forward|penalty|penalties|winger|\bfc\b|\bafc\b|\bsc\b|\bcf\b|\bfk\b|\bkc\b|\brc\b|barcelona|real madrid|arsenal|liverpool|chelsea|manchester|tottenham|juventus|inter milan|ac milan|napoli|bayer|bayern|dortmund|psg|leverkusen|athletic|celta|deportivo|sporting|besta deild|vs\.|ipl\b|cricket|rugby|nba finals|home run|touchdown|goal line|puck|corner kick|kickoff|halftime|full time|runner-up|champion of/.test(value)
  ) return "sports";

  // Economy — central banks, macro indicators, jobs data.
  if (/\bfed\b|federal reserve|\bfomc\b|inflation|recession|interest rate|gdp\b|unemployment|jobless|payroll|\bcpi\b|\bppi\b|\bpce\b|rate hike|rate cut|rate decision|yield curve|treasury|jobs report|non[- ]?farm|wage growth|labor market|deficit|debt ceiling/.test(value)) return "economy-rates";

  // Markets/investing — indices, individual equity-shaped questions,
  // valuations, IPOs adjacent to markets rather than startups.
  if (/stock\b|\bs&p\b|s and p|nasdaq|dow jones|russell|ftse|nikkei|hang seng|dax\b|cac\s?40|market cap|share price|valuation|reach a valuation|be valued at|price target|earnings|dividend|hedge fund|private equity|leveraged/.test(value)) return "markets-investing";

  // Elections & domestic politics.
  if (/election|president|senate|congress|\bhouse\b|governor|primary|caucus|nominee|nomination|impeachment|approval rating|debate|ballot|vote|voter|electoral college|midterms|referendum|prime minister|chancellor|coalition|parliament/.test(value)) return "politics-elections";

  // Geopolitics & conflict.
  if (/war\b|invasion|ceasefire|\bnato\b|sanction|missile|drone strike|hostage|hamas|hezbollah|israel|gaza|palestin|ukraine|russia|iran|china|taiwan|north korea|kremlin|putin|xi jinping|kim jong|zelensk|netanyahu|un security|geneva|treaty|border crossing|refugee|coup|junta|regime|strait of|international court|\bicc\b|\bicj\b|genocide|apartheid|annex|territory|deployment/.test(value)) return "geopolitics-conflict";

  // AI & broader tech products/companies.
  if (/\bai\b|artificial intelligence|\bagi\b|\basi\b|openai|anthropic|deepmind|xai\b|gpt[- ]?\d|claude|gemini|llama|mistral|grok|language model|\bllm\b|copilot|humanoid|robot(?:s|ics)?|self[- ]?driving|autonomous vehicle|\bev\b\s|tesla|apple\b|google|microsoft|meta\b|amazon|nvidia|semiconductor|chip\b|silicon|foundry|\btsmc\b|iphone|android|vision pro|app store/.test(value)) return "ai-tech";

  // Energy & climate.
  if (/climate|temperature record|emission|greenhouse|\bco2\b|renewable|energy\b|oil price|crude|opec|natural gas|\blng\b|solar\b|wind (?:power|farm|energy)|nuclear|hydrogen|battery storage|hurricane|tornado|typhoon|wildfire|drought|heat wave|sea level|arctic|ipcc/.test(value)) return "energy-climate";

  // Science, space, health.
  if (/space|spacex|starship|falcon|\bnasa\b|moon\b|lunar|mars\b|martian|asteroid|comet|iss\b|satellite|rocket launch|science|physics|biology|chemistry|\bfda\b|drug approval|vaccine|clinical trial|cancer|cure|gene therapy|crispr|nobel prize|breakthrough/.test(value)) return "science-space";

  // Business & startups — company events not tied to a specific ticker.
  if (/company|startup|founder|\bceo\b|acquire|acquisition|merger\b|\bipo\b|series [a-e]\b|funding round|raise\s+\$|valued at \$|shutdown|layoff|bankruptcy|earnings call|activist investor|proxy fight|hostile takeover|strike\b|union|labor deal/.test(value)) return "business-startups";

  // Media & culture — awards, box office, celebrity news, releases.
  if (/oscar|grammy|emmy|tony award|golden globe|palme d'or|cannes|box office|opening weekend|billion dollars? at the box|album|billboard chart|number one hit|streaming|netflix\b|spotify|youtube|tiktok|instagram|meta platform|\bx\b account|elon\b|kanye|swift\b|beyonc|drake\b|kardashian|film festival|movie|episode|season \d|renewed for/.test(value)) return "media-culture";

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
