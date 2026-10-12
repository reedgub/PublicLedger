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

/**
 * Comparison form of a post's text, ignoring how different code paths and
 * X endpoints render the same words: HTML entities (&amp;), whitespace and
 * line breaks, pic.twitter.com vs t.co media links, and the leading
 * @mentions X adds to replies. Words, numbers and links still have to match.
 */
export function comparablePostText(text: string): string {
  return text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/(?:https?:\/\/)?pic\.twitter\.com\//g, "t.co/")
    .replace(/https?:\/\/t\.co\//g, "t.co/")
    .replace(/^(?:\s*@\w{1,15})+\s+/, "")
    .replace(/\s+/g, "");
}

/** True when the stored text and the live post say the same thing. */
export function samePostText(stored: string | null, post: XApiPost): boolean {
  if (stored === null) return false;
  const current = comparablePostText(stored);
  return current === comparablePostText(fullPostText(post)) || current === comparablePostText(post.text);
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
