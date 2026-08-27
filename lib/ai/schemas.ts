import { z } from "zod";
import { CATEGORY_SLUGS } from "@/lib/constants";

export const categorySchema = z.enum(CATEGORY_SLUGS);

export const extractedPredictionSchema = z.object({
  normalized_claim: z.string().min(1),
  source_quote: z.string().min(1),
  resolution_date: z.string().nullable(),
  resolution_criteria: z.string().min(1),
  explicit_probability: z.number().min(0).max(1).nullable(),
  confidence_language: z.string().nullable(),
  category: categorySchema,
  extraction_confidence: z.number().min(0).max(1),
  falsifiability_score: z.number().min(0).max(1),
  source_fidelity_score: z.number().min(0).max(1),
});

export const extractionResponseSchema = z.object({
  source_is_usable: z.boolean(),
  speaker_is_author: z.boolean(),
  predictions: z.array(extractedPredictionSchema).max(5),
  reason_rejected: z.string().nullable(),
});

export const predictionVerifierSchema = z.object({
  verdict: z.enum([
    "faithful",
    "unsupported",
    "overstated",
    "understated",
    "ambiguous",
    "wrong_speaker",
    "not_prediction",
    "bad_deadline",
    "bad_resolution_criteria",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export const marketMatchSchema = z.object({
  is_match: z.boolean(),
  score: z.number().min(0).max(1),
  same_outcome_definition: z.boolean(),
  same_timeframe: z.boolean(),
  reason: z.string(),
});

export const resolutionProposalSchema = z.object({
  proposed_outcome: z.enum(["correct", "incorrect", "partial", "ambiguous", "void"]),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  scoring_eligible: z.boolean(),
  evidence: z.array(
    z.object({
      title: z.string(),
      source_path: z.string(),
      publisher: z.string().nullable(),
      excerpt: z.string().nullable(),
      is_primary_source: z.boolean(),
    }),
  ),
});

export const resolutionVerifierSchema = z.object({
  verdict: z.enum(["approve", "reject", "needs_review"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type ExtractionResponse = z.infer<typeof extractionResponseSchema>;
export type ExtractedPrediction = z.infer<typeof extractedPredictionSchema>;
export type PredictionVerifierResult = z.infer<typeof predictionVerifierSchema>;
export type MarketMatchResult = z.infer<typeof marketMatchSchema>;
export type ResolutionProposal = z.infer<typeof resolutionProposalSchema>;
export type ResolutionVerifierResult = z.infer<typeof resolutionVerifierSchema>;
