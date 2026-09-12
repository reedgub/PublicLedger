import Link from "next/link";
import { DatabaseZap, FileCheck2, Gauge, LogOut, MessageSquareText, UserRoundCheck, WandSparkles } from "lucide-react";
import { requireAdmin } from "@/lib/auth/admin";
import { signOutAction } from "@/app/admin/actions";

const links = [
  ["Overview", "/admin", Gauge], ["Candidates", "/admin/candidates", WandSparkles],
  ["Resolutions", "/admin/resolutions", FileCheck2], ["Experts", "/admin/experts", UserRoundCheck],
  ["Ingestion", "/admin/ingestion", DatabaseZap],
  ["X discovery", "/admin/ingestion/x", MessageSquareText],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  return <div className="container-page py-8"><div className="grid gap-8 lg:grid-cols-[210px_1fr]"><aside><div className="sticky top-20 border border-foreground bg-card"><div className="border-b border-foreground p-4"><p className="eyebrow">Admin console</p><p className="metric mt-2 truncate text-[10px]">{session.email}</p></div><nav>{links.map(([label, href, Icon]) => <Link key={href} href={href} className="flex items-center gap-2 border-b px-4 py-3 text-sm last:border-0 hover:bg-muted"><Icon className="size-4" />{label}</Link>)}</nav><form action={signOutAction} className="border-t border-foreground"><button className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-muted"><LogOut className="size-4" />Sign out</button></form></div></aside><div className="min-w-0">{children}</div></div></div>;
}
