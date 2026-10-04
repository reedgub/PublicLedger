import type { Metadata } from "next";
import { SubmissionForm } from "@/components/submission-form";
import { integrations } from "@/lib/env";

export const metadata: Metadata = { title: "Submit a source", description: "Submit a public prediction source or report an issue with an existing prediction." };

export default async function SubmitPage({ searchParams }: PageProps<"/submit">) {
  const query = await searchParams;
  const issue = query.type === "issue";
  const predictionId = typeof query.prediction === "string" ? query.prediction : undefined;
  return (
    <div className="container-page py-12 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <p className="eyebrow">Public intake / Manual review</p>
        <h1 className="display-1 mt-4">{issue ? "Report an issue" : "Submit a source"}</h1>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-muted-foreground">{issue ? "Flag a specific problem with attribution, normalization, deadline, resolution, duplication, or source availability. All corrections are audited." : "Send a public source containing a falsifiable future prediction. We preserve exact wording, reject vague claims, and never infer an unstated numeric probability."}</p>
        <div className="mt-10"><SubmissionForm configured={integrations.supabaseAdmin} initialType={issue ? "issue" : "prediction"} predictionId={predictionId} /></div>
      </div>
    </div>
  );
}
