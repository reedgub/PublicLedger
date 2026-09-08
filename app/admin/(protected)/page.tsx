import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getAdminDashboard } from "@/lib/data/admin";

export const metadata: Metadata = { title: "Admin overview", robots: { index: false, follow: false } };
const pct = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;

export default async function AdminPage() {
  const data = await getAdminDashboard();
  const metrics = [
    ["Published predictions", data.published, "/"], ["Pending candidates", data.pending, "/admin/candidates"],
    ["Resolution backlog", data.backlog, "/admin/resolutions"], ["Sources needing refresh", data.staleSources, "/admin/ingestion"],
    ["Extraction acceptance", pct(data.extractionAcceptanceRate), "/admin/candidates"], ["Verifier rejection", pct(data.verifierRejectionRate), "/admin/candidates"],
    ["Duplicate rate", pct(data.duplicateRate), "/admin/candidates"], ["Ambiguous resolution rate", pct(data.ambiguousResolutionRate), "/admin/resolutions"],
    ["Experts with <3 predictions", data.expertsUnder3, "/admin/experts"], ["Leaderboard eligible", data.eligibleExperts, "/admin/experts"],
  ] as const;
  return <><p className="eyebrow">Data quality / Operations</p><h1 className="editorial mt-3 text-5xl font-semibold">Overview</h1><div className="mt-8 grid gap-px bg-foreground sm:grid-cols-2 xl:grid-cols-3">{metrics.map(([label, value, href]) => <Link key={label} href={href} className="group bg-card p-5 hover:bg-muted"><div className="flex justify-between"><span className="eyebrow">{label}</span><ArrowUpRight className="size-4 opacity-40 group-hover:opacity-100" /></div><p className="metric mt-6 text-4xl tracking-[-0.06em]">{value}</p></Link>)}</div></>;
}
