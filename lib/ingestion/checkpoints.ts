// Per-expert ingestion checkpoints.
//
// A weekly cron reads the last successful window per expert and computes the
// next window with a 2-day overlap, so an oEmbed cache-miss or a late-posted
// prediction near the boundary still gets picked up on the next run.
//
// If an expert has never succeeded, the caller falls back to a 90-day backfill
// (or whatever range the CLI passes in). If the checkpoint is older than 30
// days, we clamp the recovery window to avoid huge search spans.

import type { SupabaseClient } from "@supabase/supabase-js";

const OVERLAP_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_RECOVERY_MS = 30 * 24 * 60 * 60 * 1000;

export type ExpertCheckpoint = {
  expertId: string;
  sourceType: string;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  lastFromDate: string | null;
  lastToDate: string | null;
  lastStatus: string | null;
  lastError: string | null;
  updatedAt: string;
};

type CheckpointRow = {
  expert_id: string;
  source_type: string;
  last_started_at: string | null;
  last_success_at: string | null;
  last_from_date: string | null;
  last_to_date: string | null;
  last_status: string | null;
  last_error: string | null;
  updated_at: string;
};

function fromRow(row: CheckpointRow): ExpertCheckpoint {
  return {
    expertId: row.expert_id,
    sourceType: row.source_type,
    lastStartedAt: row.last_started_at,
    lastSuccessAt: row.last_success_at,
    lastFromDate: row.last_from_date,
    lastToDate: row.last_to_date,
    lastStatus: row.last_status,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export async function readCheckpoint(
  admin: SupabaseClient,
  expertId: string,
  sourceType = "x",
): Promise<ExpertCheckpoint | null> {
  const { data, error } = await admin
    .from("ingestion_checkpoints")
    .select("*")
    .eq("expert_id", expertId)
    .eq("source_type", sourceType)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as CheckpointRow) : null;
}

export async function writeCheckpoint(
  admin: SupabaseClient,
  input: {
    expertId: string;
    sourceType?: string;
    startedAt: string;
    successAt?: string | null;
    fromDate: string;
    toDate: string;
    status: string;
    error?: string | null;
  },
): Promise<void> {
  const payload = {
    expert_id: input.expertId,
    source_type: input.sourceType ?? "x",
    last_started_at: input.startedAt,
    last_success_at: input.successAt ?? null,
    last_from_date: input.fromDate,
    last_to_date: input.toDate,
    last_status: input.status,
    last_error: input.error ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("ingestion_checkpoints")
    .upsert(payload, { onConflict: "expert_id,source_type" });
  if (error) throw error;
}

export type NextWindowOptions = {
  now?: Date;
  backfillDays?: number;
  overlapMs?: number;
  maxRecoveryMs?: number;
};

// Compute the window to query next for a given expert. Behavior:
// - Never queried before: [now - backfillDays, now)
// - Last success recent: [lastSuccess - overlap, now)
// - Last success older than max recovery: [now - maxRecovery, now)
// - Would produce a zero/negative window (extreme clock skew): null.
export function computeNextWindow(
  checkpoint: ExpertCheckpoint | null,
  options: NextWindowOptions = {},
): { fromDate: string; toDate: string } | null {
  const now = (options.now ?? new Date()).getTime();
  const overlap = options.overlapMs ?? OVERLAP_MS;
  const maxRecovery = options.maxRecoveryMs ?? MAX_RECOVERY_MS;
  const backfill = (options.backfillDays ?? 90) * 24 * 60 * 60 * 1000;

  const anchor = checkpoint?.lastSuccessAt ? new Date(checkpoint.lastSuccessAt).getTime() : null;
  const from = anchor === null ? now - backfill : Math.max(anchor - overlap, now - maxRecovery);
  const clamped = Math.min(from, now - 60_000);
  if (clamped >= now) return null;
  return {
    fromDate: new Date(clamped).toISOString(),
    toDate: new Date(now).toISOString(),
  };
}
