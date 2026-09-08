import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CATEGORIES, type CategorySlug } from "@/lib/constants";
import type { Expert } from "@/types/domain";

type Props = {
  experts: Expert[];
  eyebrow?: string;
  title?: string;
  description?: string;
};

export function RosterPreview({
  experts,
  eyebrow = "Roster / Pre-ingestion",
  title = "Awaiting first resolutions",
  description = "The public leaderboard opens once experts accumulate at least five resolved binary predictions. Until then, this is the discovery roster the extraction pipeline will draw from — every handle is real, every profile will remain empty until source-backed predictions land.",
}: Props) {
  const byCategory = new Map<CategorySlug, Expert[]>();
  for (const expert of experts) {
    const slug = expert.primaryCategorySlug;
    if (!byCategory.has(slug)) byCategory.set(slug, []);
    byCategory.get(slug)!.push(expert);
  }
  const columns = CATEGORIES.filter((category) => byCategory.get(category.slug)?.length);

  return (
    <section className="mt-8 border border-foreground bg-card">
      <header className="border-b border-foreground px-5 py-6 sm:px-8">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="editorial mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{title}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      </header>
      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
        {columns.map((category) => {
          const rows = byCategory.get(category.slug) ?? [];
          return (
            <div key={category.slug} className="bg-card p-5">
              <p className="eyebrow flex items-center justify-between">
                <span>{category.name}</span>
                <span className="metric text-muted-foreground">{String(rows.length).padStart(2, "0")}</span>
              </p>
              <ul className="mt-4 space-y-1.5">
                {rows.map((expert) => (
                  <li key={expert.id}>
                    <Link
                      href={`/experts/${expert.slug}`}
                      className="group flex items-baseline justify-between gap-3 border-b border-dashed border-transparent py-1 hover:border-border"
                    >
                      <span className="text-sm font-semibold group-hover:underline">{expert.displayName}</span>
                      {expert.xHandle ? (
                        <span className="metric shrink-0 text-[10px] text-muted-foreground">@{expert.xHandle}</span>
                      ) : (
                        <ArrowUpRight className="size-3 shrink-0 text-muted-foreground opacity-60" />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
