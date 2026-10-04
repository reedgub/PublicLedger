"use client";

import { useState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES } from "@/lib/constants";
import { track } from "@/lib/analytics/client";

const issueTypes = ["Incorrect attribution", "Normalization changes meaning", "Wrong deadline", "Wrong resolution", "Duplicate", "Source problem", "Other"];

export function SubmissionForm({ configured, initialType = "prediction", predictionId }: { configured: boolean; initialType?: "prediction" | "issue"; predictionId?: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const isIssue = initialType === "issue";
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    track("submission_started", { type: initialType });
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, type: initialType, predictionId }) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Submission failed");
      setComplete(true);
      track("submission_completed", { type: initialType });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Submission failed"); }
    finally { setSubmitting(false); }
  }
  if (complete) return <div className="border border-correct bg-correct/5 p-8"><p className="editorial text-3xl">Received.</p><p className="mt-3 text-sm text-muted-foreground">The source is queued for review. Submission does not guarantee publication or a scoring change.</p></div>;
  if (!configured) return <div className="border border-provisional bg-provisional/5 p-8"><p className="font-semibold">Submission intake is not configured.</p><p className="mt-2 text-sm text-muted-foreground">Configure Supabase server credentials to persist public submissions. The rest of the public application remains available.</p></div>;
  return (
    <form onSubmit={submit} className="space-y-6 border border-foreground/20 bg-card p-5 sm:p-8">
      <div className="hidden" aria-hidden="true"><Label htmlFor="company">Company</Label><Input id="company" name="company" tabIndex={-1} autoComplete="off" /></div>
      {isIssue ? <>
        <div className="space-y-2"><Label htmlFor="issueType">Issue type</Label><select id="issueType" name="issueType" required className="h-10 w-full rounded-[14px] border bg-background px-3 text-sm"><option value="">Select an issue</option>{issueTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="details">What should we review?</Label><Textarea id="details" name="details" required maxLength={2000} rows={6} className="rounded-[14px]" placeholder="Describe the specific attribution, normalization, deadline, resolution, duplicate, or source problem." /></div>
      </> : <>
        <div className="space-y-2"><Label htmlFor="sourceUrl">Source URL</Label><Input id="sourceUrl" name="sourceUrl" type="url" required maxLength={2048} className="rounded-[14px]" placeholder="https://x.com/…/status/…" /><p className="text-xs text-muted-foreground">X links are retrieved through the official API when configured. Generic pages are queued for manual review and never blindly fetched.</p></div>
        <div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="expertName">Expert name <span className="text-muted-foreground">(optional)</span></Label><Input id="expertName" name="expertName" maxLength={160} className="rounded-[14px]" /></div><div className="space-y-2"><Label htmlFor="category">Category <span className="text-muted-foreground">(optional)</span></Label><select id="category" name="category" className="h-8 w-full rounded-[14px] border bg-background px-3 text-sm"><option value="">Choose a category</option>{CATEGORIES.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></div></div>
      </>}
      <div className="space-y-2"><Label htmlFor="email">Email <span className="text-muted-foreground">(optional)</span></Label><Input id="email" name="email" type="email" maxLength={254} className="rounded-[14px]" placeholder="For a follow-up only" /></div>
      <Button type="submit" disabled={submitting} className="h-11 w-full rounded-[14px]">{submitting ? <LoaderCircle className="animate-spin" /> : <Send />} {submitting ? "Sending…" : isIssue ? "Report issue" : "Submit source"}</Button>
    </form>
  );
}
