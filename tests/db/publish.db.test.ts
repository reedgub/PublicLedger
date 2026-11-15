// Integration tests for the single publish path and quarantine, against a
// real Postgres built from supabase/migrations (see supabase/tests/run.sh).
// Skipped unless TEST_DATABASE_URL points at a disposable database.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import type { ExtractedPrediction } from "@/lib/ai/schemas";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("publishCandidate and quarantine (database)", () => {
  let sql: Sql;
  let publishCandidate: typeof import("@/lib/pipeline/publish").publishCandidate;
  let markSourceUnavailable: typeof import("@/lib/predictions/quarantine").markSourceUnavailable;
  let closeDatabase: () => Promise<void>;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.OPENAI_API_KEY = "";
    ({ publishCandidate } = await import("@/lib/pipeline/publish"));
    ({ markSourceUnavailable } = await import("@/lib/predictions/quarantine"));
    const db = await import("@/lib/db/postgres");
    sql = db.getDatabase();
    closeDatabase = db.closeDatabase;
  });
  afterAll(async () => closeDatabase?.());

  const sourceText = "My call: there is a 70% chance the S&P 500 ends 2027 above 8000. Separately, unemployment will be under 5% at the end of 2027.";

  async function fixture(candidateOverrides: Partial<ExtractedPrediction> = {}) {
    const tag = randomUUID().slice(0, 8);
    const [expert] = await sql<{ id: string }[]>`insert into public.experts (slug, display_name, x_handle) values (${`t-${tag}`}, ${`Test ${tag}`}, ${`t_${tag}`}) returning id`;
    const [source] = await sql<{ id: string }[]>`
      insert into public.sources (source_type, external_id, author_handle, expert_id, published_at, exact_text, ingestion_mode)
      values ('x', ${`ext-${tag}`}, ${`t_${tag}`}, ${expert.id}, '2026-03-01 10:00:00.654321+00', ${sourceText}, 'live') returning id`;
    const candidate: ExtractedPrediction = {
      normalized_claim: `The S&P 500 closes 2027 above 8000 (${tag}).`,
      source_quote: "there is a 70% chance the S&P 500 ends 2027 above 8000",
      resolution_date: "2027-12-31",
      resolution_criteria: "S&P 500 official close on the last trading day of 2027 is above 8000.",
      explicit_probability: 0.7,
      confidence_language: null,
      category: "markets-investing",
      extraction_confidence: 0.95,
      falsifiability_score: 0.95,
      source_fidelity_score: 0.95,
      record_type: "prediction",
      imputation_note: null,
      ...candidateOverrides,
    } as ExtractedPrediction;
    const [row] = await sql<{ id: string }[]>`
      insert into public.prediction_candidates (source_id, expert_id, normalized_claim, source_quote, status, pipeline, raw_extraction)
      values (${source.id}, ${expert.id}, ${candidate.normalized_claim}, ${candidate.source_quote}, 'pending', 'cascade', ${sql.json({ candidate } as never)}) returning id`;
    const input = {
      candidateId: row.id, expertId: expert.id, sourceId: source.id, candidate,
      verificationMode: "auto" as const, captureMode: "live" as const,
      auditAction: "prediction_auto_approved", auditReason: "test",
    };
    return { expertId: expert.id, sourceId: source.id, candidateId: row.id, input };
  }

  async function candidateStatus(id: string) {
    const [row] = await sql<{ status: string; reason_rejected: string | null }[]>`select status, reason_rejected from public.prediction_candidates where id = ${id}`;
    return row;
  }

  it("publishes atomically with the source's own timestamp and an audit entry", async () => {
    const f = await fixture();
    const result = await publishCandidate(f.input);
    expect(result.kind).toBe("published");
    const predictionId = (result as { predictionId: string }).predictionId;
    const [prediction] = await sql<{ prediction_date: string; published_at: string | null }[]>`select prediction_date::text, published_at::text from public.predictions where id = ${predictionId}`;
    expect(prediction.prediction_date).toBe("2026-03-01 10:00:00.654321+00");
    expect(prediction.published_at).not.toBeNull();
    const audits = await sql`select 1 from public.audit_log where entity_id = ${predictionId} and action = 'prediction_auto_approved'`;
    expect(audits.length).toBe(1);
    expect((await candidateStatus(f.candidateId)).status).toBe("approved");
  });

  it("rejects when the source no longer contains the quote", async () => {
    const f = await fixture();
    await sql`update public.sources set exact_text = 'The post was edited and says something else now.' where id = ${f.sourceId}`;
    const result = await publishCandidate(f.input);
    expect(result).toEqual({ kind: "rejected", reason: "source_quote_not_literal" });
    expect((await candidateStatus(f.candidateId)).status).toBe("rejected");
    expect((await sql`select 1 from public.predictions where source_id = ${f.sourceId}`).length).toBe(0);
  });

  it("rejects when the source was deleted", async () => {
    const f = await fixture();
    await sql`update public.sources set deleted_at = now(), exact_text = null where id = ${f.sourceId}`;
    expect(await publishCandidate(f.input)).toEqual({ kind: "rejected", reason: "source_unavailable_at_publish" });
  });

  it("rejects a probability the quote does not state", async () => {
    const f = await fixture({ source_quote: "unemployment will be under 5% at the end of 2027", explicit_probability: 0.05 });
    const result = await publishCandidate(f.input);
    expect(result.kind).toBe("rejected");
    expect((result as { reason: string }).reason).toContain("probability_not_stated_in_quote");
  });

  it("publishes only one of two concurrent duplicates", async () => {
    const first = await fixture();
    const [second] = await sql<{ id: string }[]>`
      insert into public.prediction_candidates (source_id, expert_id, normalized_claim, source_quote, status, pipeline, raw_extraction)
      values (${first.sourceId}, ${first.expertId}, ${first.input.candidate.normalized_claim}, ${first.input.candidate.source_quote}, 'pending', 'cascade', '{}'::jsonb) returning id`;
    const results = await Promise.all([publishCandidate(first.input), publishCandidate({ ...first.input, candidateId: second.id })]);
    expect(results.map((result) => result.kind).sort()).toEqual(["duplicate", "published"]);
  });

  it("never publishes a candidate twice", async () => {
    const f = await fixture();
    expect((await publishCandidate(f.input)).kind).toBe("published");
    expect(await publishCandidate(f.input)).toEqual({ kind: "skipped", reason: "candidate_approved" });
  });

  it("quarantines without unpublishing and drops the source text", async () => {
    const f = await fixture();
    const result = await publishCandidate(f.input);
    const predictionId = (result as { predictionId: string }).predictionId;
    expect(await markSourceUnavailable(sql, f.sourceId, "test: deleted")).toEqual([predictionId]);
    const [prediction] = await sql<{ status: string; published_at: string | null }[]>`select status, published_at::text from public.predictions where id = ${predictionId}`;
    expect(prediction.status).toBe("source_unavailable");
    expect(prediction.published_at).not.toBeNull();
    const [source] = await sql<{ exact_text: string | null; deleted_at: string | null }[]>`select exact_text, deleted_at::text from public.sources where id = ${f.sourceId}`;
    expect(source.exact_text).toBeNull();
    expect(source.deleted_at).not.toBeNull();
    const [audit] = await sql<{ before: Record<string, unknown> }[]>`select before from public.audit_log where entity_id = ${f.sourceId} and action = 'source_deleted'`;
    expect(JSON.stringify(audit.before)).not.toContain("S&P");
  });
});
