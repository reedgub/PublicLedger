// Cost forecast for a backfill, computed BEFORE any billed post read.
//
// Inputs are post counts from the X counts endpoint (free of post reads) and
// podcast audio hours from feed metadata. Stage pass-through ratios come from
// this database once there is history to measure; until then conservative
// defaults are used. The forecast is an estimate — verify provider prices in
// .env before trusting the dollar figures.

import { env } from "@/lib/env";
import { getDatabase } from "@/lib/db/postgres";
import { CASCADE_EXTRACTION_SYSTEM_PROMPT } from "@/lib/pipeline/extract";
import { SCREEN_SYSTEM_PROMPT } from "@/lib/pipeline/screen";
import { CASCADE_VERIFIER_SYSTEM_PROMPT } from "@/lib/pipeline/verify";

export type StageRatios = {
  /** Share of fetched posts that pass the stage 0 heuristic. */
  heuristicPass: number;
  /** Share of heuristic passes the stage 1 screen keeps. */
  screenKeep: number;
  /** Candidates produced per extracted source. */
  candidatesPerExtracted: number;
  /** Share of candidates that survive deterministic validation + dedupe into verification. */
  toVerify: number;
  measured: boolean;
};

export const DEFAULT_RATIOS: StageRatios = {
  // X posts are already keyword-filtered server-side, so most pass stage 0.
  heuristicPass: 0.6,
  screenKeep: 0.35,
  candidatesPerExtracted: 0.5,
  toVerify: 0.6,
  measured: false,
};

export type CostForecast = {
  xPosts: number;
  xReadUsd: number;
  audioHours: number;
  transcriptionUsd: number;
  screenUsd: number;
  extractUsd: number;
  verifyUsd: number;
  totalUsd: number;
  expectedCandidates: number;
  ratios: StageRatios;
};

const tokens = (chars: number) => chars / 4;

export function forecastCost(input: { xPosts: number; audioHours: number; writingDocs: number; ratios?: StageRatios; withScreen: boolean }): CostForecast {
  const ratios = input.ratios ?? DEFAULT_RATIOS;
  const xReadUsd = input.xPosts * env.X_PRICE_PER_POST_READ_USD;
  const transcriptionUsd = input.audioHours * env.TRANSCRIBE_PRICE_PER_HOUR_USD;

  // Long documents become several ~2k-char units after stage 0.
  const unitsPerHour = 8;
  const unitsPerDoc = 3;
  const heuristicUnits = input.xPosts * ratios.heuristicPass + input.audioHours * unitsPerHour + input.writingDocs * unitsPerDoc;

  const screenPrice = { input: env.OPEN_MODEL_SCREEN_PRICE_INPUT_PER_MTOK_USD, output: env.OPEN_MODEL_SCREEN_PRICE_OUTPUT_PER_MTOK_USD };
  const screenBatches = heuristicUnits / 20;
  const screenUsd = input.withScreen
    ? (screenBatches * tokens(SCREEN_SYSTEM_PROMPT.length) * screenPrice.input + heuristicUnits * 350 * screenPrice.input + screenBatches * 60 * screenPrice.output) / 1_000_000
    : 0;

  const extractUnits = heuristicUnits * (input.withScreen ? ratios.screenKeep : 1);
  const extractPrice = env.OPEN_MODEL_API_KEY
    ? { input: env.OPEN_MODEL_EXTRACT_PRICE_INPUT_PER_MTOK_USD, output: env.OPEN_MODEL_EXTRACT_PRICE_OUTPUT_PER_MTOK_USD }
    : { input: env.OPENAI_PRICE_INPUT_PER_MTOK_USD, output: env.OPENAI_PRICE_OUTPUT_PER_MTOK_USD };
  const extractUsd = extractUnits * ((tokens(CASCADE_EXTRACTION_SYSTEM_PROMPT.length) + 500) * extractPrice.input + 500 * extractPrice.output) / 1_000_000;

  const expectedCandidates = extractUnits * ratios.candidatesPerExtracted;
  const verified = expectedCandidates * ratios.toVerify;
  const discount = env.VERIFIER_MODE === "batch" ? env.OPENAI_BATCH_DISCOUNT : 0;
  const verifyUsd = verified * ((tokens(CASCADE_VERIFIER_SYSTEM_PROMPT.length) + 700) * env.OPENAI_PRICE_INPUT_PER_MTOK_USD + 400 * env.OPENAI_PRICE_OUTPUT_PER_MTOK_USD) / 1_000_000 * (1 - discount);

  const totalUsd = xReadUsd + transcriptionUsd + screenUsd + extractUsd + verifyUsd;
  return { xPosts: input.xPosts, xReadUsd, audioHours: input.audioHours, transcriptionUsd, screenUsd, extractUsd, verifyUsd, totalUsd, expectedCandidates, ratios };
}

/** Measure stage ratios from cascade history; falls back to defaults below a minimum sample. */
export async function measuredRatios(minSources = 500): Promise<StageRatios> {
  const sql = getDatabase();
  const [row] = await sql<{ total: string; heuristic_dropped: string; screen_dropped: string; extracted: string; candidates: string; to_verify: string }[]>`
    select
      count(*) filter (where screen_status in ('dropped', 'passed', 'extracted'))::text as total,
      count(*) filter (where screen_status = 'dropped' and screen_model = 'heuristic')::text as heuristic_dropped,
      count(*) filter (where screen_status = 'dropped' and screen_model <> 'heuristic')::text as screen_dropped,
      count(*) filter (where screen_status = 'extracted')::text as extracted,
      (select count(*) from public.prediction_candidates where pipeline = 'cascade')::text as candidates,
      (select count(*) from public.prediction_candidates where pipeline = 'cascade' and status not in ('rejected', 'duplicate'))::text as to_verify
    from public.sources where source_type = 'x' and screened_at is not null
  `;
  const total = Number(row?.total ?? 0);
  if (total < minSources) return DEFAULT_RATIOS;
  const heuristicPassed = total - Number(row.heuristic_dropped);
  const extracted = Number(row.extracted);
  const candidates = Number(row.candidates);
  return {
    heuristicPass: heuristicPassed / total,
    screenKeep: heuristicPassed > 0 ? extracted / heuristicPassed : DEFAULT_RATIOS.screenKeep,
    candidatesPerExtracted: extracted > 0 ? candidates / extracted : DEFAULT_RATIOS.candidatesPerExtracted,
    toVerify: candidates > 0 ? Number(row.to_verify) / candidates : DEFAULT_RATIOS.toVerify,
    measured: true,
  };
}
