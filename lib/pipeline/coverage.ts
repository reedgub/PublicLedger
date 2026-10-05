// Coverage planning for the historical backfill.
//
// History is cut into calendar months per expert × source. Months are
// visited in value order rather than chronologically:
//   1. 12–36 months ago — most deadlines have passed, so predictions can be
//      resolved and scored immediately. Newest first.
//   2. 0–12 months ago — mostly still open; feeds the resolution queue.
//   3. Older than 36 months — extends track records as budget allows.
// Every month records whether it was scanned completely, so scorecards can
// state coverage instead of implying completeness.

import { getDatabase } from "@/lib/db/postgres";

export type Period = { start: Date; end: Date };

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

/**
 * Whole calendar months covering the last `years` years, ending at the start
 * of the current month (the live pipeline owns the current month).
 */
export function planMonthlyPeriods(now: Date, years: number): Period[] {
  const end = monthStart(now);
  const months = Math.round(years * 12);
  const periods: Period[] = [];
  for (let index = months; index >= 1; index -= 1) {
    const start = addMonths(end, -index);
    periods.push({ start, end: addMonths(start, 1) });
  }
  return periods;
}

export function monthsAgo(period: Period, now: Date): number {
  const current = monthStart(now);
  return (current.getUTCFullYear() - period.start.getUTCFullYear()) * 12 + (current.getUTCMonth() - period.start.getUTCMonth());
}

export function priorityBand(period: Period, now: Date): 0 | 1 | 2 {
  const age = monthsAgo(period, now);
  if (age >= 12 && age <= 36) return 0;
  if (age < 12) return 1;
  return 2;
}

export function prioritizePeriods(periods: Period[], now: Date): Period[] {
  return periods.slice().sort((a, b) => {
    const band = priorityBand(a, now) - priorityBand(b, now);
    return band !== 0 ? band : b.start.getTime() - a.start.getTime();
  });
}

// ---- Ledger I/O -------------------------------------------------------------

export type CoverageRow = {
  id: string;
  expert_id: string;
  source_type: string;
  period_start: Date;
  period_end: Date;
  status: string;
  estimated_items: number | null;
};

export async function ensureCoverage(expertId: string, sourceType: string, periods: Period[], queryVersion: string, mode: "live" | "backfill" = "backfill"): Promise<void> {
  if (periods.length === 0) return;
  const sql = getDatabase();
  const rows = periods.map((period) => ({ expert_id: expertId, source_type: sourceType, mode, period_start: period.start, period_end: period.end, query_version: queryVersion }));
  await sql`
    insert into public.ingestion_coverage ${sql(rows, "expert_id", "source_type", "mode", "period_start", "period_end", "query_version")}
    on conflict (expert_id, source_type, period_start, period_end) do nothing
  `;
}

export async function loadCoverage(expertId: string, sourceType: string, since: Date): Promise<CoverageRow[]> {
  const sql = getDatabase();
  return sql<CoverageRow[]>`
    select id, expert_id, source_type, period_start, period_end, status, estimated_items
    from public.ingestion_coverage where expert_id = ${expertId} and source_type = ${sourceType} and period_start >= ${since}
  `;
}

export async function setEstimate(id: string, estimatedItems: number): Promise<void> {
  const sql = getDatabase();
  await sql`update public.ingestion_coverage set estimated_items = ${estimatedItems}, updated_at = now() where id = ${id}`;
}

export async function markCoverage(
  id: string,
  status: "running" | "complete" | "partial" | "failed" | "skipped",
  fields: { itemsFetched?: number; costUsd?: number; error?: string | null; queryVersion?: string } = {},
): Promise<void> {
  const sql = getDatabase();
  await sql`
    update public.ingestion_coverage set
      status = ${status},
      items_fetched = items_fetched + ${fields.itemsFetched ?? 0},
      cost_usd = cost_usd + ${fields.costUsd ?? 0},
      error = ${fields.error ?? null},
      query_version = coalesce(${fields.queryVersion ?? null}, query_version),
      started_at = case when ${status} = 'running' then now() else started_at end,
      completed_at = case when ${status} in ('complete', 'partial', 'failed', 'skipped') then now() else completed_at end,
      updated_at = now()
    where id = ${id}
  `;
}
