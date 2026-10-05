import type { Prediction } from "@/types/domain";

/** Test-only data. This module is gated by ENABLE_SYNTHETIC_FIXTURES in the public DAL. */
export const SYNTHETIC_PREDICTION_ID = "00000000-0000-4000-8000-000000000001";

export const syntheticPrediction: Prediction = {
  id: SYNTHETIC_PREDICTION_ID,
  expert: {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "alex-example",
    displayName: "Alex Example",
    xHandle: "alex_example_fixture",
    xUserId: null,
    avatarUrl: null,
    headline: "Synthetic test fixture — not a real public figure",
    primaryCategorySlug: "ai-tech",
    categorySlugs: ["ai-tech"],
    sourceStatus: "verified",
  },
  source: {
    id: "00000000-0000-4000-8000-000000000003",
    sourceType: "manual",
    externalId: "fixture-source-1",
    canonicalPath: null,
    authorHandle: "alex_example_fixture",
    publishedAt: "2026-01-15T12:00:00.000Z",
    exactText: "For this test fixture, the example benchmark will exceed 80 by December 31, 2026.",
    deletedAt: null,
  },
  categorySlug: "ai-tech",
  normalizedClaim: "The synthetic example benchmark will exceed 80 by December 31, 2026.",
  sourceQuote: "the example benchmark will exceed 80 by December 31, 2026",
  predictionDate: "2026-01-15T12:00:00.000Z",
  resolutionDate: "2026-12-31T23:59:59.000Z",
  resolutionCriteria: "Correct if the synthetic fixture benchmark's published test value is greater than 80 at the deadline; otherwise incorrect.",
  explicitProbability: null,
  confidenceLanguage: "will",
  status: "open",
  publishedAt: "2026-01-15T12:05:00.000Z",
  resolution: null,
  topics: [],
  markets: [],
  recordType: "prediction",
  captureMode: "live",
  imputationNote: null,
};
