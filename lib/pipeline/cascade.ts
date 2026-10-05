// The cascade: stage 0 (heuristic/chunking) → stage 1 (cheap open-model
// screen) → stage 2 (open-model extraction) → deterministic validation and
// dedupe → candidate rows awaiting stage 3 (frontier verification).
//
// Every paid step checks the BudgetGuard first and books its spend in the
// ledger. Sources that could not be finished because the budget ran out stay
// in their current state and are picked up by the next run.

import pLimit from "p-limit";
import { env } from "@/lib/env";
import { getDatabase } from "@/lib/db/postgres";
import { EXTRACTION_SCHEMA_VERSION } from "@/lib/constants";
import type { ExtractedPrediction } from "@/lib/ai/schemas";
import { isLikelyDuplicate } from "@/lib/predictions/dedupe";
import { validateExtractedPrediction } from "@/lib/predictions/validation";
import { selectUnits, type TextUnit } from "@/lib/pipeline/chunk";
import { screenItems, SCREEN_PROMPT_VERSION, type ScreenItem } from "@/lib/pipeline/screen";
import { CASCADE_EXTRACTION_VERSION, estimateExtractionCostUsd, extractionTarget, extractUnit } from "@/lib/pipeline/extract";
import { recordSpend, type BudgetGuard, type SpendScope } from "@/lib/pipeline/spend";

type CascadeSourceRow = {
  id: string;
  exact_text: string;
  published_at: string;
  source_type: string;
  ingestion_mode: "live" | "backfill";
  screen_status: "pending" | "passed";
  metadata: Record<string, unknown>;
  expert_id: string;
  display_name: string;
  x_handle: string | null;
};

export type CascadeSummary = {
  sourcesExamined: number;
  droppedByHeuristic: number;
  droppedByScreen: number;
  screenFailOpen: number;
  passed: number;
  extracted: number;
  extractionErrors: number;
  candidatesPending: number;
  candidatesRejected: number;
  duplicates: number;
  deferredByBudget: number;
  costUsd: number;
};

/** Source kinds whose candidates always need a human (no reliable speaker attribution). */
export function sourceForcesReview(sourceType: string, metadata: Record<string, unknown>): boolean {
  return sourceType === "podcast" && metadata.expertIsHost !== true;
}

/** Dedupe the predictions a single source produced across its units. */
export function dedupeWithinSource(expertId: string, predictions: ExtractedPrediction[]): ExtractedPrediction[] {
  const kept: ExtractedPrediction[] = [];
  // Hard predictions win over takes of the same claim.
  const ordered = predictions.slice().sort((a, b) => Number((a.record_type ?? "prediction") === "take") - Number((b.record_type ?? "prediction") === "take"));
  for (const prediction of ordered) {
    const duplicate = kept.some((existing) =>
      existing.source_quote === prediction.source_quote && existing.normalized_claim === prediction.normalized_claim
      || isLikelyDuplicate(
        { expertId, claim: prediction.normalized_claim, resolutionDate: prediction.resolution_date },
        { expertId, claim: existing.normalized_claim, resolutionDate: existing.resolution_date },
      ));
    if (!duplicate) kept.push(prediction);
  }
  return kept;
}

function unitsFromMetadata(text: string, metadata: Record<string, unknown>): TextUnit[] {
  const ranges = Array.isArray(metadata.screen_units) ? (metadata.screen_units as Array<[number, number]>) : [];
  return ranges
    .filter((range) => Array.isArray(range) && range[0] >= 0 && range[1] <= text.length && range[1] > range[0])
    .map(([start, end]) => ({ text: text.slice(start, end), start, end, score: 0 }));
}

export async function runCascade(options: {
  scope: SpendScope;
  guard: BudgetGuard;
  mode?: "live" | "backfill";
  maxSources?: number;
  runId?: string;
}): Promise<CascadeSummary> {
  const sql = getDatabase();
  const summary: CascadeSummary = {
    sourcesExamined: 0, droppedByHeuristic: 0, droppedByScreen: 0, screenFailOpen: 0, passed: 0, extracted: 0,
    extractionErrors: 0, candidatesPending: 0, candidatesRejected: 0, duplicates: 0, deferredByBudget: 0, costUsd: 0,
  };
  const maxSources = options.maxSources ?? env.CASCADE_MAX_SOURCES_PER_RUN;
  const sources = await sql<CascadeSourceRow[]>`
    select s.id, s.exact_text, s.published_at::text, s.source_type, s.ingestion_mode, s.screen_status, s.metadata,
      e.id as expert_id, e.display_name, e.x_handle
    from public.sources s
    join public.experts e on e.id = coalesce(s.expert_id, (select e2.id from public.experts e2 where lower(e2.x_handle) = lower(s.author_handle) limit 1))
    where s.screen_status in ('pending', 'passed') and s.exact_text is not null and s.deleted_at is null and e.is_active
      and (${options.mode ?? null}::text is null or s.ingestion_mode = ${options.mode ?? null})
    order by s.published_at asc
    limit ${maxSources}
  `;
  summary.sourcesExamined = sources.length;
  if (sources.length === 0) return summary;

  // ---- Stage 0: heuristic gate / passage selection --------------------------
  const unitsBySource = new Map<string, TextUnit[]>();
  const heuristicDrops: string[] = [];
  const screenQueue: ScreenItem[] = [];
  for (const source of sources) {
    if (source.screen_status === "passed") {
      const stored = unitsFromMetadata(source.exact_text, source.metadata);
      if (stored.length > 0) {
        unitsBySource.set(source.id, stored);
        continue;
      }
      // Passed but without stored ranges (e.g. older row): screen again.
      source.screen_status = "pending";
    }
    const units = selectUnits(source.exact_text);
    if (units.length === 0) {
      heuristicDrops.push(source.id);
      continue;
    }
    unitsBySource.set(source.id, units);
    units.forEach((unit, index) => screenQueue.push({ key: `${source.id}:${index}`, text: unit.text }));
  }
  if (heuristicDrops.length) {
    await sql`update public.sources set screen_status = 'dropped', screen_model = 'heuristic', screened_at = now() where id = any(${heuristicDrops}::uuid[])`;
    summary.droppedByHeuristic = heuristicDrops.length;
  }

  // ---- Stage 1: cheap screen ------------------------------------------------
  const screen = await screenItems(screenQueue, {
    beforeCall: (estimate) => options.guard.canSpend(estimate),
  });
  summary.screenFailOpen = screen.failOpen;
  if (screen.costUsd > 0 || screen.usage.inputTokens > 0) {
    await recordSpend({
      scope: options.scope, runId: options.runId, provider: screen.provider ?? "open_model", stage: "screen",
      units: screen.usage.inputTokens + screen.usage.outputTokens, unitKind: "tokens", costUsd: screen.costUsd,
      metadata: { model: screen.model, items: screenQueue.length, kept: screen.kept.size, prompt_version: SCREEN_PROMPT_VERSION },
    }, options.guard);
    summary.costUsd += screen.costUsd;
  }
  const screenLabel = screen.model ?? "heuristic";
  for (const source of sources) {
    if (source.screen_status !== "pending" || !unitsBySource.has(source.id)) continue;
    const units = unitsBySource.get(source.id)!;
    const keys = units.map((_, index) => `${source.id}:${index}`);
    if (!keys.every((key) => screen.screened.has(key))) {
      summary.deferredByBudget += 1;
      unitsBySource.delete(source.id);
      continue;
    }
    const keptUnits = units.filter((_, index) => screen.kept.has(keys[index]));
    if (keptUnits.length === 0) {
      await sql`update public.sources set screen_status = 'dropped', screen_model = ${screenLabel}, screened_at = now() where id = ${source.id}`;
      summary.droppedByScreen += 1;
      unitsBySource.delete(source.id);
      continue;
    }
    unitsBySource.set(source.id, keptUnits);
    const ranges = keptUnits.map((unit) => [unit.start, unit.end]);
    await sql`
      update public.sources set screen_status = 'passed', screen_model = ${screenLabel}, screened_at = now(),
        screen_score = ${Math.max(...keptUnits.map((unit) => unit.score))},
        metadata = metadata || ${sql.json({ screen_units: ranges })}
      where id = ${source.id}
    `;
    summary.passed += 1;
  }

  // ---- Stage 2: extraction --------------------------------------------------
  const target = extractionTarget();
  if (!target) {
    console.warn("No extraction model configured (set OPEN_MODEL_API_KEY or OPENAI_API_KEY); passed sources wait for the next run.");
    return summary;
  }
  const limit = pLimit(env.OPEN_MODEL_CONCURRENCY);
  let extractionCost = 0;
  let extractionTokens = 0;
  await Promise.all(sources.map((source) => limit(async () => {
    const units = unitsBySource.get(source.id);
    if (!units || units.length === 0) return;
    const estimate = units.reduce((sum, unit) => sum + estimateExtractionCostUsd(target, unit.text.length), 0);
    if (!options.guard.canSpend(estimate)) {
      summary.deferredByBudget += 1;
      return;
    }
    const isExcerpt = units.length > 1 || units[0].text.length < source.exact_text.length;
    const collected: ExtractedPrediction[] = [];
    const rejections: Array<{ reason: string }> = [];
    let sourceCost = 0;
    try {
      for (const unit of units) {
        const result = await extractUnit(target, {
          authorName: source.display_name, authorHandle: source.x_handle, sourceType: source.source_type,
          sourceTimestamp: source.published_at, text: unit.text, isExcerpt,
        });
        sourceCost += result.costUsd;
        extractionTokens += result.usage.inputTokens + result.usage.outputTokens;
        if (!result.extraction.sourceIsUsable || !result.extraction.speakerIsAuthor) {
          if (result.extraction.predictions.length) rejections.push({ reason: !result.extraction.speakerIsAuthor ? "speaker_not_author" : (result.extraction.reasonRejected ?? "source_not_usable") });
          continue;
        }
        collected.push(...result.extraction.predictions);
      }
    } catch (error) {
      const usage = (error as { usage?: { inputTokens: number; outputTokens: number } }).usage;
      if (usage) sourceCost += (usage.inputTokens * target.price.input + usage.outputTokens * target.price.output) / 1_000_000;
      summary.extractionErrors += 1;
      options.guard.add(sourceCost);
      extractionCost += sourceCost;
      await sql`update public.sources set screen_status = 'error', metadata = metadata || ${sql.json({ cascade_error: error instanceof Error ? error.message.slice(0, 300) : "unknown" })} where id = ${source.id}`;
      return;
    }
    options.guard.add(sourceCost);
    extractionCost += sourceCost;

    const forceReview = sourceForcesReview(source.source_type, source.metadata);
    const existing = await sql<{ normalized_claim: string; resolution_date: string | null }[]>`
      select normalized_claim, resolution_date::text from public.predictions where expert_id = ${source.expert_id}
      union all
      select normalized_claim, resolution_date::text from public.prediction_candidates
      where expert_id = ${source.expert_id} and status in ('pending', 'review', 'auto_verified') and normalized_claim is not null
    `;
    for (const candidate of dedupeWithinSource(source.expert_id, collected)) {
      const deterministic = validateExtractedPrediction(source.exact_text, source.published_at, candidate);
      const duplicate = deterministic.valid && existing.some((item) => isLikelyDuplicate(
        { expertId: source.expert_id, claim: candidate.normalized_claim, resolutionDate: candidate.resolution_date },
        { expertId: source.expert_id, claim: item.normalized_claim, resolutionDate: item.resolution_date },
      ));
      const status = !deterministic.valid ? "rejected" : duplicate ? "duplicate" : "pending";
      await sql`
        insert into public.prediction_candidates (source_id, expert_id, normalized_claim, source_quote, resolution_date, resolution_criteria,
          explicit_probability, confidence_language, category_slug, extraction_confidence, falsifiability_score, source_fidelity_score,
          status, reason_rejected, model_name, raw_extraction, record_type, imputation_note, pipeline)
        values (${source.id}, ${source.expert_id}, ${candidate.normalized_claim}, ${candidate.source_quote}, ${candidate.resolution_date}, ${candidate.resolution_criteria},
          ${candidate.explicit_probability}, ${candidate.confidence_language}, ${candidate.category}, ${candidate.extraction_confidence}, ${candidate.falsifiability_score}, ${candidate.source_fidelity_score},
          ${status}, ${!deterministic.valid ? deterministic.errors.join(",") : duplicate ? "semantic_duplicate" : null}, ${target.model},
          ${sql.json({ candidate, force_review: forceReview, capture_mode: source.ingestion_mode, extraction_schema_version: EXTRACTION_SCHEMA_VERSION, cascade_version: CASCADE_EXTRACTION_VERSION } as never)},
          ${candidate.record_type ?? "prediction"}, ${candidate.imputation_note ?? null}, 'cascade')
      `;
      if (status === "pending") {
        summary.candidatesPending += 1;
        existing.push({ normalized_claim: candidate.normalized_claim, resolution_date: candidate.resolution_date });
      } else if (status === "duplicate") summary.duplicates += 1;
      else summary.candidatesRejected += 1;
    }
    summary.candidatesRejected += rejections.length;
    await sql`update public.sources set screen_status = 'extracted' where id = ${source.id}`;
    summary.extracted += 1;
  })));

  if (extractionCost > 0 || extractionTokens > 0) {
    // Guard was already charged per source; book the ledger row without re-adding.
    await recordSpend({
      scope: options.scope, runId: options.runId, provider: target.provider, stage: "extract",
      units: extractionTokens, unitKind: "tokens", costUsd: extractionCost,
      metadata: { model: target.model, sources: summary.extracted },
    });
    summary.costUsd += extractionCost;
  }
  return summary;
}
