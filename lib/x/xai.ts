// xAI Agent Tools discovery adapter.
//
// Uses the /v1/responses endpoint with server-side search tools to enumerate
// candidate predictions from a specific expert. Runs three tools in parallel:
//   - x_search: posts on X from the expert's own handle
//   - web_search: blog posts, Substacks, official writings authored by the expert
//   - news_search: news/interview articles that quote the expert
// Returns a structured list the ingestion pipeline can hand to source-specific
// verification (oEmbed for X, HTML fetch for web) and then to extraction.
//
// The adapter is offline-safe: with no XAI_API_KEY it throws a friendly error
// so the CLI can skip discovery cleanly. It never fabricates URLs or quotes,
// and records per-request cost + token usage so budget accounting can enforce
// weekly caps.

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
  /**
   * When true, only the x_search tool is enabled. Preserves the historical
   * X-only behavior for callers/tests that expect it. Defaults to false —
   * the daily job runs the full x+web+news sweep.
   */
  xOnly?: boolean;
};

/**
 * A prediction candidate returned by discovery. For X posts, postUrl/postId/
 * handle are populated (postUrl == sourceUrl) and sourceType='x'. For web
 * or news sources, sourceUrl is a canonical article URL, postUrl/postId are
 * empty strings, and sourceType is 'writing' (author's own site/Substack) or
 * 'interview' (published third-party article/transcript).
 */
export type XaiCandidate = {
  sourceType: "x" | "writing" | "interview";
  sourceUrl: string;
  /** X-only. Empty string for non-X candidates. */
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
  source_type: z.enum(["x", "writing", "interview"]),
  source_url: z.string(),
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
  name: "receipts_discovery",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates", "saturation_likely"],
    properties: {
      saturation_likely: {
        type: "boolean",
        description:
          "True if any search tool likely returned the maximum number of results and more predictions from this expert in this window may still exist.",
      },
      candidates: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "source_type",
            "source_url",
            "source_quote",
            "proposed_normalized_claim",
            "posted_at",
            "proposed_resolution_date",
            "proposed_resolution_criteria",
            "explicit_probability",
            "category",
            "falsifiability_rating",
          ],
          properties: {
            source_type: {
              type: "string",
              enum: ["x", "writing", "interview"],
              description:
                "x = post on X from the expert's own handle; writing = a piece the expert authored (Substack, personal blog, official essay); interview = a third-party article, transcript, or news piece that quotes the expert directly.",
            },
            source_url: {
              type: "string",
              description:
                "Canonical URL surfaced by one of the search tools. For source_type=x this MUST be https://x.com/<handle>/status/<id>. For writing/interview it MUST point to a specific article page (not a homepage, category page, or generic domain root). Never invent; only return URLs the tools actually cited.",
            },
            posted_at: {
              type: ["string", "null"],
              description: "ISO-8601 timestamp/date of the source if available.",
            },
            source_quote: {
              type: "string",
              description:
                "Exact contiguous substring from the source body containing the prediction. No paraphrasing, no ellipsis, no reformatting.",
            },
            proposed_normalized_claim: {
              type: "string",
              description:
                "Concise falsifiable rephrasing of the prediction. Do not invent numbers.",
            },
            proposed_resolution_date: {
              type: ["string", "null"],
              description:
                "ISO-8601 date when the prediction becomes resolvable, if the source specifies one.",
            },
            proposed_resolution_criteria: { type: ["string", "null"] },
            explicit_probability: {
              type: ["number", "null"],
              description:
                "Fill only if the source literally states a probability. Do not translate hedges into numbers.",
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

function buildSystemPrompt(xOnly: boolean): string {
  const surfaceLine = xOnly
    ? "Use the x_search tool to enumerate PREDICTIONS a specific X account posted in a given date window."
    : "Use the x_search, web_search, and news_search tools in parallel to enumerate PREDICTIONS the expert made in a given date window across X posts, their own writings (Substack, personal blog, official essays), and news articles / transcribed interviews that quote them directly.";
  const scopeExamples = xOnly
    ? "- x_search citations only."
    : [
        "- x_search: posts authored by the expert's own handle.",
        "- web_search: pages the expert authored themselves (their Substack, personal site, gatesnotes-style essay, official blog). Skip aggregators, LinkedIn homepages, and category/section index pages.",
        "- news_search: news articles or transcribed interviews that contain a direct verbatim quote from the expert making the prediction. The quote you record must be attributed to the expert in the article, not to a paraphrasing journalist.",
      ].join("\n");
  return [
    "You are a research analyst for Project Lighthouse, a public database of falsifiable expert predictions.",
    surfaceLine,
    "",
    "Every candidate you return must have three ingredients — no exceptions:",
    "  1. A concrete future outcome (specific person, entity, value, or event — not a vague direction or vibe).",
    "  2. A resolution date the source either states or clearly implies (an ISO date, a named future event, or a relative phrase like 'by 2027' / 'by the election' / 'within 12 months'). If you can't pin a defensible date, DO NOT return it.",
    "  3. Resolution criteria that name a specific measurable outcome or public record (a specific poll, index, government release, benchmark, court ruling, launch event, financial filing, etc.).",
    "",
    "Which tool for which candidate:",
    scopeExamples,
    "",
    "Hard rules:",
    "- Only return items the search tools actually surface as citations. Never invent URLs, quotes, or dates.",
    "- The source_url MUST be a specific article/post page. Reject any URL that is just a domain root, homepage, /blog, /articles, /category, /author, or similar index page.",
    "- The source_quote MUST be an exact contiguous substring of the source body. If you can't reproduce it exactly, skip the candidate.",
    "- Do not invent numeric probabilities. If the author does not state one, leave explicit_probability null.",
    "- Skip mood-forecasts (\"everyone will hate X\", \"an era of Y\", \"vibes are shifting\"). Skip opinions, aesthetic judgments, jokes, rhetorical questions, and reposts/paraphrases of others' predictions.",
    "- For interviews, the direct quote must be the expert speaking, not the journalist summarizing.",
    "- Skip X mirror sites (nitter.*, twitter-mirror.*, xcancel.*, threadreaderapp.*). For X sources, use canonical https://x.com/<handle>/status/<id> URLs only.",
    "- Prefer a small number of clean predictions over many marginal ones. The default answer is REJECT.",
    "",
    "If any tool returns the maximum number of results and the window plausibly contains more, set saturation_likely=true so the caller can split the window.",
    "Return AT MOST the number of candidates requested. If fewer clearly qualify, return fewer — returning zero is a valid, useful answer.",
    "Respond ONLY with a JSON object matching the schema. No prose, no code fences.",
  ].join("\n");
}

function buildUserPrompt(input: XaiDiscoveryInput): string {
  const handle = input.expertHandle.replace(/^@/, "");
  const cap = input.maxCandidates ?? env.XAI_MAX_CANDIDATES_PER_WINDOW;
  const surface = input.xOnly
    ? `posted by @${handle} on X`
    : `made by ${input.expertDisplayName} (X handle: @${handle}) across X, their own writings, and news/interview articles`;
  return [
    `Find falsifiable predictions ${surface}.`,
    `Time window: ${input.fromDate.slice(0, 10)} to ${input.toDate.slice(0, 10)} (UTC).`,
    input.xOnly
      ? `Only return posts authored by @${handle} in that window. Ignore quote-tweets of others unless the author makes a distinct new prediction of their own.`
      : `Only return items dated within that window where the prediction is attributable to ${input.expertDisplayName} in their own words (X post by @${handle}, a piece they authored, or a direct quotation from them in a news/interview article).`,
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
  // Multi-source (web_search + news_search) is gated behind an opt-in until
  // the exact Grok Agent Tools schema for those tool types is confirmed:
  // the first daily run with the initial schema returned HTTP 422 for all
  // 80 experts. Until XAI_ENABLE_MULTI_SOURCE=true is set, run x_search
  // only — the safe path that has been shipping candidates every day.
  const multiSourceEnabled = process.env.XAI_ENABLE_MULTI_SOURCE === "true";
  const xOnly = input.xOnly === true || !multiSourceEnabled;
  const fromDate = input.fromDate.slice(0, 10);
  const toDate = input.toDate.slice(0, 10);
  const xSearchTool = {
    type: "x_search" as const,
    allowed_x_handles: [handle],
    fromDate,
    toDate,
    maxResults: maxSearchResults,
    enable_image_understanding: false,
    enable_video_understanding: false,
  };
  // web_search / news_search cover Substacks, blogs, official essays, and
  // news/interview coverage. We do not restrict allowed_websites here: the
  // prompt tells the model to reject aggregators and index pages, and the
  // downstream verifier requires a working URL + exact-substring quote match,
  // so bad citations get dropped before insertion.
  const webSearchTool = {
    type: "web_search" as const,
    fromDate,
    toDate,
    maxResults: maxSearchResults,
  };
  const newsSearchTool = {
    type: "news_search" as const,
    fromDate,
    toDate,
    maxResults: maxSearchResults,
  };
  const tools = xOnly ? [xSearchTool] : [xSearchTool, webSearchTool, newsSearchTool];
  const body = {
    model: env.XAI_MODEL,
    input: [
      { role: "system", content: buildSystemPrompt(xOnly) },
      { role: "user", content: buildUserPrompt(input) },
    ],
    tools,
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

// Hosts we never accept as a web source: X mirror/proxy sites, thread-reader
// tools, and known aggregators that rehost content without stable URLs. The
// project rule is "never scrape X" and never trust unofficial mirrors, so
// candidates carrying these hosts are dropped even if the model claims the
// underlying quote is exact.
const BLOCKED_WEB_HOSTS = new Set([
  "nitter.net",
  "nitter.privacydev.net",
  "nitter.cz",
  "xcancel.com",
  "twitter-mirror.com",
  "threadreaderapp.com",
  "twstalker.com",
  "publish.twitter.com",
  "publish.x.com",
]);

// Path shapes that are almost certainly index/landing pages, not article
// pages. Rejecting these before the verifier saves a fetch + guarantees the
// stored source is a real permalink.
function looksLikeIndexPage(pathname: string): boolean {
  const trimmed = pathname.replace(/\/+$/, "");
  if (trimmed === "" || trimmed === "/") return true;
  // Root-of-section paths with no further segment: /blog, /articles, /news,
  // /category, /tag, /author, /the-batch. If there's a further path segment
  // (e.g. /blog/some-slug) we accept it.
  return /^\/(blog|articles?|news|category|tag|author|about|home|the-batch|posts|essays|writings|opinions?)\/?$/i.test(
    trimmed,
  );
}

function normalizeWebUrl(raw: string): { canonical: string; hostname: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_WEB_HOSTS.has(hostname)) return null;
  if (looksLikeIndexPage(parsed.pathname)) return null;
  // Drop fragments and tracking-only search params for dedupe stability. We
  // keep the query string when it's the article ID (many CMSes rely on it).
  parsed.hash = "";
  const drop = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"];
  for (const key of drop) parsed.searchParams.delete(key);
  return { canonical: parsed.toString(), hostname };
}

function normalizeCandidates(
  raw: Array<z.infer<typeof candidateSchema>>,
  expectedHandle: string,
): XaiCandidate[] {
  const expected = expectedHandle.replace(/^@/, "").toLowerCase();
  const seen = new Set<string>();
  const out: XaiCandidate[] = [];
  for (const item of raw) {
    if (item.source_type === "x") {
      const ref = canonicalizeXPostUrl(item.source_url);
      if (!ref) continue;
      if (ref.handle.toLowerCase() !== expected) continue;
      if (seen.has(ref.canonical)) continue;
      seen.add(ref.canonical);
      out.push({
        sourceType: "x",
        sourceUrl: ref.canonical,
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
      continue;
    }
    const web = normalizeWebUrl(item.source_url);
    if (!web) continue;
    if (seen.has(web.canonical)) continue;
    seen.add(web.canonical);
    out.push({
      sourceType: item.source_type,
      sourceUrl: web.canonical,
      postUrl: "",
      postId: "",
      handle: expected,
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
