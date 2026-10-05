// OpenAI-compatible chat client for open-weight models.
//
// Works with any provider that speaks the OpenAI chat-completions protocol:
// DeepInfra, Together, Groq, Fireworks, OpenRouter, or a self-hosted vLLM /
// Ollama server. When no open-model key is configured, the "extract" role
// falls back to OpenAI itself so the pipeline still runs (at higher cost).
//
// Open models don't all support strict JSON-schema decoding, so responses are
// requested as JSON objects, parsed leniently, validated with zod, and
// retried once with the validation error fed back.

import OpenAI from "openai";
import type { z } from "zod";
import { env } from "@/lib/env";

export type ModelRole = "screen" | "extract";

export type ModelTarget = {
  client: OpenAI;
  model: string;
  provider: string;
  price: { input: number; output: number };
};

const clients = new Map<string, OpenAI>();

function clientFor(baseURL: string, apiKey: string): OpenAI {
  const key = `${baseURL}::${apiKey.slice(0, 8)}`;
  let client = clients.get(key);
  if (!client) {
    client = new OpenAI({ baseURL, apiKey, maxRetries: 4, timeout: 120_000 });
    clients.set(key, client);
  }
  return client;
}

/** Resolve which endpoint/model serves a role, or null when nothing is configured. */
export function resolveModel(role: ModelRole): ModelTarget | null {
  if (env.OPEN_MODEL_API_KEY) {
    const model = role === "screen" ? env.OPEN_MODEL_SCREEN_MODEL : env.OPEN_MODEL_EXTRACT_MODEL;
    const price = role === "screen"
      ? { input: env.OPEN_MODEL_SCREEN_PRICE_INPUT_PER_MTOK_USD, output: env.OPEN_MODEL_SCREEN_PRICE_OUTPUT_PER_MTOK_USD }
      : { input: env.OPEN_MODEL_EXTRACT_PRICE_INPUT_PER_MTOK_USD, output: env.OPEN_MODEL_EXTRACT_PRICE_OUTPUT_PER_MTOK_USD };
    return { client: clientFor(env.OPEN_MODEL_BASE_URL, env.OPEN_MODEL_API_KEY), model, provider: new URL(env.OPEN_MODEL_BASE_URL).hostname, price };
  }
  // Screening without an open model is skipped (heuristic only) — paying
  // frontier prices to triage every post would defeat the purpose.
  if (role === "screen" || !env.OPENAI_API_KEY) return null;
  return {
    client: clientFor(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", env.OPENAI_API_KEY),
    model: env.OPENAI_MODEL,
    provider: "openai",
    price: { input: env.OPENAI_PRICE_INPUT_PER_MTOK_USD, output: env.OPENAI_PRICE_OUTPUT_PER_MTOK_USD },
  };
}

/** Pull the first JSON object out of a model reply (tolerates <think> blocks and code fences). */
export function extractJsonObject(raw: string): unknown {
  const withoutThinking = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fenced = withoutThinking.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : withoutThinking;
  const start = body.indexOf("{");
  if (start < 0) throw new Error("Model reply contained no JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < body.length; index += 1) {
    const char = body[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(body.slice(start, index + 1));
    }
  }
  throw new Error("Model reply contained an unterminated JSON object");
}

export type ChatJsonResult<T> = {
  data: T;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  provider: string;
  price: { input: number; output: number };
};

export async function chatJson<T>(
  target: ModelTarget,
  input: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number },
): Promise<ChatJsonResult<T>> {
  // Qwen3-family models think by default; thinking tokens are billed output.
  const user = /qwen3/i.test(target.model) ? `${input.user}\n\n/no_think` : input.user;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: input.system },
    { role: "user", content: user },
  ];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const isOpenAI = target.provider === "openai";
    const response = await target.client.chat.completions.create({
      model: target.model,
      messages,
      response_format: { type: "json_object" },
      ...(isOpenAI ? { max_completion_tokens: input.maxTokens ?? 2000 } : { max_tokens: input.maxTokens ?? 2000, temperature: 0 }),
    });
    usage.inputTokens += response.usage?.prompt_tokens ?? 0;
    usage.outputTokens += response.usage?.completion_tokens ?? 0;
    const content = response.choices[0]?.message?.content ?? "";
    try {
      const parsed = input.schema.safeParse(extractJsonObject(content));
      if (parsed.success) return { data: parsed.data, usage, model: target.model, provider: target.provider, price: target.price };
      lastError = new Error(parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    } catch (error) {
      lastError = error;
    }
    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: `Your reply was not valid: ${lastError instanceof Error ? lastError.message : "invalid JSON"}. Reply again with ONLY the corrected JSON object.` });
  }
  const error = new Error(`Model ${target.model} did not return valid JSON: ${lastError instanceof Error ? lastError.message : "unknown"}`);
  (error as Error & { usage?: typeof usage }).usage = usage;
  throw error;
}
