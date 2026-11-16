import { describe, expect, it } from "vitest";
import { sameModel } from "@/lib/pipeline/verifierTarget";

describe("verifier independence", () => {
  it("treats provider prefixes and case as the same model", () => {
    expect(sameModel("Qwen/Qwen3-32B", "qwen3-32b")).toBe(true);
    expect(sameModel("models/gemini-2.5-flash", "gemini-2.5-flash")).toBe(true);
  });

  it("tells different models apart", () => {
    expect(sameModel("Qwen/Qwen3-32B", "gemini-2.5-flash")).toBe(false);
    expect(sameModel("gpt-5-mini", "gpt-5")).toBe(false);
  });
});

describe("callVerifier", () => {
  const input = {
    authorName: "Test Expert", authorHandle: "test", sourceType: "x", sourceTimestamp: "2026-01-01T00:00:00.000Z",
    sourceText: "Rates will be below 3% by the end of 2027.",
    candidate: {
      normalized_claim: "Rates below 3% by end of 2027.", source_quote: "Rates will be below 3% by the end of 2027.", resolution_date: "2027-12-31",
      resolution_criteria: "Fed funds upper bound below 3%.", explicit_probability: null, confidence_language: null, category: "economy-rates",
      extraction_confidence: 0.9, falsifiability_score: 0.9, source_fidelity_score: 0.9, record_type: "prediction", imputation_note: null,
    },
  } as unknown as Parameters<typeof import("@/lib/pipeline/verifierTarget").callVerifier>[1];
  const verdict = { verdict: "faithful", decision: "approve", confidence: 0.95, reason: "Quote matches the claim." };

  function fakeTarget(responses: Array<() => unknown>) {
    const calls: Array<Record<string, unknown>> = [];
    const client = { chat: { completions: { create: async (body: Record<string, unknown>) => { calls.push(body); return responses[calls.length - 1](); } } } };
    return { calls, target: { client, model: "gemini-test", provider: "test", price: { input: 0, output: 0 }, supportsBatch: false, minIntervalMs: 0, maxPerRun: 10, runBudgetMs: null } as never };
  }

  it("falls back to JSON mode when strict schemas are unsupported, and strips code fences", async () => {
    const { callVerifier } = await import("@/lib/pipeline/verifierTarget");
    const { calls, target } = fakeTarget([
      () => { throw Object.assign(new Error("400 Invalid argument: response_format json_schema is not supported"), { status: 400 }); },
      () => ({ choices: [{ message: { content: "```json\n" + JSON.stringify(verdict) + "\n```" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    ]);
    const result = await callVerifier(target, input);
    expect(result.verdict.decision).toBe("approve");
    expect((calls[1].response_format as { type: string }).type).toBe("json_object");
  });

  it("refuses a malformed verdict instead of publishing", async () => {
    const { callVerifier } = await import("@/lib/pipeline/verifierTarget");
    const { target } = fakeTarget([() => ({ choices: [{ message: { content: JSON.stringify({ decision: "approve" }) } }] })]);
    await expect(callVerifier(target, input)).rejects.toThrow();
  });

  it("does not hide a billing refusal behind the fallback", async () => {
    const { callVerifier } = await import("@/lib/pipeline/verifierTarget");
    const { calls, target } = fakeTarget([() => { throw Object.assign(new Error("400 Billing hard limit has been reached"), { status: 400 }); }]);
    await expect(callVerifier(target, input)).rejects.toThrow("Billing");
    expect(calls).toHaveLength(1);
  });
});

describe("two-model panel", () => {
  const approve = (confidence: number, reason = "ok") => ({ verdict: "faithful" as const, decision: "approve" as const, confidence, reason });
  const input = {
    authorName: "Test Expert", authorHandle: "test", sourceType: "x", sourceTimestamp: "2026-01-01T00:00:00.000Z",
    sourceText: "Rates will be below 3% by the end of 2027.",
    candidate: {
      normalized_claim: "Rates below 3% by end of 2027.", source_quote: "Rates will be below 3% by the end of 2027.", resolution_date: "2027-12-31",
      resolution_criteria: "Fed funds upper bound below 3%.", explicit_probability: null, confidence_language: null, category: "economy-rates",
      extraction_confidence: 0.9, falsifiability_score: 0.9, source_fidelity_score: 0.9, record_type: "prediction", imputation_note: null,
    },
  } as never;

  function member(model: string, verdicts: unknown[]) {
    let i = 0;
    const calls = { count: 0 };
    const client = { chat: { completions: { create: async () => { calls.count += 1; return { choices: [{ message: { content: JSON.stringify(verdicts[i++]) } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }; } } } };
    return { calls, target: { client, model, provider: model, price: { input: 0, output: 0 }, supportsBatch: false, minIntervalMs: 0, maxPerRun: null, runBudgetMs: null } };
  }

  it("publishes only when every member approves, at the lowest confidence", async () => {
    const { combineVerdicts } = await import("@/lib/pipeline/verifierTarget");
    const both = combineVerdicts([{ model: "a", verdict: approve(0.93) }, { model: "b", verdict: approve(0.99) }]);
    expect(both.decision).toBe("approve");
    expect(both.confidence).toBe(0.93);
    const oneLow = combineVerdicts([{ model: "a", verdict: approve(0.85, "unsure") }, { model: "b", verdict: approve(0.99) }]);
    expect(oneLow.confidence).toBe(0.85);
    expect(oneLow.reason).toContain("[a] unsure");
    const oneRejects = combineVerdicts([{ model: "a", verdict: approve(0.95) }, { model: "b", verdict: { verdict: "not_prediction", decision: "reject", confidence: 1, reason: "hedge" } }]);
    expect(oneRejects.decision).toBe("reject");
    expect(oneRejects.reason).toBe("[b] hedge");
  });

  it("never asks the free tier when the first model rejects", async () => {
    const { runPanel } = await import("@/lib/pipeline/verifierTarget");
    const first = member("llama", [{ verdict: "overstated", decision: "reject", confidence: 0.9, reason: "hedged" }]);
    const second = member("gemini", [approve(1)]);
    const result = await runPanel({ members: [first.target, second.target], label: "llama + gemini", supportsBatch: false, maxPerRun: null, runBudgetMs: null } as never, input);
    expect(result.verdict.decision).toBe("reject");
    expect(second.calls.count).toBe(0);
    expect(result.members).toHaveLength(1);
  });

  it("asks the second model when the first approves, and combines both", async () => {
    const { runPanel } = await import("@/lib/pipeline/verifierTarget");
    const first = member("llama", [approve(0.92)]);
    const second = member("gemini", [approve(1)]);
    const result = await runPanel({ members: [first.target, second.target], label: "llama + gemini", supportsBatch: false, maxPerRun: null, runBudgetMs: null } as never, input);
    expect(second.calls.count).toBe(1);
    expect(result.verdict).toMatchObject({ decision: "approve", confidence: 0.92 });
  });
});
