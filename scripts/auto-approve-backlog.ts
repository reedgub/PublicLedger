// One-off: run the LLM auto-approver against every candidate currently in
// status='review'. Publishes approvals into public.predictions, marks
// rejections as 'rejected' with reason, writes audit_log rows for both.
// Idempotent — re-running just processes any new review-queue items.

import "dotenv/config";
import { createHash } from "node:crypto";
import { closeDatabase, getDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { applyAutoApprovalDecision, judgeCandidate } from "@/lib/ai/autoApprove";
import { predictionFingerprint } from "@/lib/predictions/fingerprint";

type CandidateRow = {
  id: string;
  source_id: string;
  expert_id: string;
  normalized_claim: string;
  source_quote: string;
  resolution_date: string;
  resolution_criteria: string;
  category_slug: string;
  explicit_probability: number | null;
  confidence_language: string | null;
  falsifiability_score: number;
  verifier_verdict: string | null;
  verifier_confidence: number | null;
  verifier_reason: string | null;
  record_type: string;
  imputation_note: string | null;
  source_exact_text: string;
  source_published_at: string;
  expert_display_name: string;
  expert_x_handle: string | null;
};

async function main() {
  if (env.AUTO_APPROVE_MODE !== "on") {
    console.log(JSON.stringify({ stage: "auto_approve_disabled", note: "Set AUTO_APPROVE_MODE=on to run." }));
    return;
  }
  const sql = getDatabase();
  const rows = await sql<CandidateRow[]>`
    select pc.id, pc.source_id, pc.expert_id,
           pc.normalized_claim, pc.source_quote,
           pc.resolution_date::text as resolution_date,
           pc.resolution_criteria, pc.category_slug,
           pc.explicit_probability, pc.confidence_language,
           pc.falsifiability_score::float as falsifiability_score,
           pc.verifier_verdict, pc.verifier_confidence,
           (pc.raw_extraction #>> '{verifier,reason}') as verifier_reason,
           pc.record_type, pc.imputation_note,
           s.exact_text as source_exact_text,
           s.published_at::text as source_published_at,
           e.display_name as expert_display_name,
           e.x_handle as expert_x_handle
    from public.prediction_candidates pc
    join public.sources s on s.id = pc.source_id
    join public.experts e on e.id = pc.expert_id
    where pc.status = 'review'
      and pc.resolution_date is not null
    order by pc.created_at asc
  `;
  console.log(JSON.stringify({ stage: "auto_approve_start", count: rows.length }));

  let approved = 0;
  let rejected = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const judgment = await judgeCandidate({
        sourceText: row.source_exact_text,
        sourceTimestamp: row.source_published_at,
        authorName: row.expert_display_name,
        authorHandle: row.expert_x_handle,
        normalizedClaim: row.normalized_claim,
        sourceQuote: row.source_quote,
        resolutionDate: row.resolution_date,
        resolutionCriteria: row.resolution_criteria,
        recordType: row.record_type === "take" ? "take" : "prediction",
        imputationNote: row.imputation_note,
        verifierVerdict: row.verifier_verdict,
        verifierConfidence: row.verifier_confidence,
        verifierReason: row.verifier_reason,
      });
      const decision = applyAutoApprovalDecision(judgment);
      if (decision.action === "reject") {
        rejected += 1;
        await sql`update public.prediction_candidates set status = 'rejected', reason_rejected = ${`Auto-reject: ${decision.reason}`} where id = ${row.id}`;
        await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction_candidate', ${row.id}, 'prediction_rejected', 'system', ${sql.json({ judge_confidence: decision.judgeConfidence, record_type: row.record_type })}, ${`Auto-reject: ${decision.reason}`})`;
        continue;
      }
      approved += 1;
      const fingerprint = predictionFingerprint({
        expertId: row.expert_id, sourceId: row.source_id,
        normalizedClaim: row.normalized_claim,
        predictionDate: row.source_published_at,
        resolutionDate: row.resolution_date,
        resolutionCriteria: row.resolution_criteria,
        explicitProbability: row.explicit_probability,
      });
      const verificationMode = decision.lowConfidence ? "auto_low_confidence" : "auto";
      const status = new Date(row.resolution_date) <= new Date() ? "due" : "open";
      const [prediction] = await sql<{ id: string }[]>`
        insert into public.predictions
          (expert_id, source_id, category_slug, normalized_claim, source_quote, prediction_date,
           resolution_date, resolution_criteria, explicit_probability, confidence_language,
           falsifiability_score, verification_mode, status, fingerprint_sha256,
           published_at, frozen_at, record_type, imputation_note)
        values (${row.expert_id}, ${row.source_id}, ${row.category_slug}, ${row.normalized_claim},
          ${row.source_quote}, ${row.source_published_at}, ${row.resolution_date}, ${row.resolution_criteria},
          ${row.explicit_probability}, ${row.confidence_language}, ${row.falsifiability_score},
          ${verificationMode}, ${status}, ${fingerprint}, now(), now(),
          ${row.record_type}, ${row.record_type === "take" ? row.imputation_note : null})
        on conflict (fingerprint_sha256) do update set updated_at = public.predictions.updated_at
        returning id
      `;
      await sql`update public.prediction_candidates set status = 'approved' where id = ${row.id}`;
      await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction', ${prediction.id}, 'prediction_auto_approved', 'system', ${sql.json({ candidate_id: row.id, fingerprint, record_type: row.record_type, low_confidence: decision.lowConfidence })}, ${decision.reason})`;
    } catch (error) {
      errors += 1;
      console.error(`Auto-approve failed for candidate ${row.id}: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  console.log(JSON.stringify({ stage: "auto_approve_summary", examined: rows.length, approved, rejected, errors }));
  // Suppress unused-import warning; hash is only used in the alternate flow.
  void createHash;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
