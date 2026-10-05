// Shared publish path for candidates that cleared every gate. Used by the
// legacy processor and the cascade so both write identical prediction rows,
// audit entries, and topic/market links.

import type { Sql } from "postgres";
import { env } from "@/lib/env";
import { getDatabase } from "@/lib/db/postgres";
import { verifyMarketMatch } from "@/lib/ai/matchMarket";
import { canCreateMarketLink } from "@/lib/matching/markets";
import { predictionFingerprint } from "@/lib/predictions/fingerprint";
import type { ExtractedPrediction } from "@/lib/ai/schemas";

export async function linkPublishedPrediction(
  predictionId: string,
  claim: string,
  resolutionCriteria: string,
  category: string,
  resolutionDate: string | null,
  predictionDate: string,
  options: { linkMarkets?: boolean } = {},
) {
  const sql = getDatabase();
  const topics = await sql<{ id: string; score: number }[]>`
    select id, similarity(title, ${claim}) as score from public.topics
    where category_slug = ${category} and status = 'active' and similarity(title, ${claim}) >= 0.45
    order by score desc limit 3
  `;
  for (const topic of topics) await sql`insert into public.prediction_topics (prediction_id, topic_id, relevance_score) values (${predictionId}, ${topic.id}, ${topic.score}) on conflict do nothing`;

  // Market matching costs one LLM call per candidate market. Skip it when
  // the caller knows it cannot help (e.g. backfilled predictions, which
  // predate every stored market snapshot).
  if (options.linkMarkets === false || !env.OPENAI_API_KEY) return;
  const markets = await sql<{ id: string; question: string; description: string | null; end_at: string | null; score: number }[]>`
    select m.id, m.question, m.description, m.end_at, similarity(m.question, ${claim}) as score
    from public.markets m left join public.topics t on t.id = m.topic_id
    where (t.category_slug = ${category} or similarity(m.question, ${claim}) >= 0.35)
      and similarity(m.question, ${claim}) >= 0.2
    order by score desc limit 3
  `;
  for (const market of markets) {
    const result = await verifyMarketMatch({ normalizedClaim: claim, resolutionCriteria, predictionDate, resolutionDate, marketQuestion: market.question, marketDescription: market.description, marketEndDate: market.end_at });
    if (!canCreateMarketLink(result)) continue;
    const [snapshot] = await sql<{ yes_probability: number | null; distance_hours: number }[]>`
      select yes_probability, abs(extract(epoch from (observed_at - ${predictionDate}::timestamptz))) / 3600 as distance_hours
      from public.market_snapshots where market_id = ${market.id}
      order by abs(extract(epoch from (observed_at - ${predictionDate}::timestamptz))) limit 1
    `;
    const historicalProbability = snapshot && snapshot.distance_hours <= env.HISTORICAL_MARKET_MAX_DISTANCE_HOURS ? snapshot.yes_probability : null;
    await sql`insert into public.prediction_markets (prediction_id, market_id, semantic_match_score, market_probability_at_prediction) values (${predictionId}, ${market.id}, ${result.score}, ${historicalProbability}) on conflict do nothing`;
  }
}

export type PublishInput = {
  candidateId: string;
  expertId: string;
  sourceId: string;
  predictionDate: string;
  candidate: ExtractedPrediction;
  verificationMode: "auto" | "auto_low_confidence" | "admin";
  captureMode: "live" | "backfill";
  auditAction: string;
  auditReason: string;
  auditAfter?: Record<string, unknown>;
};

export async function publishCandidate(input: PublishInput, sql: Sql = getDatabase()): Promise<string> {
  const { candidate } = input;
  if (!candidate.resolution_date) throw new Error("Cannot publish a candidate without a resolution date.");
  const recordType = candidate.record_type ?? "prediction";
  const fingerprint = predictionFingerprint({
    expertId: input.expertId,
    sourceId: input.sourceId,
    normalizedClaim: candidate.normalized_claim,
    predictionDate: input.predictionDate,
    resolutionDate: candidate.resolution_date,
    resolutionCriteria: candidate.resolution_criteria,
    explicitProbability: candidate.explicit_probability,
  });
  const [prediction] = await sql<{ id: string }[]>`
    insert into public.predictions (expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
      resolution_date, resolution_criteria, explicit_probability, confidence_language, falsifiability_score, verification_mode,
      status, fingerprint_sha256, published_at, frozen_at, record_type, imputation_note, capture_mode)
    values (${input.expertId}, ${input.sourceId}, ${candidate.category}, ${candidate.normalized_claim}, ${candidate.source_quote}, ${input.predictionDate},
      ${candidate.resolution_date}, ${candidate.resolution_criteria}, ${candidate.explicit_probability}, ${candidate.confidence_language}, ${candidate.falsifiability_score}, ${input.verificationMode},
      ${new Date(candidate.resolution_date) <= new Date() ? "due" : "open"}, ${fingerprint}, now(), now(),
      ${recordType}, ${recordType === "take" ? candidate.imputation_note ?? null : null}, ${input.captureMode})
    on conflict (fingerprint_sha256) do update set updated_at = public.predictions.updated_at
    returning id
  `;
  await sql`update public.prediction_candidates set status = 'approved' where id = ${input.candidateId}`;
  await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction', ${prediction.id}, ${input.auditAction}, 'system', ${sql.json({ candidate_id: input.candidateId, fingerprint, record_type: recordType, capture_mode: input.captureMode, ...(input.auditAfter ?? {}) } as never)}, ${input.auditReason})`;
  await linkPublishedPrediction(prediction.id, candidate.normalized_claim, candidate.resolution_criteria, candidate.category, candidate.resolution_date, input.predictionDate, { linkMarkets: input.captureMode === "live" });
  return prediction.id;
}
