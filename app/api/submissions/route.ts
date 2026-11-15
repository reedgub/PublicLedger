import { createHash } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { env, integrations } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { parseSafePublicUrl, parseXPostUrl } from "@/lib/security/urls";
import { requestIpHash } from "@/lib/security/rate-limit";
import { fetchXPostById } from "@/lib/sources/x";
import { captureModeFor } from "@/lib/sources/manualImport";

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

export async function POST(request: Request) {
  if (!integrations.supabaseAdmin) return Response.json({ error: "Submission intake is not configured." }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid submission." }, { status: 400 });
  if (parsed.data.company) return Response.json({ ok: true });
  const admin = createAdminSupabaseClient();
  const hash = requestIpHash(request);
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

  // Reading the post from X can be slow; return 201 immediately and store the
  // lead after the response so the submitter never sees a timeout.
  if (xPost && integrations.x) {
    after(async () => {
      try {
        await processSubmittedXPost({ submissionId: submission.id, xPost });
      } catch (error) {
        console.error("Deferred X submission processing failed", error instanceof Error ? error.message : "unknown");
        await admin.from("submissions").update({ status: "waiting_for_source_fetch" }).eq("id", submission.id);
      }
    });
  }
  return Response.json({ ok: true }, { status: 201 });
}

/**
 * A submitted X post is only a lead. It is read through the official API and
 * stored as a source for its expert; the daily cascade then extracts and
 * verifies it under the spend caps, through the same single publish path as
 * every other source. Nothing is extracted, verified or published here.
 */
async function processSubmittedXPost(input: {
  submissionId: string;
  xPost: { postId: string; handle: string };
}) {
  const admin = createAdminSupabaseClient();
  const record = await fetchXPostById(input.xPost.postId, input.xPost.handle);
  if (!record?.exactText || !record.authorHandle) return;
  const { data: existingSource, error: lookupError } = await admin.from("sources")
    .select("id")
    .eq("source_type", "x")
    .eq("external_id", record.externalId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existingSource) return;
  const handle = record.authorHandle.toLowerCase();
  const { data: candidates } = await admin.from("experts").select("id, x_handle, x_user_id").eq("is_active", true).not("x_handle", "is", null);
  const expert = (candidates ?? []).find((row) => (row.x_user_id && row.x_user_id === record.authorExternalId) || row.x_handle?.toLowerCase() === handle);
  if (!expert) return;
  const { error: insertError } = await admin.from("sources").insert({
    source_type: "x", external_id: record.externalId, canonical_path: record.canonicalPath,
    author_external_id: record.authorExternalId, author_handle: record.authorHandle,
    published_at: record.publishedAt.toISOString(), exact_text: record.exactText,
    content_hash: createHash("sha256").update(record.exactText).digest("hex"), metadata: { ...record.metadata, submission_id: input.submissionId },
    fetched_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
    expert_id: expert.id, ingestion_mode: captureModeFor(record.publishedAt), source_verification_level: "x_api",
  });
  // A concurrent collector may have stored the same post first.
  if (insertError && insertError.code !== "23505") throw insertError;
}
