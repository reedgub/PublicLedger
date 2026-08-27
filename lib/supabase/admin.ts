import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env, integrations } from "@/lib/env";

export function createAdminSupabaseClient() {
  if (!integrations.supabaseAdmin) {
    throw new Error("Supabase service-role credentials are not configured.");
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
