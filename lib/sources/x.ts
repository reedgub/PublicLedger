import pLimit from "p-limit";
import { env } from "@/lib/env";
import { HttpError, withRetry } from "@/lib/http/retry";
import { buildCascadeXQuery, buildXQuery, type XQueryFamily } from "@/lib/sources/x-query";
import { fullPostText, parseXSearchPage, type XApiPost, type XSearchPage } from "@/lib/sources/x-parser";
import type { SourceRecord } from "@/lib/sources/types";

// Overridable only so integration tests can point at a local mock.
const X_ORIGIN = process.env.X_API_BASE_URL || "https://api.x.com";

export type XSearchOptions = {
  handle: string;
  start: Date;
  end: Date;
  maxPosts: number;
  mode: "full-archive" | "recent";
  families?: XQueryFamily[];
  topicKeywords?: string[];
};

export type XSearchResult = {
  records: SourceRecord[];
  modeUsed: "full-archive" | "recent";
  fellBackFromFullArchive: boolean;
};

async function xRequest<T>(path: string, searchParams?: URLSearchParams): Promise<T> {
  if (!env.X_BEARER_TOKEN) throw new Error("X_BEARER_TOKEN is not configured.");
  const url = new URL(path, X_ORIGIN);
  if (searchParams) url.search = searchParams.toString();
  return withRetry(async () => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new HttpError(`X API returned ${response.status}`, response.status, response.headers, body.slice(0, 500));
    }
    return (await response.json()) as T;
  });
}

export async function resolveXUser(handle: string): Promise<{
  id: string;
  username: string;
  name: string;
  profileImageUrl: string | null;
} | null> {
  const safeHandle = handle.replace(/^@/, "");
  const payload = await xRequest<{ data?: { id: string; username: string; name: string; profile_image_url?: string } }>(
    `/2/users/by/username/${encodeURIComponent(safeHandle)}`,
    new URLSearchParams({ "user.fields": "id,name,username,profile_image_url" }),
  );
  return payload.data
    ? { id: payload.data.id, username: payload.data.username, name: payload.data.name, profileImageUrl: payload.data.profile_image_url ?? null }
    : null;
}

export async function fetchXPostById(postId: string, expectedHandle?: string): Promise<SourceRecord | null> {
  if (!/^\d+$/.test(postId)) throw new Error("Invalid X post ID");
  const payload = await xRequest<{
    data?: import("@/lib/sources/x-parser").XApiPost;
    includes?: { users?: Array<{ id: string; username: string }> };
  }>(
    `/2/tweets/${postId}`,
    new URLSearchParams({
      "tweet.fields": "id,text,author_id,created_at,conversation_id,edit_history_tweet_ids,public_metrics,referenced_tweets,lang",
      expansions: "author_id",
      "user.fields": "id,name,username,profile_image_url",
    }),
  );
  if (!payload.data?.created_at) return null;
  const user = payload.includes?.users?.find((item) => item.id === payload.data?.author_id);
  const authorHandle = user?.username ?? expectedHandle?.replace(/^@/, "");
  return {
    sourceType: "x",
    externalId: payload.data.id,
    authorExternalId: payload.data.author_id,
    authorHandle,
    publishedAt: new Date(payload.data.created_at),
    exactText: payload.data.text,
    canonicalPath: authorHandle ? `/${authorHandle}/status/${payload.data.id}` : `/i/status/${payload.data.id}`,
    metadata: {
      conversationId: payload.data.conversation_id,
      editHistoryTweetIds: payload.data.edit_history_tweet_ids,
      publicMetrics: payload.data.public_metrics,
      referencedTweets: payload.data.referenced_tweets,
      lang: payload.data.lang,
    },
  };
}

async function searchFamily(options: XSearchOptions, family: XQueryFamily, mode: "full-archive" | "recent"): Promise<XSearchPage[]> {
  const path = mode === "full-archive" ? "/2/tweets/search/all" : "/2/tweets/search/recent";
  const query = buildXQuery(options.handle, family, family === "topic" ? options.topicKeywords : []);
  const pages: XSearchPage[] = [];
  let nextToken: string | undefined;
  let count = 0;
  do {
    const params = new URLSearchParams({
      query,
      max_results: String(Math.min(100, Math.max(10, options.maxPosts - count))),
      start_time: options.start.toISOString(),
      end_time: options.end.toISOString(),
      "tweet.fields": "id,text,author_id,created_at,conversation_id,edit_history_tweet_ids,public_metrics,referenced_tweets,lang",
      expansions: "author_id",
      "user.fields": "id,name,username,profile_image_url",
    });
    if (nextToken) params.set("next_token", nextToken);
    const page = parseXSearchPage(await xRequest<unknown>(path, params));
    pages.push(page);
    count += page.data?.length ?? 0;
    nextToken = page.meta?.next_token;
  } while (nextToken && count < options.maxPosts);
  return pages;
}

function pagesToRecords(pages: XSearchPage[], handle: string): SourceRecord[] {
  const seen = new Set<string>();
  const records: SourceRecord[] = [];
  for (const page of pages) {
    for (const post of page.data ?? []) {
      if (seen.has(post.id) || !post.created_at) continue;
      seen.add(post.id);
      records.push({
        sourceType: "x",
        externalId: post.id,
        authorExternalId: post.author_id,
        authorHandle: handle.replace(/^@/, ""),
        publishedAt: new Date(post.created_at),
        exactText: post.text,
        canonicalPath: `/${handle.replace(/^@/, "")}/status/${post.id}`,
        metadata: {
          conversationId: post.conversation_id,
          editHistoryTweetIds: post.edit_history_tweet_ids,
          publicMetrics: post.public_metrics,
          referencedTweets: post.referenced_tweets,
          lang: post.lang,
        },
      });
    }
  }
  return records;
}

export async function searchX(options: XSearchOptions): Promise<XSearchResult> {
  // Default path: one merged, window-aware query. Separate per-family queries
  // return (and bill) overlapping posts multiple times; callers that need the
  // legacy families can still pass them explicitly.
  if (!options.families && !options.topicKeywords?.length) {
    const runMerged = async (mode: "full-archive" | "recent") => {
      const query = buildCascadeXQuery(options.handle, { start: options.start, end: options.end, tier: "recall", includeReplies: true });
      return (await searchXQuery({ query, handle: options.handle, start: options.start, end: options.end, mode, maxPosts: options.maxPosts })).records;
    };
    try {
      return { records: await runMerged(options.mode), modeUsed: options.mode, fellBackFromFullArchive: false };
    } catch (error) {
      if (options.mode === "full-archive" && error instanceof HttpError && [401, 403].includes(error.status)) {
        return { records: await runMerged("recent"), modeUsed: "recent", fellBackFromFullArchive: true };
      }
      throw error;
    }
  }
  const families = options.families ?? ["forecast", "probability", "timing"];
  if (options.topicKeywords?.length) families.push("topic");
  const run = async (mode: "full-archive" | "recent") => {
    const limit = pLimit(1);
    const pageSets = await Promise.all(families.map((family) => limit(() => searchFamily(options, family, mode))));
    return pagesToRecords(pageSets.flat(), options.handle).slice(0, options.maxPosts);
  };

  try {
    return { records: await run(options.mode), modeUsed: options.mode, fellBackFromFullArchive: false };
  } catch (error) {
    if (options.mode === "full-archive" && error instanceof HttpError && [401, 403].includes(error.status)) {
      return { records: await run("recent"), modeUsed: "recent", fellBackFromFullArchive: true };
    }
    throw error;
  }
}

export const xSourceAdapter = { sourceType: "x" as const, fetch: searchX };

// ---------------------------------------------------------------------------
// Cost-accounted primitives for the cascade pipeline.
//
// Every function returns how many posts it read and how many requests it
// made so callers can book spend in public.pipeline_spend.
// ---------------------------------------------------------------------------

const CASCADE_TWEET_FIELDS =
  "id,text,note_tweet,author_id,created_at,conversation_id,edit_history_tweet_ids,public_metrics,referenced_tweets,lang";

export type XReadResult = { records: SourceRecord[]; postsRead: number; requests: number };

function postToRecord(post: XApiPost, handle: string): SourceRecord | null {
  if (!post.created_at) return null;
  const safeHandle = handle.replace(/^@/, "");
  const exactText = fullPostText(post);
  return {
    sourceType: "x",
    externalId: post.id,
    authorExternalId: post.author_id,
    authorHandle: safeHandle,
    publishedAt: new Date(post.created_at),
    exactText,
    canonicalPath: `/${safeHandle}/status/${post.id}`,
    metadata: {
      conversationId: post.conversation_id,
      editHistoryTweetIds: post.edit_history_tweet_ids,
      publicMetrics: post.public_metrics,
      referencedTweets: post.referenced_tweets,
      lang: post.lang,
      // Keep the truncated form too so the compliance refresh can recognise
      // a source stored by older code paths as unchanged.
      ...(exactText !== post.text ? { truncatedText: post.text, longForm: true } : {}),
    },
  };
}

/** Paged search for one server-side-filtered query. Stops at maxPosts. */
export async function searchXQuery(options: {
  query: string;
  handle: string;
  start: Date;
  end: Date;
  mode: "full-archive" | "recent";
  maxPosts: number;
}): Promise<XReadResult> {
  const path = options.mode === "full-archive" ? "/2/tweets/search/all" : "/2/tweets/search/recent";
  const seen = new Set<string>();
  const records: SourceRecord[] = [];
  let nextToken: string | undefined;
  let postsRead = 0;
  let requests = 0;
  do {
    const params = new URLSearchParams({
      query: options.query,
      max_results: String(Math.min(options.mode === "full-archive" ? 500 : 100, Math.max(10, options.maxPosts - postsRead))),
      start_time: options.start.toISOString(),
      end_time: options.end.toISOString(),
      "tweet.fields": CASCADE_TWEET_FIELDS,
    });
    if (nextToken) params.set("next_token", nextToken);
    const page = parseXSearchPage(await xRequest<unknown>(path, params));
    requests += 1;
    postsRead += page.data?.length ?? 0;
    for (const post of page.data ?? []) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      const record = postToRecord(post, options.handle);
      if (record) records.push(record);
    }
    nextToken = page.meta?.next_token;
  } while (nextToken && postsRead < options.maxPosts);
  return { records, postsRead, requests };
}

export type XCountResult = { total: number; buckets: Array<{ start: string; end: string; count: number }>; requests: number };

/**
 * Post counts for a query without reading posts. Used by --estimate to size
 * a backfill (and rank experts) before any billed post read happens.
 */
export async function countXQuery(options: {
  query: string;
  start: Date;
  end: Date;
  mode: "full-archive" | "recent";
  granularity?: "day" | "hour";
}): Promise<XCountResult> {
  const path = options.mode === "full-archive" ? "/2/tweets/counts/all" : "/2/tweets/counts/recent";
  const buckets: XCountResult["buckets"] = [];
  let total = 0;
  let requests = 0;
  let nextToken: string | undefined;
  do {
    const params = new URLSearchParams({
      query: options.query,
      start_time: options.start.toISOString(),
      end_time: options.end.toISOString(),
      granularity: options.granularity ?? "day",
    });
    if (nextToken) params.set("next_token", nextToken);
    const payload = await xRequest<{
      data?: Array<{ start: string; end: string; tweet_count: number }>;
      meta?: { total_tweet_count?: number; next_token?: string };
    }>(path, params);
    requests += 1;
    for (const bucket of payload.data ?? []) buckets.push({ start: bucket.start, end: bucket.end, count: bucket.tweet_count });
    total += payload.meta?.total_tweet_count ?? (payload.data ?? []).reduce((sum, bucket) => sum + bucket.tweet_count, 0);
    nextToken = payload.meta?.next_token;
  } while (nextToken);
  return { total, buckets, requests };
}

/**
 * Daily polling: an expert's own timeline since the last seen post id.
 * Excludes retweets and replies server-side, so they are never billed.
 * Note: the timeline endpoint only reaches the most recent ~3,200 posts —
 * use searchXQuery (full archive) for history.
 */
export async function fetchUserTimeline(options: {
  userId: string;
  handle: string;
  sinceId?: string | null;
  startTime?: Date;
  maxPosts: number;
  includeReplies?: boolean;
}): Promise<XReadResult & { newestId: string | null }> {
  if (!/^\d+$/.test(options.userId)) throw new Error("Invalid X user id");
  const records: SourceRecord[] = [];
  let paginationToken: string | undefined;
  let postsRead = 0;
  let requests = 0;
  let newestId: string | null = null;
  do {
    const params = new URLSearchParams({
      max_results: String(Math.min(100, Math.max(5, options.maxPosts - postsRead))),
      exclude: options.includeReplies ? "retweets" : "retweets,replies",
      "tweet.fields": CASCADE_TWEET_FIELDS,
    });
    if (options.sinceId) params.set("since_id", options.sinceId);
    else if (options.startTime) params.set("start_time", options.startTime.toISOString());
    if (paginationToken) params.set("pagination_token", paginationToken);
    const page = parseXSearchPage(await xRequest<unknown>(`/2/users/${options.userId}/tweets`, params));
    requests += 1;
    postsRead += page.data?.length ?? 0;
    if (!newestId && page.meta?.newest_id) newestId = page.meta.newest_id;
    for (const post of page.data ?? []) {
      const record = postToRecord(post, options.handle);
      if (record) records.push(record);
    }
    paginationToken = page.meta?.next_token;
  } while (paginationToken && postsRead < options.maxPosts);
  return { records, postsRead, requests, newestId: newestId ?? options.sinceId ?? null };
}

/**
 * Batch liveness/compliance lookup: up to 100 ids per request instead of one
 * request per post. Ids X reports as not found / not authorized are returned
 * in `missing`.
 */
export async function lookupXPosts(ids: string[]): Promise<{ found: Map<string, XApiPost>; missing: string[]; postsRead: number; requests: number }> {
  const found = new Map<string, XApiPost>();
  const missing: string[] = [];
  let postsRead = 0;
  let requests = 0;
  const valid = ids.filter((id) => /^\d+$/.test(id));
  for (let index = 0; index < valid.length; index += 100) {
    const chunk = valid.slice(index, index + 100);
    const page = parseXSearchPage(await xRequest<unknown>("/2/tweets", new URLSearchParams({ ids: chunk.join(","), "tweet.fields": CASCADE_TWEET_FIELDS })));
    requests += 1;
    postsRead += page.data?.length ?? 0;
    for (const post of page.data ?? []) found.set(post.id, post);
    for (const error of page.errors ?? []) {
      const id = error.resource_id ?? error.value;
      if (id && !found.has(id)) missing.push(id);
    }
  }
  return { found, missing, postsRead, requests };
}
