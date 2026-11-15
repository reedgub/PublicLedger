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
    return { calls, target: { client, model: "gemini-test", provider: "test", price: { input: 0, output: 0 }, supportsBatch: false, minIntervalMs: 0, maxPerRun: 10 } as never };
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
