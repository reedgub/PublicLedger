import { describe, expect, it } from "vitest";
import { extractJsonObject } from "@/lib/llm/openCompat";
import { selectUnits, splitBlocks } from "@/lib/pipeline/chunk";
import { buildScreenUserPrompt, keptKeys } from "@/lib/pipeline/screen";
import { normalizeExtraction, buildExtractionUserPrompt } from "@/lib/pipeline/extract";
import { buildBatchLine, decideCandidate, parseBatchOutputLine, verifierContext, type CascadeVerdict } from "@/lib/pipeline/verify";
import { BudgetGuard, tokenCostUsd } from "@/lib/pipeline/spend";
import { dedupeWithinSource, isProviderOutage, sourceForcesReview } from "@/lib/pipeline/cascade";
import { buildCascadeXQuery, windowYearTerms, X_QUERY_MAX_LENGTH } from "@/lib/sources/x-query";
import { fullPostText } from "@/lib/sources/x-parser";
import type { ExtractedPrediction } from "@/lib/ai/schemas";

const prediction = (overrides: Partial<ExtractedPrediction> = {}): ExtractedPrediction => ({
  normalized_claim: "The Federal Reserve will cut rates by June 2024.",
  source_quote: "the Fed cuts by June",
  resolution_date: "2024-06-30",
  resolution_criteria: "Federal Reserve FOMC statement",
  explicit_probability: null,
  confidence_language: "will",
  category: "economy-rates",
  extraction_confidence: 0.9,
  falsifiability_score: 0.9,
  source_fidelity_score: 0.95,
  record_type: "prediction",
  imputation_note: null,
  ...overrides,
});

const verdict = (overrides: Partial<CascadeVerdict> = {}): CascadeVerdict => ({
  verdict: "faithful",
  decision: "approve",
  confidence: 0.95,
  reason: "ok",
  ...overrides,
});

describe("cascade X query", () => {
  it("builds one merged query with window-aware year terms", () => {
    const query = buildCascadeXQuery("@LHSummers", { start: new Date("2022-03-01"), end: new Date("2022-04-01") });
    expect(query.startsWith("from:LHSummers (")).toBe(true);
    expect(query).toContain('"by 2022"');
    expect(query).toContain('"by 2023"');
    expect(query).not.toContain('"by 2030"');
    expect(query).toContain("-is:retweet");
    expect(query).toContain("-is:reply");
    expect(query).not.toMatch(/\bwill\b/);
    expect(query.length).toBeLessThanOrEqual(X_QUERY_MAX_LENGTH);
  });

  it("adds recall terms and replies only when asked", () => {
    const query = buildCascadeXQuery("sama", { start: new Date("2025-01-01"), end: new Date("2025-02-01"), tier: "recall", includeReplies: true });
    expect(query).toMatch(/\bwill\b/);
    expect(query).not.toContain("-is:reply");
    expect(query.length).toBeLessThanOrEqual(X_QUERY_MAX_LENGTH);
  });

  it("drops year terms rather than exceeding the length limit", () => {
    const query = buildCascadeXQuery("abcdefghijklmno", { start: new Date("2021-01-01"), end: new Date("2026-01-01"), tier: "recall", maxLength: 420 });
    expect(query.length).toBeLessThanOrEqual(420);
  });

  it("rejects invalid handles", () => {
    expect(() => buildCascadeXQuery("not a handle", { start: new Date(), end: new Date() })).toThrow();
  });

  it("generates year terms from the window", () => {
    expect(windowYearTerms(new Date("2023-05-01"), new Date("2023-06-01"), 2)).toEqual(['"by 2023"', '"by 2024"', '"by 2025"']);
  });

  it("prefers the full long-form text over the truncated one", () => {
    expect(fullPostText({ id: "1", text: "short…", note_tweet: { text: "short and then the full long text" } })).toBe("short and then the full long text");
    expect(fullPostText({ id: "1", text: "plain" })).toBe("plain");
  });
});

describe("stage 0 chunking", () => {
  it("returns a short forward-looking text as one unit and drops chatter", () => {
    expect(selectUnits("I expect the Fed will cut rates by 2025.")).toHaveLength(1);
    expect(selectUnits("lol")).toHaveLength(0);
  });

  it("keeps only forward-looking passages of long documents, as exact slices", () => {
    const filler = "This paragraph recounts history and describes what happened last year in detail. ".repeat(12);
    const hit = "My forecast: I expect US inflation will fall below 3% by 2025, and I predict two rate cuts.";
    const text = `${filler}\n\n${filler}\n\n${hit}\n\n${filler}\n\n${filler}`;
    const units = selectUnits(text, { maxUnitChars: 1500, blockChars: 500, contextBlocks: 0 });
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      expect(text.slice(unit.start, unit.end)).toBe(unit.text);
      expect(unit.text.length).toBeLessThanOrEqual(1500);
    }
    expect(units.some((unit) => unit.text.includes("inflation will fall below 3%"))).toBe(true);
    expect(units.reduce((sum, unit) => sum + unit.text.length, 0)).toBeLessThan(text.length / 2);
  });

  it("hard-cuts unpunctuated transcripts into bounded blocks", () => {
    const text = "word ".repeat(2000);
    const blocks = splitBlocks(text, 500);
    expect(blocks.length).toBeGreaterThan(5);
    for (const block of blocks) expect(block.end - block.start).toBeLessThanOrEqual(1000);
  });
});

describe("stage 1 screen", () => {
  it("numbers items and maps kept numbers back to keys", () => {
    const items = [{ key: "a", text: "one" }, { key: "b", text: "two" }, { key: "c", text: "three" }];
    expect(buildScreenUserPrompt(items)).toContain("[2] two");
    expect([...keptKeys(items, [1, 3, 9, 0])]).toEqual(["a", "c"]);
  });
});

describe("stage 2 extraction parsing", () => {
  it("keeps valid rows, counts malformed ones and maps unknown categories to other", () => {
    const result = normalizeExtraction({
      source_is_usable: true,
      speaker_is_author: true,
      reason_rejected: null,
      predictions: [prediction(), { normalized_claim: "missing fields" }, { ...prediction(), category: "made-up" }],
    });
    expect(result.predictions).toHaveLength(2);
    expect(result.predictions[1].category).toBe("other");
    expect(result.malformed).toBe(1);
  });

  it("tells the model when the text is an excerpt or a transcript", () => {
    const prompt = buildExtractionUserPrompt({ authorName: "A", sourceType: "podcast", sourceTimestamp: "2023-01-01T00:00:00Z", text: "x", isExcerpt: true });
    expect(prompt).toContain("excerpt");
    expect(prompt).toContain("machine transcript");
  });

  it("parses JSON from noisy model replies", () => {
    expect(extractJsonObject('<think>hmm {"no":1}</think>Sure: ```json\n{"keep":[1,2],"note":"a } brace"}\n```')).toEqual({ keep: [1, 2], note: "a } brace" });
    expect(() => extractJsonObject("no json here")).toThrow();
  });
});

describe("stage 3 verification", () => {
  const flags = { recordType: "prediction" as const, forceReview: false, hasResolutionDate: true };

  it("publishes only faithful approvals and tiers by confidence", () => {
    expect(decideCandidate(verdict(), flags)).toEqual({ action: "publish", verificationMode: "auto" });
    expect(decideCandidate(verdict({ confidence: 0.8 }), flags)).toEqual({ action: "publish", verificationMode: "auto_low_confidence" });
    expect(decideCandidate(verdict({ confidence: 0.5 }), flags).action).toBe("review");
    expect(decideCandidate(verdict({ verdict: "ambiguous" }), flags).action).toBe("review");
  });

  it("rejects substantive problems and hindsight leaks", () => {
    expect(decideCandidate(verdict({ decision: "reject", verdict: "wrong_speaker" }), flags).action).toBe("reject");
    expect(decideCandidate(verdict({ decision: "review", verdict: "hindsight_leak", confidence: 0.8 }), flags).action).toBe("reject");
  });

  it("never auto-publishes sources that force review", () => {
    expect(decideCandidate(verdict(), { ...flags, forceReview: true }).action).toBe("review");
    expect(sourceForcesReview("podcast", {})).toBe(true);
    expect(sourceForcesReview("podcast", { expertIsHost: true })).toBe(false);
    expect(sourceForcesReview("x", {})).toBe(false);
  });

  it("round-trips batch lines", () => {
    const line = JSON.parse(buildBatchLine("cand-1", { authorName: "A", authorHandle: "a", sourceType: "x", sourceTimestamp: "2023-01-01T00:00:00Z", sourceText: "I think the Fed cuts by June", candidate: prediction() }, "gpt-5-mini"));
    expect(line.custom_id).toBe("cand-1");
    expect(line.url).toBe("/v1/chat/completions");
    expect(line.body.response_format.json_schema.strict).toBe(true);
    expect(line.body.messages[0].role).toBe("system");
    expect(line.body.reasoning_effort).toBe("low");

    const output = JSON.stringify({ custom_id: "cand-1", response: { status_code: 200, body: { choices: [{ message: { content: JSON.stringify(verdict()) } }], usage: { prompt_tokens: 900, completion_tokens: 80 } } }, error: null });
    const parsed = parseBatchOutputLine(output);
    expect(parsed?.verdict?.decision).toBe("approve");
    expect(parsed?.usage).toEqual({ inputTokens: 900, outputTokens: 80 });
    expect(parseBatchOutputLine(JSON.stringify({ custom_id: "x", response: { status_code: 500, body: {} }, error: null }))?.verdict).toBeNull();
  });

  it("bounds verifier context around the quote", () => {
    const text = `${"a".repeat(5000)} THE QUOTE ${"b".repeat(5000)}`;
    const context = verifierContext(text, "THE QUOTE", 100);
    expect(context).toContain("THE QUOTE");
    expect(context.length).toBeLessThan(300);
  });
});

describe("dedupe and budget", () => {
  it("dedupes repeated claims within a source, preferring hard predictions", () => {
    const take = prediction({ record_type: "take", imputation_note: "imputed", source_quote: "other quote" });
    const kept = dedupeWithinSource("e1", [take, prediction(), prediction()]);
    expect(kept).toHaveLength(1);
    expect(kept[0].record_type).toBe("prediction");
  });

  it("treats credit, auth, rate-limit and server errors as retryable provider outages", () => {
    expect(isProviderOutage(Object.assign(new Error("429 You have no credits remaining"), { status: 429 }))).toBe(true);
    expect(isProviderOutage(Object.assign(new Error("bad key"), { status: 401 }))).toBe(true);
    expect(isProviderOutage(Object.assign(new Error("boom"), { status: 503 }))).toBe(true);
    expect(isProviderOutage(Object.assign(new Error("bad request"), { status: 400 }))).toBe(false);
    expect(isProviderOutage(new Error("Model did not return valid JSON"))).toBe(false);
  });

  it("enforces hard caps", () => {
    const guard = new BudgetGuard("backfill", 1, 0.9);
    expect(guard.canSpend(0.05)).toBe(true);
    expect(guard.canSpend(0.2)).toBe(false);
    guard.add(0.1);
    expect(guard.remainingUsd).toBeCloseTo(0);
    expect(() => guard.assertCanSpend(0.01)).toThrow();
  });

  it("prices tokens with discounts", () => {
    expect(tokenCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, { input: 0.25, output: 2 }, 0.5)).toBeCloseTo(1.125);
  });
});
