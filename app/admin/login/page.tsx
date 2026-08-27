import type { Metadata } from "next";
import { AdminLoginForm } from "@/components/admin-login-form";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const query = await searchParams;
  const next = typeof query.next === "string" && query.next.startsWith("/") && !query.next.startsWith("//") ? query.next : "/admin";
  return <div className="container-receipts py-20"><div className="mx-auto max-w-md"><p className="eyebrow">Restricted / Server-authorized</p><h1 className="editorial mt-4 text-5xl font-semibold">Admin sign in</h1><p className="mt-4 text-sm text-muted-foreground">Magic-link authentication is restricted to addresses configured in ADMIN_EMAILS and verified again against app_admins.</p>{typeof query.error === "string" && <p className="mt-5 border border-destructive bg-destructive/5 p-3 text-sm text-destructive">{query.error}</p>}<AdminLoginForm next={next} /></div></div>;
}
