"use client";

import { useState } from "react";
import { LoaderCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function AdminLoginForm({ next = "/admin" }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setMessage(null);
    const client = createBrowserSupabaseClient();
    if (!client) { setMessage("Supabase authentication is not configured."); setLoading(false); return; }
    const callback = new URL("/auth/callback", window.location.origin); callback.searchParams.set("next", next);
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: callback.toString() } });
    setMessage(error ? error.message : "Check your email for a magic sign-in link."); setLoading(false);
  }
  return <form onSubmit={submit} className="mt-8 space-y-5 border border-foreground bg-card p-6"><div className="space-y-2"><Label htmlFor="admin-email">Admin email</Label><Input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="rounded-none" /></div><Button type="submit" disabled={loading} className="w-full rounded-none">{loading ? <LoaderCircle className="animate-spin" /> : <Mail />} Send magic link</Button>{message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}</form>;
}
