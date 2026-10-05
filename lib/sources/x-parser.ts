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
  /** Full text of long-form posts; `text` is truncated for these. */
  note_tweet?: { text?: string };
};

/** The complete post text: long-form posts carry it in note_tweet. */
export function fullPostText(post: XApiPost): string {
  const note = post.note_tweet?.text;
  return note && note.length > post.text.length ? note : post.text;
}

export type XSearchPage = {
  data?: XApiPost[];
  meta?: { next_token?: string; result_count?: number; newest_id?: string; oldest_id?: string };
  errors?: Array<{ resource_id?: string; value?: string; title?: string; detail?: string; type?: string }>;
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
