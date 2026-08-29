// One-shot admin endpoint: iterates every expert with an x_handle, resolves it
// via /2/users/by/username, and updates x_user_id + avatar_url +
// source_status='verified'. On X Free tier this is one API call per expert
// (~65 total), well under the monthly cap. Failures for individual handles
// mark that expert 'unresolved' without stopping the batch.

import { env, integrations } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { resolveXUser } from "@/lib/sources/x";

function authorized(request: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const bearer = request.headers.get("authorization");
  return bearer === `Bearer ${env.CRON_SECRET}` || request.headers.get("x-cron-secret") === env.CRON_SECRET;
}

async function handle(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!integrations.supabaseAdmin) return Response.json({ error: "Supabase admin is not configured" }, { status: 503 });
  if (!integrations.x) return Response.json({ error: "X_BEARER_TOKEN is not configured" }, { status: 503 });

  const admin = createAdminSupabaseClient();
  const startedAt = new Date().toISOString();
  const { data: run } = await admin
    .from("ingestion_runs")
    .insert({ source_type: "x", job_type: "verify_experts", status: "running", started_at: startedAt })
    .select("id")
    .single();

  const { data: experts, error } = await admin
    .from("experts")
    .select("id, slug, display_name, x_handle, source_status")
    .not("x_handle", "is", null);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let verified = 0;
  let unresolved = 0;
  let errors = 0;
  const details: Array<{ slug: string; status: "verified" | "unresolved" | "error"; reason?: string }> = [];

  for (const expert of experts ?? []) {
    if (!expert.x_handle) continue;
    try {
      const user = await resolveXUser(expert.x_handle);
      const matches = user && user.username.toLowerCase() === expert.x_handle.toLowerCase();
      if (user && matches) {
        await admin
          .from("experts")
          .update({
            x_user_id: user.id,
            x_handle: user.username,
            avatar_url: user.profileImageUrl,
            source_status: "verified",
          })
          .eq("id", expert.id);
        verified += 1;
        details.push({ slug: expert.slug, status: "verified" });
      } else {
        await admin.from("experts").update({ x_user_id: null, source_status: "unresolved" }).eq("id", expert.id);
        unresolved += 1;
        details.push({ slug: expert.slug, status: "unresolved", reason: user ? `handle mismatch: got ${user.username}` : "not found" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await admin.from("experts").update({ source_status: "unresolved" }).eq("id", expert.id);
      unresolved += 1;
      errors += 1;
      details.push({ slug: expert.slug, status: "error", reason: message });
    }
  }

  if (run) {
    await admin
      .from("ingestion_runs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        items_requested: experts?.length ?? 0,
        items_fetched: verified + unresolved,
        items_created: verified,
        items_rejected: unresolved,
        errors,
        metadata: { verified, unresolved, details: details.slice(0, 200) },
      })
      .eq("id", run.id);
  }

  return Response.json({
    ok: true,
    total: experts?.length ?? 0,
    verified,
    unresolved,
    errors,
    details,
  });
}

export const GET = handle;
export const POST = handle;
export const maxDuration = 60;
