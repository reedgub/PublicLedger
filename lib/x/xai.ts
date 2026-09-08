// xAI Agent Tools discovery adapter.
//
// Uses the /v1/responses endpoint with the server-side x_search tool to
// enumerate candidate predictions from a specific expert's X posts in a
// bounded date window. Returns a structured list the ingestion pipeline can
// hand to oEmbed verification and then to the existing extraction stages.
//
// This replaces the old Live Search (search_parameters on /v1/chat/completions),
// which xAI deprecated with HTTP 410 in favor of the Agent Tools API.
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
          "True if x_search likely returned the maximum number of results and more predictions from this expert in this window may still exist.",
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
                "Canonical https://x.com/<handle>/status/<id> URL from a search citation. Never invent; only return URLs surfaced by x_search.",
            },
            post_id: { type: ["string", "null"] },
            posted_at: {
              type: ["string", "null"],
              description: "ISO-8601 timestamp of the post if surfaced by x_search.",
            },
            source_quote: {
              type: "string",
              description:
                "Exact contiguous substring from the X post body containing the prediction. No paraphrasing.",
            },
            proposed_normalized_claim: {
              type: "string",
              description:
                "Concise falsifiable rephrasing of the prediction. Do not invent numbers.",
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
                "Fill only if the post literally states a probability. Do not translate hedges into numbers.",
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
    "Use the x_search tool to enumerate PREDICTIONS a specific X account posted in a given date window.",
    "",
    "Hard rules:",
    "- Only return posts x_search actually surfaces as citations. Never invent URLs, IDs, quotes, or dates.",
    "- The source_quote MUST be an exact contiguous substring of the post body. If you can't reproduce it exactly, skip the candidate.",
    "- Do not invent numeric probabilities. If the author does not state a probability, leave explicit_probability null.",
    "- A candidate must be a testable prediction with a resolvable outcome. Skip opinions, jokes, rhetorical questions, and reposts of others' predictions.",
    "- Skip replies where the prediction is not stated in the author's own words in this specific post.",
    "- Prefer high-signal predictions (specific outcomes, named entities, dated targets) over vague hedges.",
    "",
    "If x_search returns the maximum number of results and the window plausibly contains more, set saturation_likely=true so the caller can split the window.",
    "Return AT MOST the number of candidates requested. If fewer clearly qualify, return fewer.",
    "Respond ONLY with a JSON object matching the schema. No prose, no code fences.",
  ].join("\n");
}

function buildUserPrompt(input: XaiDiscoveryInput): string {
  const handle = input.expertHandle.replace(/^@/, "");
  const cap = input.maxCandidates ?? env.XAI_MAX_CANDIDATES_PER_WINDOW;
  return [
    `Find falsifiable predictions posted by @${handle} (${input.expertDisplayName}) on X.`,
    `Time window: ${input.fromDate.slice(0, 10)} to ${input.toDate.slice(0, 10)} (UTC).`,
    `Only return posts authored by @${handle} in that window. Ignore quote-tweets of others unless the author makes a distinct new prediction of their own.`,
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

  const url = new URL("responses", env.XAI_BASE_URL.endsWith("/") ? env.XAI_BASE_URL : `${env.XAI_BASE_URL}/`);
  const maxSearchResults = input.maxSearchResults ?? env.XAI_MAX_SEARCH_RESULTS;
  const handle = input.expertHandle.replace(/^@/, "");
  const body = {
    model: env.XAI_MODEL,
    input: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input) },
    ],
    tools: [
      {
        type: "x_search",
        allowed_x_handles: [handle],
        fromDate: input.fromDate.slice(0, 10),
        toDate: input.toDate.slice(0, 10),
        maxResults: maxSearchResults,
        enable_image_understanding: false,
        enable_video_understanding: false,
      },
    ],
    text: { format: { type: "json_schema", ...JSON_SCHEMA } },
  } as const;

  const startedAt = Date.now();
  const timeoutMs = 300_000;
  const payload = await withRetry(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.XAI_API_KEY}`,
            "User-Agent": "ProjectLighthouse/0.1 (+https://projectlighthouse.dev)",
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
      attempts: 2,
      // Retry on 429/5xx only. Timeouts and network errors are not retried:
      // retrying a genuinely slow agent-tool call wastes minutes for nothing.
      retryable: (error) =>
        error instanceof HttpError && (error.status === 429 || error.status >= 500),
    },
  );

  const usageBits = extractUsage(payload);
  const searchCalls = countSearchCalls(payload);
  const usage: XaiUsage = {
    model: payload.model ?? env.XAI_MODEL,
    inputTokens: usageBits.inputTokens,
    outputTokens: usageBits.outputTokens,
    reasoningTokens: usageBits.reasoningTokens,
    xSearchToolCalls: searchCalls,
    costUsd: estimateCost({
      input_tokens: usageBits.inputTokens,
      output_tokens: usageBits.outputTokens,
      reasoning_tokens: usageBits.reasoningTokens,
      num_sources_used: searchCalls,
    }),
    requestId: payload.id ?? null,
  };

  const rawText = extractOutputText(payload);
  const parsed = parseDiscoveryContent(rawText);
  const candidates = normalizeCandidates(parsed?.candidates ?? [], input.expertHandle);
  const saturationLikely =
    parsed?.saturation_likely === true ||
    (searchCalls >= maxSearchResults && candidates.length >= (input.maxCandidates ?? env.XAI_MAX_CANDIDATES_PER_WINDOW));

  const status: XaiDiscoveryStatus = parsed ? (saturationLikely ? "saturated" : "succeeded") : "failed";

  console.log(
    JSON.stringify({
      stage: "xai_discovery",
      run_id: input.runId ?? null,
      expert_handle: input.expertHandle,
      window: { from: input.fromDate, to: input.toDate },
      candidates: candidates.length,
      x_search_tool_calls: usage.xSearchToolCalls,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
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

type XaiOutputBlock = {
  type?: string;
  text?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  tool_calls?: Array<{ type?: string; name?: string }>;
  name?: string;
};

type XaiRawResponse = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<XaiOutputBlock>;
  choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    reasoning_tokens?: number;
    num_sources_used?: number;
    output_tokens_details?: { reasoning_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  citations?: string[];
};

function extractUsage(payload: XaiRawResponse): {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
} {
  const u = payload.usage ?? {};
  return {
    inputTokens: u.input_tokens ?? u.prompt_tokens ?? 0,
    outputTokens: u.output_tokens ?? u.completion_tokens ?? 0,
    reasoningTokens:
      u.output_tokens_details?.reasoning_tokens ??
      u.completion_tokens_details?.reasoning_tokens ??
      u.reasoning_tokens ??
      0,
  };
}

function countSearchCalls(payload: XaiRawResponse): number {
  if (typeof payload.usage?.num_sources_used === "number") return payload.usage.num_sources_used;
  if (Array.isArray(payload.citations)) return payload.citations.length;
  if (Array.isArray(payload.output)) {
    return payload.output.filter(
      (b) => b.type === "tool_use" || b.type === "server_tool_use" || b.type === "x_search",
    ).length;
  }
  return 0;
}

function extractOutputText(payload: XaiRawResponse): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }
  if (Array.isArray(payload.output)) {
    const parts: string[] = [];
    for (const block of payload.output) {
      if (typeof block.text === "string") parts.push(block.text);
      const content = block.content;
      if (typeof content === "string") parts.push(content);
      else if (Array.isArray(content)) {
        for (const c of content) if (typeof c.text === "string") parts.push(c.text);
      }
    }
    const joined = parts.join("");
    if (joined.trim().length > 0) return joined;
  }
  const legacy = payload.choices?.[0]?.message?.content;
  if (typeof legacy === "string") return legacy;
  if (Array.isArray(legacy)) return legacy.map((p) => p.text ?? "").join("");
  return "";
}

function parseDiscoveryContent(text: string): z.infer<typeof discoveryResponseSchema> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Some models still wrap JSON in ```json fences even when told not to.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const json = JSON.parse(stripped);
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
