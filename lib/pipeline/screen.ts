// Stage 1: cheap recall-oriented screen on a small open model.
//
// Many short units are packed into one request (default 20) so the fixed
// prompt cost is amortised. The screen only answers "could this contain a
// checkable forward-looking claim by the author?" — it is tuned to keep
// borderline items, because the later stages are strict and a false drop
// here is a prediction lost for good.

import { z } from "zod";
import { chatJson, resolveModel } from "@/lib/llm/openCompat";
import { tokenCostUsd } from "@/lib/pipeline/spend";

export const SCREEN_PROMPT_VERSION = "2026-10-05.1";

export const SCREEN_SYSTEM_PROMPT = `You triage short texts for a prediction-tracking database.
For each numbered item, decide whether it MIGHT contain a forward-looking claim made by the author about a specific future outcome (an event, number, person, product, market, election, policy, date) that could later be checked.

KEEP when the author predicts, forecasts, bets, gives odds, or confidently states something will or won't happen — even if vague on the deadline.
DROP when the item is only: news or facts about the past/present, questions, jokes, promotion, links, quoting someone else's prediction, pure opinion with no future outcome, or mood ("AI is unstoppable").
When unsure, KEEP.

Reply with JSON only: {"keep": [<item numbers to keep>]}`;

export const screenResponseSchema = z.object({ keep: z.array(z.coerce.number().int()).default([]) });

export type ScreenItem = { key: string; text: string };

export function buildScreenUserPrompt(items: ScreenItem[], maxCharsPerItem = 1200): string {
  return items
    .map((item, index) => `[${index + 1}] ${item.text.replace(/\s+/g, " ").trim().slice(0, maxCharsPerItem)}`)
    .join("\n\n");
}

/** Map the model's 1-based item numbers back to keys, ignoring anything out of range. */
export function keptKeys(items: ScreenItem[], keep: number[]): Set<string> {
  const kept = new Set<string>();
  for (const number of keep) {
    const item = items[number - 1];
    if (item) kept.add(item.key);
  }
  return kept;
}

export type ScreenOutcome = {
  kept: Set<string>;
  /** Keys that received a decision. Items missing here hit the budget cap and stay pending. */
  screened: Set<string>;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  model: string | null;
  provider: string | null;
  /** Keys that could not be screened (model error) — kept, to fail open on recall. */
  failOpen: number;
};

/**
 * Screen items in batches. With no open model configured, everything that
 * passed the stage 0 heuristic is kept (heuristic-only mode).
 */
export async function screenItems(
  items: ScreenItem[],
  options: { batchSize?: number; beforeCall?: (estimateUsd: number) => boolean } = {},
): Promise<ScreenOutcome> {
  const target = resolveModel("screen");
  const outcome: ScreenOutcome = { kept: new Set(), screened: new Set(), usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, model: target?.model ?? null, provider: target?.provider ?? null, failOpen: 0 };
  if (!target) {
    for (const item of items) {
      outcome.kept.add(item.key);
      outcome.screened.add(item.key);
    }
    return outcome;
  }
  const batchSize = options.batchSize ?? 20;
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const user = buildScreenUserPrompt(batch);
    // ~4 chars per token; output is a short id list.
    const estimate = tokenCostUsd({ inputTokens: (SCREEN_SYSTEM_PROMPT.length + user.length) / 4, outputTokens: 100 }, target.price);
    if (options.beforeCall && !options.beforeCall(estimate)) break;
    try {
      const result = await chatJson(target, { system: SCREEN_SYSTEM_PROMPT, user, schema: screenResponseSchema, maxTokens: 300 });
      outcome.usage.inputTokens += result.usage.inputTokens;
      outcome.usage.outputTokens += result.usage.outputTokens;
      outcome.costUsd += tokenCostUsd(result.usage, target.price);
      for (const key of keptKeys(batch, result.data.keep)) outcome.kept.add(key);
      for (const item of batch) outcome.screened.add(item.key);
    } catch (error) {
      const usage = (error as { usage?: { inputTokens: number; outputTokens: number } }).usage;
      if (usage) {
        outcome.usage.inputTokens += usage.inputTokens;
        outcome.usage.outputTokens += usage.outputTokens;
        outcome.costUsd += tokenCostUsd(usage, target.price);
      }
      outcome.failOpen += batch.length;
      for (const item of batch) {
        outcome.kept.add(item.key);
        outcome.screened.add(item.key);
      }
    }
  }
  return outcome;
}
