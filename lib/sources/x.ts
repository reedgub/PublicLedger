import pLimit from "p-limit";
import { env } from "@/lib/env";
import { HttpError, withRetry } from "@/lib/http/retry";
import { buildXQuery, type XQueryFamily } from "@/lib/sources/x-query";
import { parseXSearchPage, type XSearchPage } from "@/lib/sources/x-parser";
import type { SourceRecord } from "@/lib/sources/types";

const X_ORIGIN = "https://api.x.com";

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
