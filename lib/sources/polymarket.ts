import { parseBinaryOutcomePrices } from "@/lib/sources/polymarket-parser";
import { fetchJson } from "@/lib/http/retry";
import type { Market } from "@/types/domain";

const GAMMA_ORIGIN = "https://gamma-api.polymarket.com";

type GammaMarket = {
  id?: string | number;
  conditionId?: string;
  slug?: string;
  question?: string;
  description?: string;
  resolutionSource?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  volume?: string | number;
  liquidity?: string | number;
  outcomes?: unknown;
  outcomePrices?: unknown;
  events?: Array<{ id?: string | number; slug?: string; featured?: boolean }>;
  featured?: boolean;
  [key: string]: unknown;
};

export type PolymarketSyncOptions = {
  activeLimit?: number;
  closedLimit?: number;
};

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePolymarketMarket(raw: GammaMarket): Market | null {
  const providerMarketId = String(raw.conditionId ?? raw.id ?? "").trim();
  const question = raw.question?.trim();
  if (!providerMarketId || !question) return null;
  const prices = parseBinaryOutcomePrices(raw.outcomes, raw.outcomePrices);
  return {
    id: `polymarket-${providerMarketId}`,
    provider: "polymarket",
    providerMarketId,
    providerSlug: raw.slug ?? null,
    topicId: null,
    question,
    description: raw.description?.trim() || null,
    endAt: raw.endDate ?? null,
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    volume: finiteNumber(raw.volume),
    liquidity: finiteNumber(raw.liquidity),
    ...prices,
    fetchedAt: new Date().toISOString(),
    raw: raw as Record<string, unknown>,
  };
}

async function fetchMarketSet(params: URLSearchParams): Promise<GammaMarket[]> {
  const url = new URL("/markets", GAMMA_ORIGIN);
  url.search = params.toString();
  const response = await fetchJson<GammaMarket[] | { data?: GammaMarket[] }>(url, {
    headers: { Accept: "application/json", "User-Agent": "Receipts/0.1 (+https://receipts.app)" },
    next: { revalidate: 3600 },
  });
  return Array.isArray(response) ? response : response.data ?? [];
}

export async function fetchPolymarketMarkets(options: PolymarketSyncOptions = {}): Promise<{
  active: Market[];
  closed: Market[];
}> {
  const activeLimit = Math.min(250, Math.max(1, options.activeLimit ?? 250));
  const closedLimit = Math.min(250, Math.max(0, options.closedLimit ?? 250));
  const [activeRaw, closedRaw] = await Promise.all([
    fetchMarketSet(new URLSearchParams({ active: "true", closed: "false", order: "volume", ascending: "false", limit: String(activeLimit), offset: "0" })),
    closedLimit
      ? fetchMarketSet(new URLSearchParams({ closed: "true", order: "volume", ascending: "false", limit: String(closedLimit), offset: "0" }))
      : Promise.resolve([]),
  ]);
  return {
    active: activeRaw.map(normalizePolymarketMarket).filter((market): market is Market => market !== null),
    closed: closedRaw.map(normalizePolymarketMarket).filter((market): market is Market => market !== null),
  };
}

export function polymarketInterestScore(market: Market, featured = false, now = new Date()): number {
  const volume = Math.max(0, market.volume ?? 0);
  const liquidity = Math.max(0, market.liquidity ?? 0);
  const daysUntilEnd = market.endAt ? (new Date(market.endAt).getTime() - now.getTime()) / 86_400_000 : null;
  const recencyBonus = daysUntilEnd !== null && daysUntilEnd >= 0 ? 1 / (1 + daysUntilEnd / 30) : 0;
  return Math.log1p(volume) + 0.5 * Math.log1p(liquidity) + recencyBonus + (featured ? 0.5 : 0);
}

export function selectDiverseMarkets(markets: Market[], limit = 6): Market[] {
  const sorted = [...markets].sort((a, b) => polymarketInterestScore(b) - polymarketInterestScore(a));
  const selected: Market[] = [];
  const tokenSets: string[][] = [];
  for (const market of sorted) {
    const tokens = market.question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
    const tooSimilar = tokenSets.some((existing) => {
      const overlap = tokens.filter((token) => existing.includes(token)).length;
      return overlap >= Math.min(3, Math.ceil(Math.min(tokens.length, existing.length) * 0.6));
    });
    if (!tooSimilar || selected.length < 2) {
      selected.push(market);
      tokenSets.push(tokens);
    }
    if (selected.length >= limit) break;
  }
  return selected;
}

export const polymarketSourceAdapter = {
  sourceType: "polymarket" as const,
  fetch: fetchPolymarketMarkets,
};
