import OpenAI from "openai";
import { env, integrations } from "@/lib/env";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!integrations.openai) throw new Error("OPENAI_API_KEY is not configured.");
  client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 4, timeout: 60_000 });
  return client;
}
