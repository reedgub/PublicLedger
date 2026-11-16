import "server-only";
import { cache } from "react";
import { CATEGORY_SLUGS, type CategorySlug } from "@/lib/constants";
import { integrations } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { rosterAsExperts } from "@/seed/experts";
import { fetchPolymarketMarkets, selectDiverseMarkets } from "@/lib/sources/polymarket";
import { normalizeMarketTopic } from "@/lib/topics/normalize";
import type { Expert, ExpertScorecard, Market, Prediction, Resolution, SearchResult, Source, Topic } from "@/types/domain";
import { SYNTHETIC_PREDICTION_ID, syntheticPrediction } from "@/lib/testing/fixtures";
import type { LedgerOutcome, LedgerRow } from "@/lib/leaderboard/ledger";

type Row = Record<string, unknown>;

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
const numberOrNull = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
};
const bool = (value: unknown): boolean => value === true;
const object = (value: unknown): Row => (value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {});
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const firstRelation = (value: unknown): Row => object(Array.isArray(value) ? value[0] : value);
const category = (value: unknown): CategorySlug =>
  typeof value === "string" && CATEGORY_SLUGS.includes(value as CategorySlug) ? (value as CategorySlug) : "other";

function mapExpert(row: Row): Expert {
  const storedAvatar = stringOrNull(row.avatar_url);
  const xHandle = stringOrNull(row.x_handle);
  // Only serve an avatar the admin/X-verify pipeline actually stored. The old
  // fallback (unavatar.io) leaked the roster to a hobby third party and would
  // 404 or hang whenever that service was down. Missing avatar → initials
  // placeholder in the client component; safer and offline-friendly.
  return {
    id: String(row.id ?? ""),
    slug: String(row.slug ?? ""),
    displayName: String(row.display_name ?? "Unknown"),
    xHandle,
    xUserId: stringOrNull(row.x_user_id),
    avatarUrl: storedAvatar,
    headline: stringOrNull(row.headline),
    primaryCategorySlug: category(row.primary_category_slug),
    categorySlugs: array(row.expert_categories).map((item) => category(object(item).category_slug)),
    sourceStatus:
      row.source_status === "verified" || row.source_status === "unresolved" ? row.source_status : "unverified",
  };
}

function mapSource(row: Row): Source {
  return {
    id: String(row.id ?? ""),
    sourceType: String(row.source_type ?? "manual"),
    externalId: stringOrNull(row.external_id),
    canonicalPath: stringOrNull(row.canonical_path),
    authorHandle: stringOrNull(row.author_handle),
    publishedAt: String(row.published_at ?? ""),
    exactText: stringOrNull(row.exact_text),
    deletedAt: stringOrNull(row.deleted_at),
  };
}

function mapMarket(row: Row): Market {
  return {
    id: String(row.id ?? ""),
    provider: String(row.provider ?? "polymarket"),
    providerMarketId: String(row.provider_market_id ?? ""),
    providerSlug: stringOrNull(row.provider_slug),
    topicId: stringOrNull(row.topic_id),
    question: String(row.question ?? ""),
    description: stringOrNull(row.description),
    endAt: stringOrNull(row.end_at),
    active: bool(row.active),
    closed: bool(row.closed),
    volume: numberOrNull(row.volume),
    liquidity: numberOrNull(row.liquidity),
    yesProbability: numberOrNull(row.yes_probability),
    noProbability: numberOrNull(row.no_probability),
    fetchedAt: String(row.fetched_at ?? ""),
  };
}

function mapTopic(row: Row): Topic {
  return {
    id: String(row.id ?? ""),
    slug: String(row.slug ?? ""),
    title: String(row.title ?? ""),
    categorySlug: category(row.category_slug),
    description: stringOrNull(row.description),
    status: row.status === "closed" || row.status === "archived" ? row.status : "active",
    markets: array(row.markets).map((item) => mapMarket(object(item))),
  };
}

function mapResolution(row: Row): Resolution | null {
  if (!row.id) return null;
  const outcome = row.outcome;
  if (!(["correct", "incorrect", "partial", "ambiguous", "void"] as unknown[]).includes(outcome)) return null;
  return {
    outcome: outcome as Resolution["outcome"],
    explanation: String(row.explanation ?? ""),
    resolutionConfidence: numberOrNull(row.resolution_confidence),
    resolvedAt: String(row.resolved_at ?? ""),
    approvedAt: stringOrNull(row.approved_at),
    evidence: array(row.resolution_evidence).map((item) => {
      const evidence = object(item);
      return {
        id: String(evidence.id ?? ""),
        sourceType: String(evidence.source_type ?? "web"),
        sourceTitle: stringOrNull(evidence.source_title),
        sourcePath: String(evidence.source_path ?? ""),
        publisher: stringOrNull(evidence.publisher),
        excerpt: stringOrNull(evidence.excerpt),
        isPrimarySource: bool(evidence.is_primary_source),
      };
    }),
  };
}

function mapPrediction(row: Row): Prediction {
  const expert = mapExpert(firstRelation(row.experts));
  const source = mapSource(firstRelation(row.sources));
  const resolution = mapResolution(firstRelation(row.resolutions));
  const topicRelations = array(row.prediction_topics).map((item) => mapTopic(firstRelation(object(item).topics)));
  const marketRelations = array(row.prediction_markets).map((item) => mapMarket(firstRelation(object(item).markets)));
  return {
    id: String(row.id ?? ""),
    expert,
    source,
    categorySlug: category(row.category_slug),
    normalizedClaim: String(row.normalized_claim ?? ""),
    sourceQuote: String(row.source_quote ?? ""),
    predictionDate: String(row.prediction_date ?? ""),
    resolutionDate: stringOrNull(row.resolution_date),
    resolutionCriteria: String(row.resolution_criteria ?? ""),
    explicitProbability: numberOrNull(row.explicit_probability),
    confidenceLanguage: stringOrNull(row.confidence_language),
    status: (row.status ?? "open") as Prediction["status"],
    publishedAt: stringOrNull(row.published_at),
    resolution,
    topics: topicRelations.filter((topic) => topic.id),
    markets: marketRelations.filter((market) => market.id),
    recordType: row.record_type === "take" ? "take" : "prediction",
    imputationNote: stringOrNull(row.imputation_note),
    captureMode: row.capture_mode === "backfill" ? "backfill" : "live",
  };
}

function emptyScorecard(expert: Expert): ExpertScorecard {
  return {
    expert,
    totalPredictions: 0,
    openPredictions: 0,
    resolvedPredictions: 0,
    correctPredictions: 0,
    incorrectPredictions: 0,
    partialPredictions: 0,
    ambiguousPredictions: 0,
    voidPredictions: 0,
    accuracy: null,
    wilsonRankScore: null,
    probabilisticPredictions: 0,
    brierScore: null,
    leaderboardEligible: false,
    provisional: true,
    totalTakes: 0,
  };
}

function mapScorecard(row: Row): ExpertScorecard {
  const expert = mapExpert(row);
  return {
    expert,
    totalPredictions: numberOrNull(row.total_predictions) ?? 0,
    openPredictions: numberOrNull(row.open_predictions) ?? 0,
    resolvedPredictions: numberOrNull(row.resolved_predictions) ?? 0,
    correctPredictions: numberOrNull(row.correct_predictions) ?? 0,
    incorrectPredictions: numberOrNull(row.incorrect_predictions) ?? 0,
    partialPredictions: numberOrNull(row.partial_predictions) ?? 0,
    ambiguousPredictions: numberOrNull(row.ambiguous_predictions) ?? 0,
    voidPredictions: numberOrNull(row.void_predictions) ?? 0,
    accuracy: numberOrNull(row.accuracy),
    wilsonRankScore: numberOrNull(row.wilson_rank_score),
    probabilisticPredictions: numberOrNull(row.probabilistic_predictions) ?? 0,
    brierScore: numberOrNull(row.brier_score),
    leaderboardEligible: bool(row.leaderboard_eligible),
    provisional: row.provisional !== false,
    totalTakes: numberOrNull(row.total_takes) ?? 0,
  };
}

async function fallbackMarkets(limit = 8): Promise<Market[]> {
  try {
    const result = await fetchPolymarketMarkets({ activeLimit: 40, closedLimit: 0 });
    return selectDiverseMarkets(result.active, limit);
  } catch (error) {
    console.error("Polymarket fallback unavailable", error instanceof Error ? error.message : "unknown error");
    return [];
  }
}

export const getExperts = cache(async (): Promise<Expert[]> => {
  if (!integrations.supabase) return rosterAsExperts();
  const client = await createServerSupabaseClient();
  const { data, error } = await client!
    .from("experts")
    .select("*, expert_categories(category_slug)")
    .eq("is_active", true)
    .order("display_name");
  if (error) throw error;
  return (data ?? []).map((row) => mapExpert(object(row)));
});

export const getExpertScorecards = cache(async (): Promise<ExpertScorecard[]> => {
  if (!integrations.supabase) return rosterAsExperts().map(emptyScorecard);
  const client = await createServerSupabaseClient();
  const { data, error } = await client!
    .from("expert_scorecards")
    .select("*")
    .order("wilson_rank_score", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapScorecard(object(row)));
});

export type LeaderboardLedgerRow = LedgerRow & { expertSlug: string; expertName: string };

const LEDGER_OUTCOMES: LedgerOutcome[] = ["correct", "incorrect", "partial", "ambiguous", "void"];

/** Number of active topics, without loading them. */
export const getActiveTopicCount = cache(async (): Promise<number> => {
  if (!integrations.supabase) return (await getTopics()).length;
  const client = await createServerSupabaseClient();
  const { count, error } = await client!.from("topics").select("id", { count: "exact", head: true }).eq("status", "active");
  if (error) throw error;
  return count ?? 0;
});

/**
 * The most-traded active markets, for the homepage's market strip. Bounded:
 * the homepage used to load every topic with every market just to pick six.
 */
export const getTopActiveMarkets = cache(async (limit = 60): Promise<Market[]> => {
  if (!integrations.supabase) return [];
  const client = await createServerSupabaseClient();
  const { data, error } = await client!
    .from("markets")
    .select(MARKET_LIST_COLUMNS)
    .eq("active", true)
    .eq("closed", false)
    .order("volume", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => mapMarket(object(row)));
});

/** Every published prediction (not takes) with its approved verdict, for the leaderboard ledger strips. */
export const getLeaderboardLedgerRows = cache(async (): Promise<LeaderboardLedgerRow[]> => {
  if (!integrations.supabase) return [];
  const client = await createServerSupabaseClient();
  const { data, error } = await client!
    .from("predictions")
    .select("id, expert_id, normalized_claim, resolution_date, status, experts(slug, display_name), resolutions(outcome, approved_at)")
    .not("published_at", "is", null)
    .neq("status", "source_unavailable")
    .eq("record_type", "prediction")
    .order("resolution_date", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return (data ?? []).map((raw) => {
    const row = object(raw);
    const resolution = firstRelation(row.resolutions);
    const expert = firstRelation(row.experts);
    const outcome = resolution.approved_at && LEDGER_OUTCOMES.includes(resolution.outcome as LedgerOutcome) ? (resolution.outcome as LedgerOutcome) : null;
    return {
      id: String(row.id ?? ""),
      expertId: String(row.expert_id ?? ""),
      claim: String(row.normalized_claim ?? ""),
      resolutionDate: stringOrNull(row.resolution_date),
      status: String(row.status ?? "open"),
      outcome,
      expertSlug: String(expert.slug ?? ""),
      expertName: String(expert.display_name ?? ""),
    };
  });
});

export const getExpertBySlug = cache(async (slug: string): Promise<{ scorecard: ExpertScorecard; predictions: Prediction[] } | null> => {
  if (!integrations.supabase) {
    const expert = rosterAsExperts().find((item) => item.slug === slug);
    return expert ? { scorecard: emptyScorecard(expert), predictions: [] } : null;
  }
  const client = await createServerSupabaseClient();
  const { data: expertRow, error } = await client!.from("experts").select("*, expert_categories(category_slug)").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!expertRow) return null;
  const expert = mapExpert(object(expertRow));
  const [{ data: scoreRow }, { data: predictionRows, error: predictionError }] = await Promise.all([
    client!.from("expert_scorecards").select("*").eq("expert_id", expert.id).maybeSingle(),
    client!
      .from("predictions")
      .select("*, experts(*, expert_categories(category_slug)), sources(*), resolutions(*, resolution_evidence(*)), prediction_topics(topics(*)), prediction_markets(markets(*))")
      .eq("expert_id", expert.id)
      .not("published_at", "is", null)
      .order("prediction_date", { ascending: false })
      .limit(100),
  ]);
  if (predictionError) throw predictionError;
  return {
    scorecard: scoreRow ? mapScorecard(object(scoreRow)) : emptyScorecard(expert),
    predictions: (predictionRows ?? []).map((row) => mapPrediction(object(row))),
  };
});

export type PredictionHistoryEntry = {
  id: string;
  action: string;
  actorType: string;
  reason: string | null;
  createdAt: string;
};

export const getPredictionHistory = cache(async (id: string): Promise<PredictionHistoryEntry[]> => {
  if (!integrations.supabase) return [];
  const client = await createServerSupabaseClient();
  const { data, error } = await client!
    .from("prediction_history")
    .select("id, action, actor_type, reason, created_at")
    .eq("prediction_id", id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const item = object(row);
    return {
      id: String(item.id ?? ""),
      action: String(item.action ?? ""),
      actorType: String(item.actor_type ?? ""),
      reason: stringOrNull(item.reason),
      createdAt: String(item.created_at ?? ""),
    };
  });
});

export const getPredictionById = cache(async (id: string): Promise<Prediction | null> => {
  if (process.env.ENABLE_SYNTHETIC_FIXTURES === "true" && id === SYNTHETIC_PREDICTION_ID) return syntheticPrediction;
  if (!integrations.supabase) return null;
  const client = await createServerSupabaseClient();
  const { data, error } = await client!
    .from("predictions")
    .select("*, experts(*, expert_categories(category_slug)), sources(*), resolutions(*, resolution_evidence(*)), prediction_topics(topics(*)), prediction_markets(markets(*))")
    .eq("id", id)
    .not("published_at", "is", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapPrediction(object(data)) : null;
});

export const getLatestPredictions = cache(async (options: { limit?: number; resolved?: boolean; open?: boolean; recordType?: "prediction" | "take" | "any" } = {}): Promise<Prediction[]> => {
  if (!integrations.supabase) return [];
  const client = await createServerSupabaseClient();
  let query = client!
    .from("predictions")
    .select("*, experts(*, expert_categories(category_slug)), sources(*), resolutions(*, resolution_evidence(*)), prediction_topics(topics(*)), prediction_markets(markets(*))")
    .not("published_at", "is", null)
    .order(options.resolved ? "updated_at" : "prediction_date", { ascending: false })
    .limit(options.limit ?? 10);
  if (options.resolved) query = query.eq("status", "resolved");
  if (options.open) query = query.in("status", ["open", "due", "resolution_pending"]);
  // Default to scored predictions only. Takes are soft, imputed claims and
  // must not be mixed into the primary "latest / resolved / open" streams —
  // they get their own dedicated surface.
  const recordType = options.recordType ?? "prediction";
  if (recordType !== "any") query = query.eq("record_type", recordType);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => mapPrediction(object(row)));
});

async function liveTopicsFromPolymarket(): Promise<Topic[]> {
  const markets = await fallbackMarkets(24);
  const bySlug = new Map<string, Topic>();
  for (const market of markets) {
    const normalized = normalizeMarketTopic(market.question);
    if (!normalized.isUsefulTopic) continue;
    const existing = bySlug.get(normalized.topicSlug);
    if (existing) existing.markets?.push(market);
    else bySlug.set(normalized.topicSlug, {
      id: `live-${normalized.topicSlug}`,
      slug: normalized.topicSlug,
      title: normalized.topicTitle,
      categorySlug: normalized.category,
      description: normalized.description,
      status: "active",
      markets: [market],
    });
  }
  return [...bySlug.values()];
}

// Market columns for lists. Leaves out description and the raw provider
// payload, which made the all-topics query sort ~34 MB on disk and blow the
// public role's 3 s statement timeout (the homepage and sitemap went down).
const MARKET_LIST_COLUMNS = "id, provider, provider_market_id, provider_slug, topic_id, question, end_at, active, closed, volume, liquidity, yes_probability, no_probability, fetched_at";

export const getTopics = cache(async (): Promise<Topic[]> => {
  if (!integrations.supabase) return liveTopicsFromPolymarket();
  const client = await createServerSupabaseClient();
  const { data, error } = await client!.from("topics").select(`id, slug, title, category_slug, status, markets(${MARKET_LIST_COLUMNS})`).eq("status", "active").order("title");
  if (error) throw error;
  const stored = (data ?? []).map((row) => mapTopic(object(row)));
  return stored.length ? stored : liveTopicsFromPolymarket();
});

export const getTopicBySlug = cache(async (slug: string): Promise<{ topic: Topic; predictions: Prediction[] } | null> => {
  if (!integrations.supabase) {
    const topic = (await getTopics()).find((item) => item.slug === slug);
    return topic ? { topic, predictions: [] } : null;
  }
  const client = await createServerSupabaseClient();
  const { data: topicRow, error } = await client!.from("topics").select("*, markets(*)").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!topicRow) return null;
  const topic = mapTopic(object(topicRow));
  const { data: links, error: linkError } = await client!
    .from("prediction_topics")
    .select("predictions(*, experts(*, expert_categories(category_slug)), sources(*), resolutions(*, resolution_evidence(*)), prediction_topics(topics(*)), prediction_markets(markets(*)))")
    .eq("topic_id", topic.id);
  if (linkError) throw linkError;
  const predictions = (links ?? [])
    .map((link) => mapPrediction(firstRelation(object(link).predictions)))
    .filter((prediction) => prediction.id && prediction.publishedAt);
  return { topic, predictions };
});

export const getHomepageData = cache(async () => {
  const [scorecards, latest, resolved, open, takes, activeMarkets, published, topicCount] = await Promise.all([
    getExpertScorecards(),
    getLatestPredictions({ limit: 6 }),
    getLatestPredictions({ limit: 8, resolved: true }),
    getLatestPredictions({ limit: 4, open: true }),
    getLatestPredictions({ limit: 4, recordType: "take" }),
    getTopActiveMarkets(60),
    getPublishedPredictionCount(),
    getActiveTopicCount(),
  ]);
  const storedMarkets = selectDiverseMarkets(activeMarkets, 6);
  const markets = storedMarkets.length ? storedMarkets : await fallbackMarkets(6);
  // The flagship is the resolved prediction we most want a first-time visitor
  // to open. Prefer the most recent decisive miss (highest visceral payoff),
  // then the most recent hit, then anything resolved at all.
  const flagship =
    resolved.find((prediction) => prediction.resolution?.outcome === "incorrect") ??
    resolved.find((prediction) => prediction.resolution?.outcome === "correct") ??
    resolved[0] ?? null;
  return {
    markets,
    scorecards: scorecards.filter((scorecard) => scorecard.leaderboardEligible).slice(0, 10),
    latest,
    resolved: resolved.slice(0, 4),
    open,
    takes,
    topicCount,
    published,
    flagship,
    rosterPreview: scorecards.slice(0, 12),
    expertCount: scorecards.length,
    rosterNames: scorecards.map((scorecard) => scorecard.expert.displayName),
  };
});

async function getPublishedPredictionCount(): Promise<number> {
  if (!integrations.supabase) return 0;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from("predictions")
    .select("id", { count: "exact", head: true })
    .not("published_at", "is", null);
  if (error) return 0;
  return count ?? 0;
}

export async function searchPublic(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim().slice(0, 120);
  if (trimmed.length < 2) return [];
  if (!integrations.supabase) {
    const lower = trimmed.toLowerCase().replace(/^@/, "");
    const [experts, topics] = await Promise.all([getExperts(), getTopics()]);
    return [
      ...experts
        .filter((expert) => expert.displayName.toLowerCase().includes(lower) || expert.xHandle?.toLowerCase().includes(lower))
        .slice(0, 6)
        .map((expert): SearchResult => ({ type: "expert", id: expert.id, title: expert.displayName, subtitle: expert.xHandle ? `@${expert.xHandle}` : expert.headline, href: `/experts/${expert.slug}`, score: 1 })),
      ...topics
        .filter((topic) => topic.title.toLowerCase().includes(lower))
        .slice(0, 4)
        .map((topic): SearchResult => ({ type: "topic", id: topic.id, title: topic.title, subtitle: "Live Polymarket topic", href: `/topics/${topic.slug}`, score: 0.8 })),
    ];
  }
  const client = await createServerSupabaseClient();
  const { data, error } = await client!.rpc("global_search", { search_query: trimmed, result_limit: 10 });
  if (error) throw error;
  return (data ?? []).map((row: unknown) => {
    const item = object(row);
    return {
      type: item.result_type as SearchResult["type"],
      id: String(item.result_id ?? ""),
      title: String(item.title ?? ""),
      subtitle: stringOrNull(item.subtitle),
      href: String(item.href ?? "#"),
      score: numberOrNull(item.score) ?? 0,
    };
  });
}
