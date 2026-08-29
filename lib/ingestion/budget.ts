// Weekly budget accounting for xAI-driven X discovery.
//
// Soft cap: warn once, keep going. Hard cap: refuse to spend more.
// The tracker sums up cost as it goes and exposes helpers so the CLI can
// decide whether to skip the next expert before making the call.

import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export type BudgetSnapshot = {
  softLimitUsd: number;
  hardLimitUsd: number;
  spentUsd: number;
  underSoft: boolean;
  underHard: boolean;
  remainingSoftUsd: number;
  remainingHardUsd: number;
};

export type BudgetTracker = {
  snapshot(): BudgetSnapshot;
  spend(usd: number): BudgetSnapshot;
  ensureUnderSoft(): boolean;
  ensureUnderHard(): boolean;
};

export function createBudgetTracker(initialSpentUsd = 0): BudgetTracker {
  let spent = Number.isFinite(initialSpentUsd) ? Math.max(0, initialSpentUsd) : 0;
  const soft = env.X_INGESTION_WEEKLY_SOFT_BUDGET_USD;
  const hard = env.X_INGESTION_WEEKLY_HARD_BUDGET_USD;
  const snapshot = (): BudgetSnapshot => ({
    softLimitUsd: soft,
    hardLimitUsd: hard,
    spentUsd: spent,
    underSoft: spent < soft,
    underHard: spent < hard,
    remainingSoftUsd: Math.max(0, soft - spent),
    remainingHardUsd: Math.max(0, hard - spent),
  });
  return {
    snapshot,
    spend(usd) {
      spent += Math.max(0, usd);
      return snapshot();
    },
    ensureUnderSoft() {
      return snapshot().underSoft;
    },
    ensureUnderHard() {
      return snapshot().underHard;
    },
  };
}

// Reads x_discovery_runs to compute how much has already been spent inside a
// rolling window (default 7 days). Only rows whose ingestion_run_id matches
// the supplied run id are excluded — so budget accounting for the CURRENT run
// stays live in the tracker and doesn't double-count prior calls in the same
// batch.
export async function loadWeeklySpend(
  admin: SupabaseClient,
  options: { windowDays?: number; ingestionRunId?: string | null } = {},
): Promise<number> {
  const days = options.windowDays ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let query = admin
    .from("x_discovery_runs")
    .select("cost_usd, ingestion_run_id")
    .gte("started_at", since);
  if (options.ingestionRunId) {
    query = query.neq("ingestion_run_id", options.ingestionRunId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
}
