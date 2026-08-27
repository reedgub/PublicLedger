export type XApiPost = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  conversation_id?: string;
  edit_history_tweet_ids?: string[];
  public_metrics?: Record<string, number>;
  referenced_tweets?: Array<{ type: string; id: string }>;
  lang?: string;
};

export type XSearchPage = {
  data?: XApiPost[];
  meta?: { next_token?: string; result_count?: number };
  includes?: { users?: Array<{ id: string; username: string; name: string; profile_image_url?: string }> };
};

export function parseXSearchPage(payload: unknown): XSearchPage {
  if (!payload || typeof payload !== "object") throw new Error("Invalid X search response");
  const page = payload as XSearchPage;
  if (page.data && !Array.isArray(page.data)) throw new Error("Invalid X data array");
  for (const post of page.data ?? []) {
    if (!post.id || typeof post.id !== "string" || typeof post.text !== "string") {
      throw new Error("Invalid X post record");
    }
  }
  return page;
}
