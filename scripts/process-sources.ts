import "dotenv/config";
import pLimit from "p-limit";
import { getDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { EXTRACTION_SCHEMA_VERSION, VERIFIER_SCHEMA_VERSION } from "@/lib/constants";
import { scorePredictionHeuristic } from "@/lib/predictions/heuristics";
import { extractPredictions } from "@/lib/ai/extractPrediction";
import { verifyPrediction } from "@/lib/ai/verifyPrediction";
import { validateExtractedPrediction } from "@/lib/predictions/validation";
import { canAutoPublish } from "@/lib/predictions/promotion";
import { isLikelyDuplicate } from "@/lib/predictions/dedupe";
import { predictionFingerprint } from "@/lib/predictions/fingerprint";
import { verifyMarketMatch } from "@/lib/ai/matchMarket";
import { canCreateMarketLink } from "@/lib/matching/markets";

type SourceRow = { id: string; exact_text: string; published_at: string; content_hash: string; expert_id: string; display_name: string; x_handle: string };

export type ProcessingSummary = { examined: number; rejectedByHeuristic: number; aiPredictions: number; verifierRejected: number; published: number; duplicates: number; errors: number };

async function linkPublishedPrediction(predictionId: string, claim: string, resolutionCriteria: string, category: string, resolutionDate: string | null, predictionDate: string) {
  const sql = getDatabase();
  const topics = await sql<{ id: string; score: number }[]>`
    select id, similarity(title, ${claim}) as score from public.topics
    where category_slug = ${category} and status = 'active' and similarity(title, ${claim}) >= 0.45
    order by score desc limit 3
  `;
  for (const topic of topics) await sql`insert into public.prediction_topics (prediction_id, topic_id, relevance_score) values (${predictionId}, ${topic.id}, ${topic.score}) on conflict do nothing`;

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

export async function processSources(): Promise<ProcessingSummary> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured. AI extraction was skipped.");
  const sql = getDatabase();
  const sources = await sql<SourceRow[]>`
    select s.id, s.exact_text, s.published_at::text, s.content_hash, e.id as expert_id, e.display_name, e.x_handle
    from public.sources s join public.experts e on lower(e.x_handle) = lower(s.author_handle)
    where s.source_type = 'x' and s.exact_text is not null and s.deleted_at is null
      and e.source_status = 'verified'
      and not exists (
        select 1 from public.prediction_candidates pc
        where pc.source_id = s.id and pc.model_name = ${env.OPENAI_MODEL}
          and pc.raw_extraction ->> 'extraction_schema_version' = ${EXTRACTION_SCHEMA_VERSION}
      )
    order by s.published_at asc limit ${env.SEED_MAX_OPENAI_ITEMS}
  `;
  const summary: ProcessingSummary = { examined: sources.length, rejectedByHeuristic: 0, aiPredictions: 0, verifierRejected: 0, published: 0, duplicates: 0, errors: 0 };
  const limit = pLimit(env.SEED_CONCURRENCY);
  await Promise.all(sources.map((source) => limit(async () => {
    try {
      const heuristic = scorePredictionHeuristic(source.exact_text);
      if (!heuristic.shouldExtract) {
        summary.rejectedByHeuristic += 1;
        await sql`insert into public.prediction_candidates (source_id, expert_id, status, reason_rejected, model_name, raw_extraction) values (${source.id}, ${source.expert_id}, 'rejected', 'heuristic_filter', ${env.OPENAI_MODEL}, ${sql.json({ heuristic, extraction_schema_version: EXTRACTION_SCHEMA_VERSION })})`;
        return;
      }
      const extraction = await extractPredictions({ sourceText: source.exact_text, sourceTimestamp: source.published_at, authorName: source.display_name, authorHandle: source.x_handle });
      if (!extraction.result.source_is_usable || !extraction.result.speaker_is_author || extraction.result.predictions.length === 0) {
        await sql`insert into public.prediction_candidates (source_id, expert_id, status, reason_rejected, model_name, raw_extraction) values (${source.id}, ${source.expert_id}, 'rejected', ${extraction.result.reason_rejected ?? "not_prediction"}, ${extraction.model}, ${sql.json({ extraction: extraction.result, extraction_schema_version: EXTRACTION_SCHEMA_VERSION })})`;
        return;
      }
      summary.aiPredictions += extraction.result.predictions.length;
      for (const candidate of extraction.result.predictions) {
        const deterministic = validateExtractedPrediction(source.exact_text, source.published_at, candidate);
        const verification = deterministic.valid ? await verifyPrediction({ sourceText: source.exact_text, sourceTimestamp: source.published_at, authorName: source.display_name, candidate }) : null;
        if (!verification || verification.result.verdict !== "faithful") summary.verifierRejected += 1;
        const existing = await sql<{ expert_id: string; normalized_claim: string; resolution_date: string | null }[]>`
          select expert_id, normalized_claim, resolution_date::text from public.predictions
          where expert_id = ${source.expert_id} and published_at is not null order by prediction_date asc
        `;
        const recordType = candidate.record_type ?? "prediction";
        const imputationNote = candidate.imputation_note ?? null;
        const duplicate = existing.some((item) => isLikelyDuplicate({ expertId: source.expert_id, claim: candidate.normalized_claim, resolutionDate: candidate.resolution_date }, { expertId: item.expert_id, claim: item.normalized_claim, resolutionDate: item.resolution_date }));
        // Takes NEVER auto-publish — they always route to admin review so a
        // human can eyeball the imputation before it goes live. Predictions
        // (hard) go through the existing threshold gate.
        const publish = recordType === "prediction"
          && !duplicate
          && deterministic.valid
          && canAutoPublish({ sourceIsUsable: extraction.result.source_is_usable, speakerIsAuthor: extraction.result.speaker_is_author, extractionConfidence: candidate.extraction_confidence, sourceFidelityScore: candidate.source_fidelity_score, falsifiabilityScore: candidate.falsifiability_score, verifierVerdict: verification?.result.verdict ?? null, verifierConfidence: verification?.result.confidence ?? null, sourceQuoteLiteral: deterministic.valid, hasResolutionCriteria: Boolean(candidate.resolution_criteria), hasResolutionDate: Boolean(candidate.resolution_date) });
        const status = duplicate ? "duplicate" : publish ? "auto_verified" : deterministic.valid ? "review" : "rejected";
        const [storedCandidate] = await sql<{ id: string }[]>`
          insert into public.prediction_candidates (source_id, expert_id, normalized_claim, source_quote, resolution_date, resolution_criteria,
            explicit_probability, confidence_language, category_slug, extraction_confidence, falsifiability_score, source_fidelity_score,
            verifier_verdict, verifier_confidence, status, reason_rejected, model_name, raw_extraction,
            record_type, imputation_note)
          values (${source.id}, ${source.expert_id}, ${candidate.normalized_claim}, ${candidate.source_quote}, ${candidate.resolution_date}, ${candidate.resolution_criteria},
            ${candidate.explicit_probability}, ${candidate.confidence_language}, ${candidate.category}, ${candidate.extraction_confidence}, ${candidate.falsifiability_score}, ${candidate.source_fidelity_score},
            ${verification?.result.verdict ?? null}, ${verification?.result.confidence ?? null}, ${status}, ${duplicate ? "semantic_duplicate" : deterministic.errors.join(",") || verification?.result.reason || null}, ${extraction.model},
            ${sql.json({ extraction: extraction.result, verifier: verification?.result, extraction_schema_version: EXTRACTION_SCHEMA_VERSION, verifier_schema_version: VERIFIER_SCHEMA_VERSION, content_hash: source.content_hash })},
            ${recordType}, ${imputationNote})
          returning id
        `;
        if (duplicate) {
          summary.duplicates += 1;
          await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction_candidate', ${storedCandidate.id}, 'duplicate_merged', 'system', ${sql.json({ source_id: source.id })}, 'Likely semantic duplicate of an earlier qualifying statement.')`;
          continue;
        }
        if (publish && candidate.resolution_date) {
          const fingerprint = predictionFingerprint({ expertId: source.expert_id, sourceId: source.id, normalizedClaim: candidate.normalized_claim, predictionDate: source.published_at, resolutionDate: candidate.resolution_date, resolutionCriteria: candidate.resolution_criteria, explicitProbability: candidate.explicit_probability });
          const [prediction] = await sql<{ id: string }[]>`
            insert into public.predictions (expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
              resolution_date, resolution_criteria, explicit_probability, confidence_language, falsifiability_score, verification_mode,
              status, fingerprint_sha256, published_at, frozen_at)
            values (${source.expert_id}, ${source.id}, ${candidate.category}, ${candidate.normalized_claim}, ${candidate.source_quote}, ${source.published_at},
              ${candidate.resolution_date}, ${candidate.resolution_criteria}, ${candidate.explicit_probability}, ${candidate.confidence_language}, ${candidate.falsifiability_score}, 'auto',
              ${new Date(candidate.resolution_date) <= new Date() ? "due" : "open"}, ${fingerprint}, now(), now())
            on conflict (fingerprint_sha256) do update set updated_at = public.predictions.updated_at
            returning id
          `;
          summary.published += 1;
          await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction', ${prediction.id}, 'prediction_auto_verified', 'system', ${sql.json({ candidate_id: storedCandidate.id, fingerprint })}, 'Passed extraction, deterministic validation, and independent verifier thresholds.')`;
          await linkPublishedPrediction(prediction.id, candidate.normalized_claim, candidate.resolution_criteria, candidate.category, candidate.resolution_date, source.published_at);
        }
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`Processing source ${source.id} failed:`, error instanceof Error ? error.message : "unknown");
    }
  })));
  return summary;
}
