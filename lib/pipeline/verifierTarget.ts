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
//
// The free path is a two-model panel (verifierPanel): a second, independent
// model on the open-model provider checks first, and the free tier is asked
// only if that one approves. A candidate is published only when both approve,
// with the lower of the two confidences counting against the 0.9 bar. A
// comparison against past OpenAI verdicts showed the free model alone
// approving non-predictions with uniformly high confidence.

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
  /** Stop starting new calls after this long; null = no budget. */
  runBudgetMs: number | null;
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
    // One retry and a short timeout: a free tier that is slow or stuck should
    // stop the run quickly (the rest wait for the next run), not stall it.
    compatibleClient ??= new OpenAI({ baseURL: env.VERIFIER_BASE_URL, apiKey: env.VERIFIER_API_KEY, maxRetries: 1, timeout: env.VERIFIER_TIMEOUT_MS });
    return {
      client: compatibleClient,
      model: env.VERIFIER_MODEL,
      provider: new URL(env.VERIFIER_BASE_URL).hostname,
      price: { input: env.VERIFIER_PRICE_INPUT_PER_MTOK_USD, output: env.VERIFIER_PRICE_OUTPUT_PER_MTOK_USD },
      supportsBatch: false,
      minIntervalMs: env.VERIFIER_MIN_INTERVAL_MS,
      maxPerRun: env.VERIFIER_MAX_PER_RUN,
      runBudgetMs: env.VERIFIER_RUN_BUDGET_MS,
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
    runBudgetMs: null,
  };
}

let secondaryClient: OpenAI | null = null;

/** The second, independent verifier for the free panel, or null if it can't be configured. */
function secondaryTarget(): VerifierTarget | null {
  const apiKey = env.VERIFIER_SECONDARY_API_KEY ?? env.OPEN_MODEL_API_KEY;
  if (!apiKey) return null;
  const baseURL = env.VERIFIER_SECONDARY_BASE_URL ?? env.OPEN_MODEL_BASE_URL;
  assertIndependent(env.VERIFIER_SECONDARY_MODEL);
  secondaryClient ??= new OpenAI({ baseURL, apiKey, maxRetries: 1, timeout: env.VERIFIER_TIMEOUT_MS });
  return {
    client: secondaryClient,
    model: env.VERIFIER_SECONDARY_MODEL,
    provider: new URL(baseURL).hostname,
    price: { input: env.VERIFIER_SECONDARY_PRICE_INPUT_PER_MTOK_USD, output: env.VERIFIER_SECONDARY_PRICE_OUTPUT_PER_MTOK_USD },
    supportsBatch: false,
    minIntervalMs: 0,
    maxPerRun: null,
    runBudgetMs: null,
  };
}

export type VerifierPanel = {
  /** Called in order; later members are asked only if every earlier one approved. */
  members: VerifierTarget[];
  label: string;
  supportsBatch: boolean;
  maxPerRun: number | null;
  runBudgetMs: number | null;
};

/**
 * The verifiers a candidate must pass. OpenAI is a panel of one. The free
 * verifier is always paired with a second, independent model and never
 * publishes alone; without that second model it is refused.
 */
export function verifierPanel(purpose: "publish" | "compare" = "publish"): VerifierPanel | null {
  const primary = verifierTarget(purpose);
  if (!primary) return null;
  if (primary.provider === "openai") {
    return { members: [primary], label: primary.model, supportsBatch: true, maxPerRun: null, runBudgetMs: null };
  }
  const secondary = secondaryTarget();
  if (!secondary) {
    throw new Error("The free verifier needs a second, independent model: set OPEN_MODEL_API_KEY (or VERIFIER_SECONDARY_API_KEY) so both must approve.");
  }
  if (sameModel(secondary.model, primary.model)) {
    throw new Error(`The two verifiers must be different models (both are ${primary.model}).`);
  }
  return {
    members: [secondary, primary],
    label: `${secondary.model} + ${primary.model}`,
    supportsBatch: false,
    maxPerRun: primary.maxPerRun,
    runBudgetMs: primary.runBudgetMs,
  };
}

const PANEL_CONFIDENCE_BAR = 0.9;

/** Whether one member's verdict lets the candidate go on to the next member. */
export function memberApproves(verdict: CascadeVerdict): boolean {
  return verdict.decision === "approve" && verdict.verdict === "faithful" && verdict.confidence >= PANEL_CONFIDENCE_BAR;
}

/**
 * One verdict for the panel: approve only if every member approved, at the
 * lowest member confidence; otherwise the first non-approving member's verdict.
 */
export function combineVerdicts(results: Array<{ model: string; verdict: CascadeVerdict }>): CascadeVerdict {
  const blocking = results.find((result) => !memberApproves(result.verdict));
  if (blocking) return { ...blocking.verdict, reason: `[${blocking.model}] ${blocking.verdict.reason}` };
  return {
    verdict: "faithful",
    decision: "approve",
    confidence: Math.min(...results.map((result) => result.verdict.confidence)),
    reason: results.map((result) => `[${result.model}] ${result.verdict.reason}`).join(" "),
  };
}

const lastCallAt = new WeakMap<VerifierTarget, number>();

/**
 * Run a candidate past the panel, pacing each member, stopping at the first
 * member that does not approve. Errors (rate limits, outages) propagate.
 */
export async function runPanel(panel: VerifierPanel, input: VerifierInput): Promise<{
  verdict: CascadeVerdict;
  members: Array<{ model: string; provider: string; verdict: CascadeVerdict; usage: { inputTokens: number; outputTokens: number }; costUsd: number }>;
}> {
  const members: Awaited<ReturnType<typeof runPanel>>["members"] = [];
  for (const target of panel.members) {
    const last = lastCallAt.get(target);
    if (last !== undefined && target.minIntervalMs > 0) {
      const wait = target.minIntervalMs - (Date.now() - last);
      if (wait > 0) await sleep(wait);
    }
    lastCallAt.set(target, Date.now());
    const { verdict, usage } = await callVerifier(target, input);
    const costUsd = (usage.inputTokens * target.price.input + usage.outputTokens * target.price.output) / 1_000_000;
    members.push({ model: target.model, provider: target.provider, verdict, usage, costUsd });
    if (!memberApproves(verdict)) break;
  }
  return { verdict: combineVerdicts(members), members };
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
  return env.VERIFIER_MODE === "sync" || !(verifierPanel()?.supportsBatch ?? false);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
