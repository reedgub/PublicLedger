import type { Metadata } from "next";
import { getAdminXDiscoveryRuns, getAdminXIngestionStatus } from "@/lib/data/admin";
import { integrations } from "@/lib/env";

export const metadata: Metadata = {
  title: "X ingestion status",
  robots: { index: false, follow: false },
};

function text(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "—";
}

function money(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(4)}` : "—";
}

function dateOnly(value: unknown): string {
  const s = text(value);
  return s === "—" ? s : s.slice(0, 10);
}

export default async function XIngestionStatusPage() {
  if (!integrations.xai) {
    return (
      <>
        <p className="eyebrow">Sources / X discovery</p>
        <h1 className="editorial mt-3 text-5xl">X ingestion</h1>
        <p className="mt-6 max-w-prose text-sm text-muted-foreground">
          Add <code>XAI_API_KEY</code> to enable xAI-driven X discovery. Discovery runs use the server-side{" "}
          <code>x_search</code> tool and verify each candidate against publish.x.com/oembed before insertion. No X
          Bearer Token or scraping is required.
        </p>
      </>
    );
  }

  const [status, runs] = await Promise.all([getAdminXIngestionStatus(), getAdminXDiscoveryRuns()]);
  const cutoffMs = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;

  const weeklySpend = runs.reduce((sum, row) => {
    const started = text(row.started_at);
    if (started === "—") return sum;
    if (new Date(started).getTime() < cutoffMs) return sum;
    const cost = Number(row.cost_usd);
    return sum + (Number.isFinite(cost) ? cost : 0);
  }, 0);

  return (
    <>
      <p className="eyebrow">Sources / X discovery (xAI)</p>
      <h1 className="editorial mt-3 text-5xl">X ingestion</h1>
      <p className="mt-4 max-w-prose text-sm text-muted-foreground">
        Weekly window-checkpointed discovery using xAI&apos;s server-side <code>x_search</code>. Each candidate is
        confirmed against <code>publish.x.com/oembed</code> and the source quote must be an exact substring of the
        oEmbed body before it enters the extraction pipeline.
      </p>

      <dl className="mt-8 grid gap-px bg-foreground sm:grid-cols-3">
        <div className="bg-card p-4">
          <dt className="eyebrow">Rolling 7-day spend</dt>
          <dd className="metric mt-2 text-2xl">{money(weeklySpend)}</dd>
        </div>
        <div className="bg-card p-4">
          <dt className="eyebrow">Experts tracked</dt>
          <dd className="metric mt-2 text-2xl">{status.length}</dd>
        </div>
        <div className="bg-card p-4">
          <dt className="eyebrow">Runs in view</dt>
          <dd className="metric mt-2 text-2xl">{runs.length}</dd>
        </div>
      </dl>

      <h2 className="editorial mt-12 text-3xl">Per-expert checkpoints</h2>
      <div className="mt-4 overflow-x-auto border">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="bg-muted">
            <tr>
              {["Expert", "Handle", "Last window", "Status", "Last success", "Last error"].map((item) => (
                <th key={item} className="eyebrow px-3 py-3">{item}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {status.map((row) => (
              <tr key={text(row.expert_id)} className="border-t align-top">
                <td className="px-3 py-3">{text(row.display_name)}</td>
                <td className="px-3 py-3">@{text(row.x_handle)}</td>
                <td className="metric px-3 py-3">{dateOnly(row.last_from_date)} → {dateOnly(row.last_to_date)}</td>
                <td className="px-3 py-3">{text(row.last_status)}</td>
                <td className="metric px-3 py-3">{text(row.last_success_at)}</td>
                <td className="px-3 py-3 text-muted-foreground">{text(row.last_error)}</td>
              </tr>
            ))}
            {status.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No ingestion checkpoints yet. Run <code>pnpm ingest:x:weekly --backfill-days 30 --expert &lt;slug&gt;</code>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="editorial mt-12 text-3xl">Recent discovery runs</h2>
      <div className="mt-4 overflow-x-auto border">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-muted">
            <tr>
              {["Started", "Window", "Model", "Status", "Candidates", "x_search", "In tokens", "Out tokens", "Cost"].map((item) => (
                <th key={item} className="eyebrow px-3 py-3">{item}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((row) => (
              <tr key={text(row.id)} className="border-t">
                <td className="metric px-3 py-3">{text(row.started_at)}</td>
                <td className="metric px-3 py-3">{dateOnly(row.from_date)} → {dateOnly(row.to_date)}</td>
                <td className="px-3 py-3">{text(row.model)}</td>
                <td className="px-3 py-3">{text(row.status)}</td>
                <td className="metric px-3 py-3">{text(row.candidate_count)}</td>
                <td className="metric px-3 py-3">{text(row.x_search_tool_calls)}</td>
                <td className="metric px-3 py-3">{text(row.input_tokens)}</td>
                <td className="metric px-3 py-3">{text(row.output_tokens)}</td>
                <td className="metric px-3 py-3">{money(row.cost_usd)}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  No discovery runs recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
