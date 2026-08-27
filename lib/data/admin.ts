import "server-only";

import { cache } from "react";
import { assertAdmin } from "@/lib/auth/admin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const first = (value: unknown): Row => object(Array.isArray(value) ? value[0] : value);
const text = (value: unknown) => typeof value === "string" ? value : null;
const num = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && Number.isFinite(Number(value)) ? Number(value) : null;

export const getAdminDashboard = cache(async () => {
  await assertAdmin();
  const admin = createAdminSupabaseClient();
  const staleDate = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const results = await Promise.all([
    admin.from("predictions").select("id", { count: "exact", head: true }).not("published_at", "is", null),
    admin.from("prediction_candidates").select("id", { count: "exact", head: true }).in("status", ["pending", "review"]),
    admin.from("predictions").select("id", { count: "exact", head: true }).in("status", ["due", "resolution_pending"]),
    admin.from("sources").select("id", { count: "exact", head: true }).or(`last_verified_at.is.null,last_verified_at.lt.${staleDate}`),
    admin.from("prediction_candidates").select("id", { count: "exact", head: true }),
    admin.from("prediction_candidates").select("id", { count: "exact", head: true }).neq("verifier_verdict", "faithful"),
    admin.from("prediction_candidates").select("id", { count: "exact", head: true }).eq("status", "duplicate"),
    admin.from("resolutions").select("id", { count: "exact", head: true }).eq("outcome", "ambiguous"),
    admin.from("expert_scorecards").select("expert_id", { count: "exact", head: true }).lt("total_predictions", 3),
    admin.from("expert_scorecards").select("expert_id", { count: "exact", head: true }).eq("leaderboard_eligible", true),
  ]);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  const [published, pending, backlog, staleSources, candidatesTotal, verifierRejected, duplicates, ambiguous, expertsUnder3, eligibleExperts] = results.map((result) => result.count ?? 0);
  return {
    published, pending, backlog, staleSources, expertsUnder3, eligibleExperts,
    extractionAcceptanceRate: candidatesTotal ? published / candidatesTotal : null,
    verifierRejectionRate: candidatesTotal ? verifierRejected / candidatesTotal : null,
    duplicateRate: candidatesTotal ? duplicates / candidatesTotal : null,
    ambiguousResolutionRate: published ? ambiguous / published : null,
  };
});

export const getAdminCandidates = cache(async () => {
  await assertAdmin();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("prediction_candidates").select("id, normalized_claim, source_quote, resolution_date, resolution_criteria, explicit_probability, confidence_language, category_slug, extraction_confidence, falsifiability_score, source_fidelity_score, verifier_verdict, verifier_confidence, status, reason_rejected, created_at, experts(id, display_name, x_handle), sources(id, source_type, exact_text, canonical_path, published_at, deleted_at)").in("status", ["pending", "review", "auto_verified"]).order("created_at", { ascending: true }).limit(100);
  if (error) throw error;
  return (data ?? []).map((raw) => {
    const row = object(raw); const expert = first(row.experts); const source = first(row.sources);
    return {
      id: String(row.id), normalizedClaim: text(row.normalized_claim), sourceQuote: text(row.source_quote),
      resolutionDate: text(row.resolution_date), resolutionCriteria: text(row.resolution_criteria),
      explicitProbability: num(row.explicit_probability), confidenceLanguage: text(row.confidence_language),
      categorySlug: text(row.category_slug), extractionConfidence: num(row.extraction_confidence),
      falsifiabilityScore: num(row.falsifiability_score), sourceFidelityScore: num(row.source_fidelity_score),
      verifierVerdict: text(row.verifier_verdict), verifierConfidence: num(row.verifier_confidence), status: String(row.status),
      reasonRejected: text(row.reason_rejected), createdAt: String(row.created_at),
      expert: { id: String(expert.id), displayName: String(expert.display_name), xHandle: text(expert.x_handle) },
      source: { id: String(source.id), sourceType: String(source.source_type), exactText: text(source.exact_text), canonicalPath: text(source.canonical_path), publishedAt: String(source.published_at), deletedAt: text(source.deleted_at) },
    };
  });
});

export const getAdminResolutionQueue = cache(async () => {
  await assertAdmin();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("predictions").select("id, normalized_claim, resolution_criteria, resolution_date, status, experts(display_name), resolutions(id, outcome, explanation, resolution_confidence, resolution_method, scoring_eligible, resolved_at, approved_at, resolution_evidence(*))").in("status", ["due", "resolution_pending"]).order("resolution_date", { ascending: true }).limit(100);
  if (error) throw error;
  return (data ?? []).map((raw) => {
    const row = object(raw); const expert = first(row.experts); const resolution = first(row.resolutions);
    return {
      id: String(row.id), normalizedClaim: String(row.normalized_claim), resolutionCriteria: String(row.resolution_criteria), resolutionDate: text(row.resolution_date), status: String(row.status), expertName: String(expert.display_name ?? "Unknown"),
      proposal: resolution.id ? { id: String(resolution.id), outcome: String(resolution.outcome), explanation: String(resolution.explanation), confidence: num(resolution.resolution_confidence), method: String(resolution.resolution_method), scoringEligible: resolution.scoring_eligible === true, approvedAt: text(resolution.approved_at), evidence: Array.isArray(resolution.resolution_evidence) ? resolution.resolution_evidence.map(object) : [] } : null,
    };
  });
});

export const getAdminIngestion = cache(async () => {
  await assertAdmin();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("ingestion_runs").select("id, source_type, job_type, status, started_at, finished_at, items_requested, items_fetched, items_created, items_rejected, errors, metadata").order("started_at", { ascending: false }).limit(40);
  if (error) throw error;
  return (data ?? []).map((raw) => object(raw));
});

export const getAdminExperts = cache(async () => {
  await assertAdmin();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("experts").select("id, slug, display_name, x_handle, x_user_id, source_status, primary_category_slug, is_active, expert_scorecards(total_predictions, resolved_predictions, leaderboard_eligible)").order("display_name");
  if (error) throw error;
  return (data ?? []).map((raw) => object(raw));
});
