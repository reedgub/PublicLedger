// xAI Live Search discovery adapter.
//
// Uses grok-*'s server-side x_search source to enumerate candidate predictions
// from a specific expert's X posts in a bounded date window. Returns a
// structured list the ingestion pipeline can hand to oEmbed verification and
// then to the existing extraction/verification stages.
//
// The adapter is offline-safe: with no XAI_API_KEY it throws a friendly error
// so the CLI can skip discovery cleanly. It never scrapes X, never invents a
// post URL, and records per-request cost + token usage so budget accounting
// can enforce weekly caps.

import { z } from "zod";
import { env, integrations } from "@/lib/env";
import { HttpError, withRetry } from "@/lib/http/retry";
import { canonicalizeXPostUrl } from "@/lib/x/url";

export type XaiDiscoveryInput = {
  expertHandle: string;
  expertDisplayName: string;
  fromDate: string;
  toDate: string;
  maxCandidates?: number;
  maxSearchResults?: number;
  promptVersion?: string;
  runId?: string;
};

export type XaiCandidate = {
  postUrl: string;
  postId: string;
  handle: string;
  postedAt: string | null;
  sourceQuote: string;
  proposedNormalizedClaim: string;
  proposedResolutionDate: string | null;
  proposedResolutionCriteria: string | null;
  explicitProbability: number | null;
  category: string | null;
  falsifiabilityRating: number | null;
};

export type XaiUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  xSearchToolCalls: number;
  costUsd: number;
  requestId: string | null;
};

export type XaiDiscoveryStatus = "succeeded" | "saturated" | "failed";

export type XaiDiscoveryResult = {
  candidates: XaiCandidate[];
  saturationLikely: boolean;
  status: XaiDiscoveryStatus;
  usage: XaiUsage;
  raw: unknown;
};

export class XaiNotConfiguredError extends Error {
  constructor() {
    super("XAI_API_KEY is not configured; xAI discovery is disabled.");
  }
}

const candidateSchema = z.object({
  post_url: z.string(),
  post_id: z.string().optional().nullable(),
  posted_at: z.string().nullable().optional(),
  source_quote: z.string().min(1),
  proposed_normalized_claim: z.string().min(1),
  proposed_resolution_date: z.string().nullable().optional(),
  proposed_resolution_criteria: z.string().nullable().optional(),
  explicit_probability: z.number().min(0).max(1).nullable().optional(),
  category: z.string().nullable().optional(),
  falsifiability_rating: z.number().min(0).max(1).nullable().optional(),
});

const discoveryResponseSchema = z.object({
  candidates: z.array(candidateSchema).max(50),
  saturation_likely: z.boolean().optional().default(false),
});

const JSON_SCHEMA = {
  name: "receipts_x_discovery",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates", "saturation_likely"],
    properties: {
      saturation_likely: {
        type: "boolean",
        description:
          "True if the search likely returned the maximum number of results and more predictions from this expert in this window may still exist.",
      },
      candidates: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "post_url",
            "source_quote",
            "proposed_normalized_claim",
            "posted_at",
            "post_id",
            "proposed_resolution_date",
            "proposed_resolution_criteria",
            "explicit_probability",
            "category",
            "falsifiability_rating",
          ],
          properties: {
            post_url: {
              type: "string",
              description:
                "Canonical https://x.com/<handle>/status/<id> URL from a search citation. Never invent; only return URLs actually returned by x_search.",
            },
            post_id: { type: ["string", "null"] },
            posted_at: {
              type: ["string", "null"],
              description: "ISO-8601 timestamp of the post if surfaced by x_search.",
            },
            source_quote: {
              type: "string",
              description:
                "Exact contiguous substring from the X post body containing the prediction. No paraphrasing. Copy characters as they appear.",
            },
            proposed_normalized_claim: {
              type: "string",
              description:
                "Concise falsifiable rephrasing of the prediction (a downstream stage may replace this — do not invent numbers).",
            },
            proposed_resolution_date: {
              type: ["string", "null"],
              description:
                "ISO-8601 date when the prediction becomes resolvable, if the post specifies one.",
            },
            proposed_resolution_criteria: { type: ["string", "null"] },
            explicit_probability: {
              type: ["number", "null"],
              description:
                "Only fill this if the post literally states a probability. Do not translate hedges into numbers.",
            },
            category: { type: ["string", "null"] },
            falsifiability_rating: {
              type: ["number", "null"],
              description: "0..1 estimate of how testable this prediction is.",
            },
          },
        },
      },
    },
  },
} as const;

function buildSystemPrompt(): string {
  return [
    "You are a research analyst for Receipts, a public database of falsifiable expert predictions.",
    "You use the x_search tool to enumerate PREDICTIONS that a specific X account posted in a given date window.",
    "",
    "Hard rules:",
    "- Only return posts that x_search actually surfaces as citations. Never invent URLs, IDs, quotes, or dates.",
    "- The source_quote MUST be an exact contiguous substring of the post body. If you cannot reproduce it exactly, skip the candidate.",
    "- Do not invent numeric probabilities. If the author does not state a probability, leave explicit_probability null.",
    "- A candidate must be a testable prediction with a resolvable outcome. Skip opinions, jokes, rhetorical questions, reposts of others' predictions, and generic commentary.",
    "- Skip replies where the prediction is not stated in the author's own words in this specific post.",
    "- Prefer high-signal predictions (specific outcomes, named entities, dated targets) over vague hedges.",
    "",
    "If x_search returns the maximum number of results and the window plausibly contains more, set saturation_likely=true so the caller can split the window.",
    "Return AT MOST the number of candidates requested by the user; if fewer clearly qualify, return fewer.",
  ].join("\n");
}

function buildUserPrompt(input: XaiDiscoveryInput): string {
  const handle = input.expertHandle.replace(/^@/, "");
  const cap = input.maxCandidates ?? env.XAI_MAX_CANDIDATES_PER_WINDOW;
  return [
    `Find falsifiable predictions posted by @${handle} (${input.expertDisplayName}) on X.`,
    `Time window: ${input.fromDate} to ${input.toDate} (UTC, inclusive of from, exclusive of to).`,
    `Only return posts authored by @${handle} in that window. Ignore quote-tweets of others unless the author is making a distinct new prediction of their own.`,
    `Return at most ${cap} of the highest-quality candidates.`,
  ].join("\n");
}

function estimateCost(usage: {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  num_sources_used?: number;
}): number {
  const input = (usage.input_tokens ?? 0) * env.XAI_PRICE_INPUT_PER_MTOK_USD;
  const output = (usage.output_tokens ?? 0) * env.XAI_PRICE_OUTPUT_PER_MTOK_USD;
  const reasoning = (usage.reasoning_tokens ?? 0) * env.XAI_PRICE_OUTPUT_PER_MTOK_USD;
  const search = (usage.num_sources_used ?? 0) * env.XAI_PRICE_PER_SEARCH_SOURCE_USD;
  return (input + output + reasoning) / 1_000_000 + search;
}

export async function fetchXaiDiscovery(input: XaiDiscoveryInput): Promise<XaiDiscoveryResult> {
  if (!integrations.xai) throw new XaiNotConfiguredError();

  const url = new URL("chat/completions", env.XAI_BASE_URL.endsWith("/") ? env.XAI_BASE_URL : `${env.XAI_BASE_URL}/`);
  const maxSearchResults = input.maxSearchResults ?? env.XAI_MAX_SEARCH_RESULTS;
  const body = {
    model: env.XAI_MODEL,
    reasoning_effort: "low",
    max_tokens: 4000,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input) },
    ],
    response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
    search_parameters: {
      mode: "on",
      return_citations: true,
      from_date: input.fromDate.slice(0, 10),
      to_date: input.toDate.slice(0, 10),
      max_search_results: maxSearchResults,
      sources: [
        {
          type: "x",
          x_handles: [input.expertHandle.replace(/^@/, "")],
        },
      ],
    },
  } as const;

  const startedAt = Date.now();
  const payload = await withRetry(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.XAI_API_KEY}`,
            "User-Agent": "Receipts/0.1 (+https://receipts.app)",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new HttpError(`xAI ${response.status}`, response.status, response.headers, text.slice(0, 800));
        }
        return (await response.json()) as XaiRawResponse;
      } finally {
        clearTimeout(timer);
      }
    },
    {
      attempts: 3,
      retryable: (error) =>
        error instanceof HttpError ? error.status === 429 || error.status >= 500 : true,
    },
  );

  const usage: XaiUsage = {
    model: payload.model ?? env.XAI_MODEL,
    inputTokens: payload.usage?.prompt_tokens ?? payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? payload.usage?.output_tokens ?? 0,
    reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? payload.usage?.reasoning_tokens ?? 0,
    xSearchToolCalls: payload.usage?.num_sources_used ?? payload.citations?.length ?? 0,
    costUsd: estimateCost({
      input_tokens: payload.usage?.prompt_tokens ?? payload.usage?.input_tokens ?? 0,
      output_tokens: payload.usage?.completion_tokens ?? payload.usage?.output_tokens ?? 0,
      reasoning_tokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? payload.usage?.reasoning_tokens ?? 0,
      num_sources_used: payload.usage?.num_sources_used ?? payload.citations?.length ?? 0,
    }),
    requestId: payload.id ?? null,
  };

  const rawContent = payload.choices?.[0]?.message?.content;
  const parsed = parseDiscoveryContent(rawContent);
  const candidates = normalizeCandidates(parsed?.candidates ?? [], input.expertHandle);
  const saturationLikely =
    parsed?.saturation_likely === true ||
    (usage.xSearchToolCalls >= maxSearchResults && candidates.length >= (input.maxCandidates ?? env.XAI_MAX_CANDIDATES_PER_WINDOW));

  const status: XaiDiscoveryStatus = parsed ? (saturationLikely ? "saturated" : "succeeded") : "failed";

  console.log(
    JSON.stringify({
      stage: "xai_discovery",
      run_id: input.runId ?? null,
      expert_handle: input.expertHandle,
      window: { from: input.fromDate, to: input.toDate },
      candidates: candidates.length,
      x_search_tool_calls: usage.xSearchToolCalls,
      cost_usd: Number(usage.costUsd.toFixed(4)),
      duration_ms: Date.now() - startedAt,
      saturation_likely: saturationLikely,
      status,
    }),
  );

  return {
    candidates,
    saturationLikely,
    status,
    usage,
    raw: payload,
  };
}

type XaiRawResponse = {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    num_sources_used?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  citations?: string[];
};

function parseDiscoveryContent(
  content: string | Array<{ type: string; text?: string }> | undefined,
): z.infer<typeof discoveryResponseSchema> | null {
  if (!content) return null;
  const text = typeof content === "string" ? content : content.map((p) => p.text ?? "").join("");
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed);
    return discoveryResponseSchema.parse(json);
  } catch {
    return null;
  }
}

function normalizeCandidates(
  raw: Array<z.infer<typeof candidateSchema>>,
  expectedHandle: string,
): XaiCandidate[] {
  const expected = expectedHandle.replace(/^@/, "").toLowerCase();
  const seen = new Set<string>();
  const out: XaiCandidate[] = [];
  for (const item of raw) {
    const ref = canonicalizeXPostUrl(item.post_url);
    if (!ref) continue;
    if (ref.handle.toLowerCase() !== expected) continue;
    if (seen.has(ref.postId)) continue;
    seen.add(ref.postId);
    out.push({
      postUrl: ref.canonical,
      postId: ref.postId,
      handle: ref.handle,
      postedAt: item.posted_at ?? null,
      sourceQuote: item.source_quote,
      proposedNormalizedClaim: item.proposed_normalized_claim,
      proposedResolutionDate: item.proposed_resolution_date ?? null,
      proposedResolutionCriteria: item.proposed_resolution_criteria ?? null,
      explicitProbability: item.explicit_probability ?? null,
      category: item.category ?? null,
      falsifiabilityRating: item.falsifiability_rating ?? null,
    });
  }
  return out;
}
