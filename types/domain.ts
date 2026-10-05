import type { CategorySlug } from "@/lib/constants";

export type PredictionStatus =
  | "open"
  | "due"
  | "resolution_pending"
  | "resolved"
  | "ambiguous"
  | "void"
  | "source_unavailable";

export type ResolutionOutcome = "correct" | "incorrect" | "partial" | "ambiguous" | "void";

export type Expert = {
  id: string;
  slug: string;
  displayName: string;
  xHandle: string | null;
  xUserId?: string | null;
  avatarUrl: string | null;
  headline: string | null;
  primaryCategorySlug: CategorySlug;
  categorySlugs: CategorySlug[];
  sourceStatus: "unverified" | "verified" | "unresolved";
};

export type Source = {
  id: string;
  sourceType: string;
  externalId: string | null;
  canonicalPath: string | null;
  authorHandle: string | null;
  publishedAt: string;
  exactText: string | null;
  deletedAt: string | null;
};

export type Resolution = {
  outcome: ResolutionOutcome;
  explanation: string;
  resolutionConfidence: number | null;
  resolvedAt: string;
  approvedAt: string | null;
  evidence: Array<{
    id: string;
    sourceType: string;
    sourceTitle: string | null;
    sourcePath: string;
    publisher: string | null;
    excerpt: string | null;
    isPrimarySource: boolean;
  }>;
};

export type RecordType = "prediction" | "take";

export type Prediction = {
  id: string;
  expert: Expert;
  source: Source;
  categorySlug: CategorySlug;
  normalizedClaim: string;
  sourceQuote: string;
  predictionDate: string;
  resolutionDate: string | null;
  resolutionCriteria: string;
  explicitProbability: number | null;
  confidenceLanguage: string | null;
  status: PredictionStatus;
  publishedAt: string | null;
  resolution: Resolution | null;
  topics: Topic[];
  markets: Market[];
  recordType: RecordType;
  imputationNote: string | null;
  /** "backfill" = captured from the archive after publication, not recorded live. */
  captureMode: "live" | "backfill";
};

export type Market = {
  id: string;
  provider: "polymarket" | string;
  providerMarketId: string;
  providerSlug: string | null;
  topicId: string | null;
  question: string;
  description: string | null;
  endAt: string | null;
  active: boolean;
  closed: boolean;
  volume: number | null;
  liquidity: number | null;
  yesProbability: number | null;
  noProbability: number | null;
  fetchedAt: string;
  raw?: Record<string, unknown>;
};

export type Topic = {
  id: string;
  slug: string;
  title: string;
  categorySlug: CategorySlug;
  description: string | null;
  status: "active" | "closed" | "archived";
  markets?: Market[];
};

export type ExpertScorecard = {
  expert: Expert;
  totalPredictions: number;
  openPredictions: number;
  resolvedPredictions: number;
  correctPredictions: number;
  incorrectPredictions: number;
  partialPredictions: number;
  ambiguousPredictions: number;
  voidPredictions: number;
  accuracy: number | null;
  wilsonRankScore: number | null;
  probabilisticPredictions: number;
  brierScore: number | null;
  leaderboardEligible: boolean;
  provisional: boolean;
  totalTakes: number;
};

export type SearchResult = {
  type: "expert" | "prediction" | "topic" | "market";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  score: number;
};
