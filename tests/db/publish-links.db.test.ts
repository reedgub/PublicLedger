// A failing market matcher must never fail or undo a publish. Separate file
// because it needs OPENAI_API_KEY set (to reach market matching) before the
// env module loads. Skipped unless TEST_DATABASE_URL is set.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import type { ExtractedPrediction } from "@/lib/ai/schemas";

vi.mock("@/lib/ai/matchMarket", () => ({
  verifyMarketMatch: async () => {
    throw Object.assign(new Error("429 You have no credits remaining."), { status: 429 });
  },
}));

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("publish with a failing market matcher (database)", () => {
  let sql: Sql;
  let publishCandidate: typeof import("@/lib/pipeline/publish").publishCandidate;
  let closeDatabase: () => Promise<void>;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.OPENAI_API_KEY = "sk-test-not-used";
    ({ publishCandidate } = await import("@/lib/pipeline/publish"));
    const db = await import("@/lib/db/postgres");
    sql = db.getDatabase();
    closeDatabase = db.closeDatabase;
  });
  afterAll(async () => closeDatabase?.());

  it("still publishes when market linking throws", async () => {
    const tag = randomUUID().slice(0, 8);
    const claim = `Unemployment ends 2027 above 5 percent (${tag})`;
    const [expert] = await sql<{ id: string }[]>`insert into public.experts (slug, display_name, x_handle) values (${`m-${tag}`}, ${`M ${tag}`}, ${`m_${tag}`}) returning id`;
    const [source] = await sql<{ id: string }[]>`
      insert into public.sources (source_type, external_id, author_handle, expert_id, published_at, exact_text, ingestion_mode)
      values ('x', ${`mx-${tag}`}, ${`m_${tag}`}, ${expert.id}, '2026-03-01 10:00:00+00', 'Unemployment will end 2027 above 5 percent.', 'live') returning id`;
    // A market whose question matches the claim, so the matcher is actually called.
    await sql`insert into public.markets (provider, provider_market_id, question) values ('polymarket', ${`pm-${tag}`}, ${claim})`;
    const candidate = {
      normalized_claim: claim, source_quote: "Unemployment will end 2027 above 5 percent.", resolution_date: "2027-12-31",
      resolution_criteria: "BLS December 2027 unemployment rate above 5.0%.", explicit_probability: null, confidence_language: null,
      category: "economy-rates", extraction_confidence: 0.95, falsifiability_score: 0.95, source_fidelity_score: 0.95, record_type: "prediction", imputation_note: null,
    } as ExtractedPrediction;
    const [row] = await sql<{ id: string }[]>`
      insert into public.prediction_candidates (source_id, expert_id, normalized_claim, source_quote, status, pipeline, raw_extraction)
      values (${source.id}, ${expert.id}, ${claim}, ${candidate.source_quote}, 'pending', 'cascade', ${sql.json({ candidate } as never)}) returning id`;

    const result = await publishCandidate({
      candidateId: row.id, expertId: expert.id, sourceId: source.id, candidate,
      verificationMode: "auto", captureMode: "live", auditAction: "prediction_auto_approved", auditReason: "test",
    });
    expect(result.kind).toBe("published");
    const [prediction] = await sql<{ published_at: string | null }[]>`select published_at::text from public.predictions where id = ${(result as { predictionId: string }).predictionId}`;
    expect(prediction.published_at).not.toBeNull();
  });
});
