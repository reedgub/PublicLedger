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
import { isLikelyDuplicate } from "@/lib/predictions/dedupe";
import { validateExtractedPrediction } from "@/lib/predictions/validation";

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
  candidate: ExtractedPrediction;
  verificationMode: "auto" | "auto_low_confidence" | "admin";
  captureMode: "live" | "backfill";
  auditAction: string;
  auditReason: string;
  auditAfter?: Record<string, unknown>;
};

export type PublishResult =
  | { kind: "published"; predictionId: string }
  | { kind: "duplicate"; reason: string }
  | { kind: "rejected"; reason: string }
  | { kind: "skipped"; reason: string };

const OPEN_CANDIDATE_STATUSES = ["pending", "review", "auto_verified"];

/**
 * The one publish path for pipeline candidates. Runs in a single transaction:
 *
 *   - serialises publishes per expert (advisory lock) so two runs can't
 *     publish the same claim twice;
 *   - re-reads the candidate (must still be open) and the source as it is NOW
 *     (must not be deleted) and re-runs deterministic validation against the
 *     current text, so nothing that changed since extraction or verification
 *     slips through;
 *   - uses the source's own timestamp as the prediction date;
 *   - writes the prediction, the candidate status and the audit entry together,
 *     so a crash can never leave a published prediction without its audit row.
 *
 * The database enforces the same rules again (guard_prediction_insert), so a
 * bug here fails loudly instead of publishing. Topic and market links are
 * added after commit: they are informational and may call a model.
 */
export async function publishCandidate(input: PublishInput, sql: Sql = getDatabase()): Promise<PublishResult> {
  const { candidate } = input;
  const recordType = candidate.record_type ?? "prediction";
  const outcome = await sql.begin(async (tx): Promise<PublishResult & { predictionDate?: string }> => {
    await tx`select pg_advisory_xact_lock(hashtext(${`publish:${input.expertId}`}))`;
    const [current] = await tx<{ status: string }[]>`select status from public.prediction_candidates where id = ${input.candidateId} for update`;
    if (!current) return { kind: "skipped", reason: "candidate_missing" };
    if (!OPEN_CANDIDATE_STATUSES.includes(current.status)) return { kind: "skipped", reason: `candidate_${current.status}` };

    const reject = async (status: "rejected" | "duplicate", reason: string): Promise<PublishResult> => {
      await tx`update public.prediction_candidates set status = ${status}, reason_rejected = ${reason.slice(0, 500)} where id = ${input.candidateId}`;
      await tx`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason)
        values ('prediction_candidate', ${input.candidateId}, ${status === "duplicate" ? "duplicate_merged" : "prediction_rejected"}, 'system', ${tx.json({ status } as never)}, ${`Publish-time check: ${reason}`.slice(0, 1000)})`;
      return { kind: status, reason };
    };

    const [source] = await tx<{ exact_text: string | null; published_at: string; deleted_at: string | null }[]>`
      select exact_text, published_at::text, deleted_at::text from public.sources where id = ${input.sourceId} for share
    `;
    if (!source || source.deleted_at || !source.exact_text) return reject("rejected", "source_unavailable_at_publish");
    if (!candidate.resolution_date) return reject("rejected", "resolution_date_missing");
    const validation = validateExtractedPrediction(source.exact_text, source.published_at, candidate);
    if (!validation.valid) return reject("rejected", validation.errors.join(","));

    const published = await tx<{ normalized_claim: string; resolution_date: string | null }[]>`
      select normalized_claim, resolution_date::text from public.predictions where expert_id = ${input.expertId} and published_at is not null
    `;
    if (published.some((item) => isLikelyDuplicate(
      { expertId: input.expertId, claim: candidate.normalized_claim, resolutionDate: candidate.resolution_date },
      { expertId: input.expertId, claim: item.normalized_claim, resolutionDate: item.resolution_date },
    ))) return reject("duplicate", "semantic_duplicate");

    const fingerprint = predictionFingerprint({
      expertId: input.expertId,
      sourceId: input.sourceId,
      normalizedClaim: candidate.normalized_claim,
      predictionDate: source.published_at,
      resolutionDate: candidate.resolution_date,
      resolutionCriteria: candidate.resolution_criteria,
      explicitProbability: candidate.explicit_probability,
    });
    // prediction_date is copied in SQL: passing it through the driver would
    // round it to milliseconds.
    const [prediction] = await tx<{ id: string }[]>`
      insert into public.predictions (expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
        resolution_date, resolution_criteria, explicit_probability, confidence_language, falsifiability_score, verification_mode,
        status, fingerprint_sha256, published_at, frozen_at, record_type, imputation_note, capture_mode)
      values (${input.expertId}, ${input.sourceId}, ${candidate.category}, ${candidate.normalized_claim}, ${candidate.source_quote}, (select published_at from public.sources where id = ${input.sourceId}),
        ${candidate.resolution_date}, ${candidate.resolution_criteria}, ${candidate.explicit_probability}, ${candidate.confidence_language}, ${candidate.falsifiability_score}, ${input.verificationMode},
        ${new Date(candidate.resolution_date) <= new Date() ? "due" : "open"}, ${fingerprint}, now(), now(),
        ${recordType}, ${recordType === "take" ? candidate.imputation_note ?? null : null}, ${input.captureMode})
      on conflict (fingerprint_sha256) do nothing
      returning id
    `;
    if (!prediction) return reject("duplicate", "identical_prediction_exists");
    await tx`update public.prediction_candidates set status = 'approved', reason_rejected = null where id = ${input.candidateId}`;
    await tx`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction', ${prediction.id}, ${input.auditAction}, 'system', ${tx.json({ candidate_id: input.candidateId, fingerprint, record_type: recordType, capture_mode: input.captureMode, ...(input.auditAfter ?? {}) } as never)}, ${input.auditReason})`;
    return { kind: "published", predictionId: prediction.id, predictionDate: source.published_at };
  });
  if (outcome.kind === "published") {
    // Topic and market links are informational context, added after the
    // publish has committed. A failure here (e.g. the market matcher's
    // provider is out of credits) must never fail the publish or stop a
    // verification run: the prediction is already live and correct without them.
    try {
      await linkPublishedPrediction(outcome.predictionId, candidate.normalized_claim, candidate.resolution_criteria, candidate.category, candidate.resolution_date, outcome.predictionDate!, { linkMarkets: input.captureMode === "live" });
    } catch (error) {
      console.warn(`Published ${outcome.predictionId}, but linking topics/markets failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
    }
    return { kind: "published", predictionId: outcome.predictionId };
  }
  return outcome;
}
