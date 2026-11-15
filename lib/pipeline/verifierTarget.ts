// Which model serves stage 3 (frontier verification), and how to call it.
//
// Default: OpenAI (CASCADE_VERIFIER_MODEL), sync or Batch API.
// Alternative: any OpenAI-compatible provider (VERIFIER_API_KEY +
// VERIFIER_BASE_URL + VERIFIER_MODEL), e.g. Google's free Gemini tier. That
// path is sync only, paced, and capped per run, because free tiers are
// rate-limited per minute and per day.
//
// The verifier must be independent of the extractor: a different model
// checking the first model's work. Using the extraction model as the
// verifier is refused.

import OpenAI from "openai";
import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/ai/client";
import { cascadeVerdictSchema, buildVerifierRequestBody, type CascadeVerdict, type VerifierInput } from "@/lib/pipeline/verify";
import { extractionTarget } from "@/lib/pipeline/extract";

export type VerifierTarget = {
  client: OpenAI;
  model: string;
  provider: string;
  price: { input: number; output: number };
  supportsBatch: boolean;
  minIntervalMs: number;
  maxPerRun: number | null;
};

let compatibleClient: OpenAI | null = null;

/**
 * The verifier for a purpose, or null when none is configured. Throws on an unsafe configuration.
 * "publish" uses the alternative provider only once VERIFIER_PUBLISH=true (after a comparison run);
 * "compare" always uses it when its key is set.
 */
export function verifierTarget(purpose: "publish" | "compare" = "publish"): VerifierTarget | null {
  if (env.VERIFIER_API_KEY && (purpose === "compare" || env.VERIFIER_PUBLISH === "true")) {
    if (!env.VERIFIER_MODEL) {
      throw new Error("VERIFIER_API_KEY is set but VERIFIER_MODEL is not. Set it to a model id from the provider's console.");
    }
    assertIndependent(env.VERIFIER_MODEL);
    compatibleClient ??= new OpenAI({ baseURL: env.VERIFIER_BASE_URL, apiKey: env.VERIFIER_API_KEY, maxRetries: 3, timeout: 120_000 });
    return {
      client: compatibleClient,
      model: env.VERIFIER_MODEL,
      provider: new URL(env.VERIFIER_BASE_URL).hostname,
      price: { input: env.VERIFIER_PRICE_INPUT_PER_MTOK_USD, output: env.VERIFIER_PRICE_OUTPUT_PER_MTOK_USD },
      supportsBatch: false,
      minIntervalMs: env.VERIFIER_MIN_INTERVAL_MS,
      maxPerRun: env.VERIFIER_MAX_PER_RUN,
    };
  }
  if (!env.OPENAI_API_KEY) return null;
  assertIndependent(env.CASCADE_VERIFIER_MODEL);
  return {
    client: getOpenAIClient(),
    model: env.CASCADE_VERIFIER_MODEL,
    provider: "openai",
    price: { input: env.OPENAI_PRICE_INPUT_PER_MTOK_USD, output: env.OPENAI_PRICE_OUTPUT_PER_MTOK_USD },
    supportsBatch: true,
    minIntervalMs: 0,
    maxPerRun: null,
  };
}

/** Model ids compared without provider prefixes and case: "Qwen/Qwen3-32B" ~ "qwen3-32b". */
export function sameModel(a: string, b: string): boolean {
  const norm = (value: string) => value.toLowerCase().split("/").pop()!.replace(/^models\//, "").trim();
  return norm(a) === norm(b);
}

function assertIndependent(verifierModel: string) {
  const extractor = extractionTarget();
  if (extractor && sameModel(extractor.model, verifierModel)) {
    throw new Error(`The verifier (${verifierModel}) must be a different model from the extractor (${extractor.model}).`);
  }
}

/** True when the provider rejected the request shape (not the account): retry in plain JSON mode. */
function isSchemaUnsupported(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : "";
  return status === 400 && /response_format|json_schema|schema|unsupported|invalid argument/i.test(message) && !/billing|quota|credit/i.test(message);
}

const schemaFallback = new WeakMap<OpenAI, boolean>();

/**
 * One verification call. Uses strict JSON-schema output where the provider
 * supports it, and falls back to JSON mode (with the schema in the prompt)
 * where it doesn't. Either way the verdict is validated with zod; a malformed
 * verdict is an error, never a publish.
 */
export async function callVerifier(target: VerifierTarget, input: VerifierInput): Promise<{ verdict: CascadeVerdict; usage: { inputTokens: number; outputTokens: number } }> {
  const body = buildVerifierRequestBody(input, target.model);
  const send = (jsonMode: boolean) => target.client.chat.completions.create(jsonMode
    ? {
      model: body.model,
      messages: [
        body.messages[0],
        { role: "user", content: `${body.messages[1].content}\n\nRespond with ONLY a JSON object matching this JSON schema:\n${JSON.stringify(body.response_format.json_schema.schema)}` },
      ],
      response_format: { type: "json_object" },
    }
    : body);
  let response;
  if (schemaFallback.get(target.client)) response = await send(true);
  else {
    try {
      response = await send(false);
    } catch (error) {
      if (!isSchemaUnsupported(error)) throw error;
      schemaFallback.set(target.client, true);
      response = await send(true);
    }
  }
  const usage = { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 };
  const content = response.choices[0]?.message?.content ?? "";
  const json = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return { verdict: cascadeVerdictSchema.parse(JSON.parse(json)), usage };
}

/** Verify synchronously when asked to, or when the configured verifier has no Batch API. */
export function shouldVerifySynchronously(): boolean {
  return env.VERIFIER_MODE === "sync" || !(verifierTarget()?.supportsBatch ?? false);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
