import { createHash } from "node:crypto";
import { z } from "zod";
import { EXTRACTION_SCHEMA_VERSION, VERIFIER_SCHEMA_VERSION } from "@/lib/constants";
import { env, integrations } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { parseSafePublicUrl, parseXPostUrl } from "@/lib/security/urls";
import { fetchXPostById } from "@/lib/sources/x";
import { scorePredictionHeuristic } from "@/lib/predictions/heuristics";
import { extractPredictions } from "@/lib/ai/extractPrediction";
import { verifyPrediction } from "@/lib/ai/verifyPrediction";
import { validateExtractedPrediction } from "@/lib/predictions/validation";
import { canAutoPublish } from "@/lib/predictions/promotion";
import { predictionFingerprint } from "@/lib/predictions/fingerprint";

const predictionSubmission = z.object({
  type: z.literal("prediction"),
  sourceUrl: z.string().max(2048),
  expertName: z.string().max(160).optional().default(""),
  category: z.string().max(80).optional().default(""),
  email: z.string().email().max(254).or(z.literal("")).optional().default(""),
  company: z.string().max(200).optional().default(""),
});

const issueSubmission = z.object({
  type: z.literal("issue"),
  predictionId: z.string().uuid(),
  issueType: z.enum(["Incorrect attribution", "Normalization changes meaning", "Wrong deadline", "Wrong resolution", "Duplicate", "Source problem", "Other"]),
  details: z.string().trim().min(10).max(2000),
  email: z.string().email().max(254).or(z.literal("")).optional().default(""),
  company: z.string().max(200).optional().default(""),
});

const schema = z.discriminatedUnion("type", [predictionSubmission, issueSubmission]);

function ipHash(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${env.SUBMISSION_HASH_SALT}:${forwarded}`).digest("hex");
}

export async function POST(request: Request) {
  if (!integrations.supabaseAdmin) return Response.json({ error: "Submission intake is not configured." }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid submission." }, { status: 400 });
  if (parsed.data.company) return Response.json({ ok: true });
  const admin = createAdminSupabaseClient();
  const hash = ipHash(request);
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error: countError } = await admin.from("submissions").select("id", { count: "exact", head: true }).eq("ip_hash", hash).gte("created_at", oneHourAgo);
  if (countError) return Response.json({ error: "Submission service is temporarily unavailable." }, { status: 503 });
  if ((count ?? 0) >= 5) return Response.json({ error: "Too many recent submissions. Please try again later." }, { status: 429 });

  if (parsed.data.type === "issue") {
    const { error } = await admin.from("submissions").insert({
      source_path: `${env.NEXT_PUBLIC_SITE_ORIGIN || "http://localhost:3000"}/predictions/${parsed.data.predictionId}`,
      submitter_email: parsed.data.email || null,
      submission_type: "issue",
      issue_type: parsed.data.issueType,
      details: parsed.data.details,
      related_prediction_id: parsed.data.predictionId,
      status: "pending",
      ip_hash: hash,
    });
    if (error) return Response.json({ error: "Could not store this report." }, { status: 500 });
    return Response.json({ ok: true }, { status: 201 });
  }

  let sourceUrl: URL;
  try { sourceUrl = parseSafePublicUrl(parsed.data.sourceUrl); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid URL." }, { status: 400 }); }
  const xPost = parseXPostUrl(sourceUrl.toString());
  const initialStatus = xPost && !integrations.x ? "waiting_for_source_fetch" : "pending";
  const { data: submission, error: insertError } = await admin.from("submissions").insert({
    source_path: sourceUrl.toString(),
    suggested_expert: parsed.data.expertName || null,
    suggested_category: parsed.data.category || null,
    submitter_email: parsed.data.email || null,
    submission_type: "prediction",
    status: initialStatus,
    ip_hash: hash,
  }).select("id").single();
  if (insertError) return Response.json({ error: "Could not store this submission." }, { status: 500 });

  if (xPost && integrations.x) {
    try {
      const record = await fetchXPostById(xPost.postId, xPost.handle);
      if (record?.exactText) {
        const contentHash = createHash("sha256").update(record.exactText).digest("hex");
        const sourcePayload = {
          source_type: "x", external_id: record.externalId, canonical_path: record.canonicalPath,
          author_external_id: record.authorExternalId, author_handle: record.authorHandle,
          published_at: record.publishedAt.toISOString(), exact_text: record.exactText,
          content_hash: contentHash, metadata: record.metadata, fetched_at: new Date().toISOString(),
          last_verified_at: new Date().toISOString(), deleted_at: null,
        };
        const { data: existingSource, error: lookupError } = await admin.from("sources")
          .select("id")
          .eq("source_type", "x")
          .eq("external_id", record.externalId)
          .maybeSingle();
        if (lookupError) throw lookupError;
        const sourceResult = existingSource
          ? await admin.from("sources").update(sourcePayload).eq("id", existingSource.id).select("id").single()
          : await admin.from("sources").insert(sourcePayload).select("id").single();
        const { data: source, error: sourceError } = sourceResult;
        if (sourceError) throw sourceError;
        const { data: expert } = await admin.from("experts").select("id, display_name, x_handle").ilike("x_handle", record.authorHandle ?? xPost.handle).maybeSingle();
        if (expert && integrations.openai && scorePredictionHeuristic(record.exactText).shouldExtract) {
          const extraction = await extractPredictions({ sourceText: record.exactText, sourceTimestamp: record.publishedAt, authorName: expert.display_name, authorHandle: expert.x_handle });
          for (const candidate of extraction.result.predictions) {
            const deterministic = validateExtractedPrediction(record.exactText, record.publishedAt, candidate);
            const verification = deterministic.valid ? await verifyPrediction({ sourceText: record.exactText, sourceTimestamp: record.publishedAt, authorName: expert.display_name, candidate }) : null;
            const publish = deterministic.valid && canAutoPublish({
              sourceIsUsable: extraction.result.source_is_usable,
              speakerIsAuthor: extraction.result.speaker_is_author,
              extractionConfidence: candidate.extraction_confidence,
              sourceFidelityScore: candidate.source_fidelity_score,
              falsifiabilityScore: candidate.falsifiability_score,
              verifierVerdict: verification?.result.verdict ?? null,
              verifierConfidence: verification?.result.confidence ?? null,
              sourceQuoteLiteral: deterministic.valid,
              hasResolutionCriteria: Boolean(candidate.resolution_criteria),
              hasResolutionDate: Boolean(candidate.resolution_date),
            });
            const { data: storedCandidate, error: candidateError } = await admin.from("prediction_candidates").insert({
              source_id: source.id, expert_id: expert.id, normalized_claim: candidate.normalized_claim,
              source_quote: candidate.source_quote, resolution_date: candidate.resolution_date,
              resolution_criteria: candidate.resolution_criteria, explicit_probability: candidate.explicit_probability,
              confidence_language: candidate.confidence_language, category_slug: candidate.category,
              extraction_confidence: candidate.extraction_confidence, falsifiability_score: candidate.falsifiability_score,
              source_fidelity_score: candidate.source_fidelity_score, verifier_verdict: verification?.result.verdict,
              verifier_confidence: verification?.result.confidence, status: publish ? "auto_verified" : "review",
              reason_rejected: deterministic.errors.join(", ") || verification?.result.reason || null,
              model_name: extraction.model,
              raw_extraction: { extraction: extraction.result, verifier: verification?.result, extraction_schema_version: EXTRACTION_SCHEMA_VERSION, verifier_schema_version: VERIFIER_SCHEMA_VERSION, submission_id: submission.id },
            }).select("id").single();
            if (candidateError) throw candidateError;
            if (publish && candidate.resolution_date) {
              const fingerprint = predictionFingerprint({ expertId: expert.id, sourceId: source.id, normalizedClaim: candidate.normalized_claim, predictionDate: record.publishedAt, resolutionDate: candidate.resolution_date, resolutionCriteria: candidate.resolution_criteria, explicitProbability: candidate.explicit_probability });
              const publishedAt = new Date().toISOString();
              const { data: prediction, error: predictionError } = await admin.from("predictions").upsert({
                expert_id: expert.id, source_id: source.id, category_slug: candidate.category,
                normalized_claim: candidate.normalized_claim, source_quote: candidate.source_quote,
                prediction_date: record.publishedAt.toISOString(), resolution_date: candidate.resolution_date,
                resolution_criteria: candidate.resolution_criteria, explicit_probability: candidate.explicit_probability,
                confidence_language: candidate.confidence_language, falsifiability_score: candidate.falsifiability_score,
                verification_mode: "auto", status: new Date(candidate.resolution_date) <= new Date() ? "due" : "open",
                fingerprint_sha256: fingerprint, published_at: publishedAt, frozen_at: publishedAt,
              }, { onConflict: "fingerprint_sha256", ignoreDuplicates: true }).select("id").maybeSingle();
              if (predictionError) throw predictionError;
              if (prediction) await admin.from("audit_log").insert({ entity_type: "prediction", entity_id: prediction.id, action: "prediction_auto_verified", actor_type: "system", after: { candidate_id: storedCandidate.id, fingerprint }, reason: "Passed deterministic and independent verifier thresholds." });
            }
          }
        }
      }
    } catch (error) {
      console.error("Submitted X source processing failed", error instanceof Error ? error.message : "unknown error");
      await admin.from("submissions").update({ status: "waiting_for_source_fetch" }).eq("id", submission.id);
    }
  }
  return Response.json({ ok: true }, { status: 201 });
}
