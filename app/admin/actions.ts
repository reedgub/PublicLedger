"use server";

import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdmin } from "@/lib/auth/admin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CATEGORY_SLUGS } from "@/lib/constants";
import { predictionFingerprint } from "@/lib/predictions/fingerprint";
import { assertResolutionScoring } from "@/lib/resolution/scoring";
import { fetchPolymarketMarkets } from "@/lib/sources/polymarket";

const candidateSchema = z.object({
  candidateId: z.string().uuid(),
  decision: z.enum(["approve", "reject", "duplicate"]),
  normalizedClaim: z.string().trim().min(1).max(1000),
  sourceQuote: z.string().trim().min(1).max(2000),
  resolutionDate: z.string().min(1).transform((value) => {
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00Z` : value;
    return new Date(normalized);
  }).refine((value) => !Number.isNaN(value.getTime()), "Enter a valid UTC deadline").transform((value) => value.toISOString()),
  resolutionCriteria: z.string().trim().min(1).max(4000),
  categorySlug: z.enum(CATEGORY_SLUGS),
  reason: z.string().trim().min(3).max(1000),
});

export async function moderateCandidateAction(formData: FormData) {
  const session = await assertAdmin();
  const parsed = candidateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid moderation input");
  const admin = createAdminSupabaseClient();
  const { data: candidate, error } = await admin.from("prediction_candidates").select("*, sources(id, exact_text, published_at, deleted_at)").eq("id", parsed.data.candidateId).single();
  if (error || !candidate) throw new Error("Candidate not found");
  const source = Array.isArray(candidate.sources) ? candidate.sources[0] : candidate.sources;
  if (!source) throw new Error("Candidate source not found");
  const before = { normalized_claim: candidate.normalized_claim, source_quote: candidate.source_quote, resolution_date: candidate.resolution_date, resolution_criteria: candidate.resolution_criteria, category_slug: candidate.category_slug, status: candidate.status };
  if (parsed.data.decision !== "approve") {
    const status = parsed.data.decision === "duplicate" ? "duplicate" : "rejected";
    const { error: updateError } = await admin.from("prediction_candidates").update({ status, reason_rejected: parsed.data.reason }).eq("id", candidate.id);
    if (updateError) throw updateError;
    await admin.from("audit_log").insert({ entity_type: "prediction_candidate", entity_id: candidate.id, action: parsed.data.decision === "duplicate" ? "duplicate_merged" : "prediction_rejected", actor_type: "admin", actor_id: session.userId, before, after: { status }, reason: parsed.data.reason });
  } else {
    if (source.deleted_at) throw new Error("Unavailable sources cannot be published");
    if (!source.exact_text?.includes(parsed.data.sourceQuote)) throw new Error("Source quote must remain an exact contiguous substring");
    const fingerprint = predictionFingerprint({ expertId: candidate.expert_id, sourceId: candidate.source_id, normalizedClaim: parsed.data.normalizedClaim, predictionDate: source.published_at, resolutionDate: parsed.data.resolutionDate, resolutionCriteria: parsed.data.resolutionCriteria, explicitProbability: candidate.explicit_probability });
    const publishedAt = new Date().toISOString();
    const { data: prediction, error: predictionError } = await admin.from("predictions").upsert({
      expert_id: candidate.expert_id, source_id: candidate.source_id, category_slug: parsed.data.categorySlug,
      normalized_claim: parsed.data.normalizedClaim, source_quote: parsed.data.sourceQuote,
      prediction_date: source.published_at, resolution_date: parsed.data.resolutionDate,
      resolution_criteria: parsed.data.resolutionCriteria, explicit_probability: candidate.explicit_probability,
      confidence_language: candidate.confidence_language, falsifiability_score: candidate.falsifiability_score,
      verification_mode: "admin", status: new Date(parsed.data.resolutionDate) <= new Date() ? "due" : "open",
      fingerprint_sha256: fingerprint, published_at: publishedAt, frozen_at: publishedAt,
    }, { onConflict: "fingerprint_sha256" }).select("id").single();
    if (predictionError) throw predictionError;
    const after = { normalized_claim: parsed.data.normalizedClaim, source_quote: parsed.data.sourceQuote, resolution_date: parsed.data.resolutionDate, resolution_criteria: parsed.data.resolutionCriteria, category_slug: parsed.data.categorySlug, status: "approved" };
    await admin.from("prediction_candidates").update({ ...after, status: "approved" }).eq("id", candidate.id);
    await admin.from("audit_log").insert({ entity_type: "prediction", entity_id: prediction.id, action: "prediction_admin_approved", actor_type: "admin", actor_id: session.userId, before, after: { ...after, fingerprint }, reason: parsed.data.reason });
  }
  revalidatePath("/admin/candidates"); revalidatePath("/");
}

const resolutionSchema = z.object({
  predictionId: z.string().uuid(), resolutionId: z.string().uuid().or(z.literal("")).optional().default(""),
  decision: z.enum(["approve", "reject", "ambiguous", "void", "rerun"]),
  explanation: z.string().trim().min(5).max(4000), confirmation: z.literal("on"),
});

export async function moderateResolutionAction(formData: FormData) {
  const session = await assertAdmin();
  const parsed = resolutionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid resolution action");
  const admin = createAdminSupabaseClient();
  const { data: prediction, error } = await admin.from("predictions").select("id, status").eq("id", parsed.data.predictionId).single();
  if (error || !prediction) throw new Error("Prediction not found");
  if (parsed.data.decision === "rerun" || parsed.data.decision === "reject") {
    await admin.from("predictions").update({ status: "resolution_pending" }).eq("id", prediction.id);
    await admin.from("audit_log").insert({ entity_type: "prediction", entity_id: prediction.id, action: parsed.data.decision === "rerun" ? "resolution_proposed" : "resolution_changed", actor_type: "admin", actor_id: session.userId, before: { status: prediction.status }, after: { status: "resolution_pending" }, reason: parsed.data.explanation });
  } else {
    const existing = parsed.data.resolutionId ? await admin.from("resolutions").select("*").eq("id", parsed.data.resolutionId).single() : { data: null, error: null };
    const outcome = parsed.data.decision === "approve" ? existing.data?.outcome : parsed.data.decision;
    if (!outcome) throw new Error("No proposed outcome exists to approve");
    const scoringEligible = outcome === "correct" || outcome === "incorrect";
    assertResolutionScoring(outcome, scoringEligible);
    const approvedAt = new Date().toISOString();
    const payload = { prediction_id: prediction.id, outcome, explanation: parsed.data.decision === "approve" ? existing.data?.explanation ?? parsed.data.explanation : parsed.data.explanation, resolution_confidence: existing.data?.resolution_confidence ?? null, resolution_method: parsed.data.decision === "approve" ? existing.data?.resolution_method ?? "admin" : "admin", scoring_eligible: scoringEligible, resolved_at: existing.data?.resolved_at ?? approvedAt, approved_at: approvedAt };
    const { error: resolutionError } = await admin.from("resolutions").upsert(payload, { onConflict: "prediction_id" });
    if (resolutionError) throw resolutionError;
    await admin.from("predictions").update({ status: outcome === "ambiguous" ? "ambiguous" : outcome === "void" ? "void" : "resolved" }).eq("id", prediction.id);
    await admin.from("audit_log").insert({ entity_type: "prediction", entity_id: prediction.id, action: "resolution_approved", actor_type: "admin", actor_id: session.userId, before: existing.data, after: payload, reason: parsed.data.explanation });
  }
  revalidatePath("/admin/resolutions"); revalidatePath("/");
}

export async function syncPolymarketAction() {
  const session = await assertAdmin();
  const admin = createAdminSupabaseClient();
  const startedAt = new Date().toISOString();
  const { data: run } = await admin.from("ingestion_runs").insert({ source_type: "polymarket", job_type: "admin_sync", status: "running", started_at: startedAt, metadata: { actor_id: session.userId } }).select("id").single();
  try {
    const result = await fetchPolymarketMarkets();
    const markets = [...result.active, ...result.closed];
    const { error } = await admin.from("markets").upsert(markets.map((market) => ({ provider: market.provider, provider_market_id: market.providerMarketId, provider_slug: market.providerSlug, question: market.question, description: market.description, end_at: market.endAt, active: market.active, closed: market.closed, volume: market.volume, liquidity: market.liquidity, yes_probability: market.yesProbability, no_probability: market.noProbability, fetched_at: market.fetchedAt, raw: {} })), { onConflict: "provider,provider_market_id" });
    if (error) throw error;
    if (run) await admin.from("ingestion_runs").update({ status: "succeeded", finished_at: new Date().toISOString(), items_requested: 500, items_fetched: markets.length, items_created: markets.length }).eq("id", run.id);
  } catch (error) {
    if (run) await admin.from("ingestion_runs").update({ status: "failed", finished_at: new Date().toISOString(), errors: 1, metadata: { actor_id: session.userId, error: error instanceof Error ? error.message : "unknown" } }).eq("id", run.id);
    throw error;
  }
  revalidatePath("/admin/ingestion"); revalidatePath("/");
}

export async function signOutAction() {
  const client = await createServerSupabaseClient();
  if (client) await client.auth.signOut();
  redirect("/admin/login");
}
