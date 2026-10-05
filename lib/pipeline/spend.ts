// Spend ledger + hard budget caps for every paid provider in the cascade.
//
// Every paid call (X reads, open-model tokens, OpenAI tokens, transcription
// minutes) records a row in public.pipeline_spend. Before each paid step the
// caller asks a BudgetGuard whether the estimated cost still fits under the
// cap for its scope. Caps are computed from the ledger, so a crashed or
// restarted run can never "forget" what it already spent.

import { env } from "@/lib/env";
import { getDatabase } from "@/lib/db/postgres";

export type SpendScope = "daily" | "backfill" | "resolution" | "discovery" | "other";

export type SpendEntry = {
  scope: SpendScope;
  provider: string;
  stage: string;
  units: number;
  unitKind: string;
  costUsd: number;
  runId?: string | null;
  metadata?: Record<string, unknown>;
};

// ---- Pure cost helpers ------------------------------------------------------

export function tokenCostUsd(
  usage: { inputTokens: number; outputTokens: number },
  pricePerMTok: { input: number; output: number },
  discount = 0,
): number {
  const gross = (usage.inputTokens * pricePerMTok.input + usage.outputTokens * pricePerMTok.output) / 1_000_000;
  return gross * (1 - discount);
}

export function xReadCostUsd(postsRead: number, requests = 0): number {
  return postsRead * env.X_PRICE_PER_POST_READ_USD + requests * env.X_PRICE_PER_REQUEST_USD;
}

export function transcriptionCostUsd(audioSeconds: number): number {
  return (audioSeconds / 3600) * env.TRANSCRIBE_PRICE_PER_HOUR_USD;
}

// ---- Budget guard -----------------------------------------------------------

export class BudgetExceededError extends Error {
  constructor(public readonly scope: SpendScope, public readonly capUsd: number, public readonly spentUsd: number) {
    super(`Budget cap reached for ${scope}: spent $${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)}.`);
  }
}

export class BudgetGuard {
  private spent: number;

  constructor(public readonly scope: SpendScope, public readonly capUsd: number, alreadySpentUsd = 0) {
    this.spent = Math.max(0, Number.isFinite(alreadySpentUsd) ? alreadySpentUsd : 0);
  }

  get spentUsd(): number {
    return this.spent;
  }

  get remainingUsd(): number {
    return Math.max(0, this.capUsd - this.spent);
  }

  /** True when an operation estimated at `estimateUsd` still fits under the cap. */
  canSpend(estimateUsd = 0): boolean {
    return this.spent + Math.max(0, estimateUsd) <= this.capUsd;
  }

  /** Throws BudgetExceededError instead of returning false. */
  assertCanSpend(estimateUsd = 0): void {
    if (!this.canSpend(estimateUsd)) throw new BudgetExceededError(this.scope, this.capUsd, this.spent);
  }

  add(usd: number): void {
    this.spent += Math.max(0, usd);
  }

  /** Return a reservation made with add() (e.g. an in-flight estimate). */
  release(usd: number): void {
    this.spent = Math.max(0, this.spent - Math.max(0, usd));
  }
}

export function defaultCapUsd(scope: SpendScope): number {
  if (scope === "backfill") return env.BACKFILL_BUDGET_USD;
  if (scope === "resolution") return env.RESOLUTION_DAILY_BUDGET_USD;
  return env.DAILY_BUDGET_USD;
}

// ---- Ledger I/O -------------------------------------------------------------

export async function recordSpend(entry: SpendEntry, guard?: BudgetGuard): Promise<void> {
  guard?.add(entry.costUsd);
  if (entry.costUsd <= 0 && entry.units <= 0) return;
  const sql = getDatabase();
  await sql`
    insert into public.pipeline_spend (run_id, scope, provider, stage, units, unit_kind, cost_usd, metadata)
    values (${entry.runId ?? null}, ${entry.scope}, ${entry.provider}, ${entry.stage}, ${entry.units}, ${entry.unitKind},
      ${entry.costUsd}, ${sql.json((entry.metadata ?? {}) as never)})
  `;
}

/**
 * Spend already booked against a scope. Daily-style scopes use a rolling 24h
 * window; the backfill cap is lifetime unless `since` is passed (e.g. per
 * campaign).
 */
export async function loadSpentUsd(scope: SpendScope, since?: Date): Promise<number> {
  const sql = getDatabase();
  const from = since ?? (scope === "backfill" ? new Date(0) : new Date(Date.now() - 24 * 60 * 60 * 1000));
  const [row] = await sql<{ total: string | null }[]>`
    select sum(cost_usd)::text as total from public.pipeline_spend where scope = ${scope} and created_at >= ${from}
  `;
  // Batches still in flight have no ledger row yet; count their estimate so
  // a second run cannot spend the same budget again.
  const [inflight] = await sql<{ total: string | null }[]>`
    select sum((metadata->>'estimated_usd')::numeric)::text as total from public.verification_batches
    where status = 'submitted' and metadata->>'scope' = ${scope} and submitted_at >= ${from}
  `;
  return Number(row?.total ?? 0) + Number(inflight?.total ?? 0);
}

export async function createBudgetGuard(scope: SpendScope, options: { capUsd?: number; since?: Date } = {}): Promise<BudgetGuard> {
  const spent = await loadSpentUsd(scope, options.since);
  return new BudgetGuard(scope, options.capUsd ?? defaultCapUsd(scope), spent);
}
