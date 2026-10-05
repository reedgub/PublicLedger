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
import { linkPublishedPrediction } from "@/lib/pipeline/publish";
import { applyAutoApprovalDecision, judgeCandidate } from "@/lib/ai/autoApprove";
import { revalidateLive } from "@/lib/http/revalidate";

type SourceRow = { id: string; exact_text: string; published_at: string; content_hash: string; expert_id: string; display_name: string; x_handle: string };

export type ProcessingSummary = { examined: number; rejectedByHeuristic: number; aiPredictions: number; verifierRejected: number; autoApproved: number; autoRejected: number; autoApproverErrors: number; published: number; duplicates: number; errors: number };

export async function processSources(): Promise<ProcessingSummary> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured. AI extraction was skipped.");
  const sql = getDatabase();
  // Substack sources come through the admin-run `pnpm seed:substack` script,
  // one publication at a time, so the identity guarantee is stronger than X's
  // per-post oEmbed check — no need to gate them on e.source_status='verified'.
  // Everything downstream (heuristic, extractor, verifier, auto-approver,
  // duplicate check) is source-type-agnostic and still runs.
  const sources = await sql<SourceRow[]>`
    select s.id, s.exact_text, s.published_at::text, s.content_hash, e.id as expert_id, e.display_name, e.x_handle
    from public.sources s join public.experts e on lower(e.x_handle) = lower(s.author_handle)
    where s.source_type in ('x', 'substack')
      and s.exact_text is not null
      and s.deleted_at is null
      and (s.source_type = 'substack' or e.source_status = 'verified')
      -- Sources the cascade has screened or claimed are not processed twice.
      and s.screen_status = 'pending'
      and not exists (
        select 1 from public.prediction_candidates pc
        where pc.source_id = s.id and pc.model_name = ${env.OPENAI_MODEL}
          and pc.raw_extraction ->> 'extraction_schema_version' = ${EXTRACTION_SCHEMA_VERSION}
      )
    order by s.published_at asc limit ${env.SEED_MAX_OPENAI_ITEMS}
  `;
  const summary: ProcessingSummary = { examined: sources.length, rejectedByHeuristic: 0, aiPredictions: 0, verifierRejected: 0, autoApproved: 0, autoRejected: 0, autoApproverErrors: 0, published: 0, duplicates: 0, errors: 0 };
  const limit = pLimit(env.SEED_CONCURRENCY);
  await Promise.all(sources.map((source) => limit(async () => {
    // Claim the source for the legacy path so the cascade skips it.
    await sql`update public.sources set screen_status = 'extracted', screen_model = 'legacy', screened_at = now() where id = ${source.id}`;
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
      // Intra-source dedupe: if the model returned both a hard prediction and
      // a soft take of essentially the same claim from one source, drop the
      // take. Predictions are stronger evidence and enter scoring; keeping the
      // take alongside just clutters the review queue.
      const hardClaims = extraction.result.predictions.filter((p) => (p.record_type ?? "prediction") === "prediction");
      const dedupedCandidates = extraction.result.predictions.filter((candidate) => {
        if ((candidate.record_type ?? "prediction") !== "take") return true;
        return !hardClaims.some((hard) =>
          isLikelyDuplicate(
            { expertId: source.expert_id, claim: candidate.normalized_claim, resolutionDate: candidate.resolution_date },
            { expertId: source.expert_id, claim: hard.normalized_claim, resolutionDate: hard.resolution_date },
          ),
        );
      });
      summary.aiPredictions += dedupedCandidates.length;
      for (const candidate of dedupedCandidates) {
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
        // Auto-approver: LLM-as-judge second pass. If the strict `canAutoPublish`
        // gate sent this to human review (which it will for most candidates and
        // for every take), ask the judge whether an editorial reviewer would
        // approve. On approve we route to the publish path below with
        // verification_mode='auto'; on reject we flip the stored candidate to
        // 'rejected'. Every judge decision is written to audit_log with the
        // full reason so it can be spot-checked and reversed.
        let autoApproved = false;
        let autoApprovedLowConfidence = false;
        if (env.AUTO_APPROVE_MODE === "on" && status === "review" && candidate.resolution_date) {
          try {
            const judgment = await judgeCandidate({
              sourceText: source.exact_text,
              sourceTimestamp: source.published_at,
              authorName: source.display_name,
              authorHandle: source.x_handle,
              normalizedClaim: candidate.normalized_claim,
              sourceQuote: candidate.source_quote,
              resolutionDate: candidate.resolution_date,
              resolutionCriteria: candidate.resolution_criteria,
              recordType: recordType as "prediction" | "take",
              imputationNote,
              verifierVerdict: verification?.result.verdict ?? null,
              verifierConfidence: verification?.result.confidence ?? null,
              verifierReason: verification?.result.reason ?? null,
            });
            const decision = applyAutoApprovalDecision(judgment);
            if (decision.action === "approve") {
              autoApproved = true;
              autoApprovedLowConfidence = decision.lowConfidence;
              summary.autoApproved += 1;
              await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction_candidate', ${storedCandidate.id}, 'prediction_auto_approved', 'system', ${sql.json({ judge_confidence: decision.judgeConfidence, low_confidence: decision.lowConfidence, record_type: recordType })}, ${decision.reason})`;
            } else {
              summary.autoRejected += 1;
              await sql`update public.prediction_candidates set status = 'rejected', reason_rejected = ${`Auto-reject: ${decision.reason}`} where id = ${storedCandidate.id}`;
              await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction_candidate', ${storedCandidate.id}, 'prediction_rejected', 'system', ${sql.json({ judge_confidence: decision.judgeConfidence, record_type: recordType })}, ${`Auto-reject: ${decision.reason}`})`;
              continue;
            }
          } catch (error) {
            summary.autoApproverErrors += 1;
            const message = error instanceof Error ? error.message : "unknown error";
            console.error(`Auto-approver failed for candidate ${storedCandidate.id}: ${message}`);
            await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction_candidate', ${storedCandidate.id}, 'auto_approver_error', 'system', ${sql.json({ record_type: recordType })}, ${message})`;
            // Leave the candidate in 'review' for human triage — fail closed, not open.
          }
        }
        const shouldPublish = (publish || autoApproved) && !!candidate.resolution_date;
        if (shouldPublish) {
          const fingerprint = predictionFingerprint({ expertId: source.expert_id, sourceId: source.id, normalizedClaim: candidate.normalized_claim, predictionDate: source.published_at, resolutionDate: candidate.resolution_date, resolutionCriteria: candidate.resolution_criteria, explicitProbability: candidate.explicit_probability });
          const verificationMode = autoApprovedLowConfidence ? "auto_low_confidence" : "auto";
          const [prediction] = await sql<{ id: string }[]>`
            insert into public.predictions (expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
              resolution_date, resolution_criteria, explicit_probability, confidence_language, falsifiability_score, verification_mode,
              status, fingerprint_sha256, published_at, frozen_at, record_type, imputation_note)
            values (${source.expert_id}, ${source.id}, ${candidate.category}, ${candidate.normalized_claim}, ${candidate.source_quote}, ${source.published_at},
              ${candidate.resolution_date}, ${candidate.resolution_criteria}, ${candidate.explicit_probability}, ${candidate.confidence_language}, ${candidate.falsifiability_score}, ${verificationMode},
              ${new Date(candidate.resolution_date!) <= new Date() ? "due" : "open"}, ${fingerprint}, now(), now(),
              ${recordType}, ${recordType === "take" ? imputationNote : null})
            on conflict (fingerprint_sha256) do update set updated_at = public.predictions.updated_at
            returning id
          `;
          summary.published += 1;
          await sql`update public.prediction_candidates set status = 'approved' where id = ${storedCandidate.id}`;
          const auditAction = autoApproved ? "prediction_auto_approved" : "prediction_auto_verified";
          const auditReason = autoApproved
            ? "Auto-approver LLM judged the candidate ready for public display."
            : "Passed extraction, deterministic validation, and independent verifier thresholds.";
          await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction', ${prediction.id}, ${auditAction}, 'system', ${sql.json({ candidate_id: storedCandidate.id, fingerprint, record_type: recordType, low_confidence: autoApprovedLowConfidence })}, ${auditReason})`;
          await linkPublishedPrediction(prediction.id, candidate.normalized_claim, candidate.resolution_criteria, candidate.category, candidate.resolution_date, source.published_at);
        }
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`Processing source ${source.id} failed:`, error instanceof Error ? error.message : "unknown");
    }
  })));
  if (summary.published > 0) {
    await revalidateLive(["/", "/leaderboard"]);
  }
  return summary;
}
