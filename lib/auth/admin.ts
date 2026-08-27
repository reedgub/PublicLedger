import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { adminEmails, integrations } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type AdminSession = { userId: string; email: string };

export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  await connection();
  if (!integrations.supabase) return null;
  const client = await createServerSupabaseClient();
  const { data: { user }, error } = await client!.auth.getUser();
  if (error || !user?.email) return null;
  const email = user.email.toLowerCase();
  if (!adminEmails().has(email)) return null;
  if (!integrations.supabaseAdmin) return null;
  const admin = createAdminSupabaseClient();
  const { data: existing, error: adminError } = await admin.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (adminError) throw new Error("Unable to verify admin authorization.");
  if (!existing) {
    const { error: bootstrapError } = await admin.from("app_admins").insert({ user_id: user.id });
    if (bootstrapError) throw new Error("Unable to bootstrap the configured administrator.");
  }
  return { userId: user.id, email };
});

export async function requireAdmin(next = "/admin"): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect(`/admin/login?next=${encodeURIComponent(next)}`);
  return session;
}

export async function assertAdmin(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}
