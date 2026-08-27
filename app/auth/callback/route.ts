import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = z.string().min(1).safeParse(url.searchParams.get("code"));
  const rawNext = url.searchParams.get("next") || "/admin";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/admin";
  if (code.success) {
    const client = await createServerSupabaseClient();
    if (client) {
      const { error } = await client.auth.exchangeCodeForSession(code.data);
      if (!error) return NextResponse.redirect(new URL(next, url.origin));
    }
  }
  const login = new URL("/admin/login", url.origin);
  login.searchParams.set("error", "The sign-in link is invalid or expired.");
  return NextResponse.redirect(login);
}
