// Follow-an-expert intake. Stores { expert, email } for later delivery.
// Rate-limited by IP hash. No email is sent from this handler yet — the
// consumer of the table is the future notification job.

import { z } from "zod";
import { integrations } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { checkRateLimit, requestIpHash } from "@/lib/security/rate-limit";

const schema = z.object({
  expertSlug: z.string().min(1).max(160),
  email: z.string().email().max(254),
  company: z.string().max(200).optional().default(""), // honeypot
});

const SUBSCRIBE_LIMIT = { capacity: 5, refillPerSecond: 0.05 } as const;

export async function POST(request: Request) {
  if (!integrations.supabaseAdmin) return Response.json({ error: "Subscriptions are not configured." }, { status: 503 });
  const ipHash = requestIpHash(request);
  const limit = checkRateLimit(`subscribe:${ipHash}`, SUBSCRIBE_LIMIT);
  if (!limit.allowed) {
    return Response.json({ error: "Too many subscribe attempts. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid subscription." }, { status: 400 });
  if (parsed.data.company) return Response.json({ ok: true });

  const admin = createAdminSupabaseClient();
  const { data: expert, error: expertError } = await admin.from("experts").select("id").eq("slug", parsed.data.expertSlug).maybeSingle();
  if (expertError) return Response.json({ error: "Subscription service is temporarily unavailable." }, { status: 503 });
  if (!expert) return Response.json({ error: "Expert not found." }, { status: 404 });

  const { error } = await admin.from("expert_subscriptions").upsert(
    { expert_id: expert.id, email: parsed.data.email, ip_hash: ipHash, unsubscribed_at: null },
    { onConflict: "expert_id,email_hash" },
  );
  if (error) return Response.json({ error: "Could not record subscription." }, { status: 500 });
  return Response.json({ ok: true }, { status: 201 });
}
