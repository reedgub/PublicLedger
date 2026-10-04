// Substack source adapter — reads a publication's public RSS feed and each
// item's HTML body. Higher density of falsifiable claims than X, and every
// article is a stable canonical URL, which makes source_available drift much
// rarer than for tweets.
//
// This adapter is intentionally minimal and NOT wired into the main ingestion
// pipeline yet. Bring it online per-publication by pointing seed:substack at
// the RSS URL and mapping the publication to an expert slug.
//
// Verification model:
//   * RSS gives us title + publisher-supplied content:encoded HTML.
//   * We fetch the canonical article URL and re-derive plain text via cheerio,
//     because RSS sometimes truncates and sometimes carries stale HTML.
//   * exact_text stored on the source row is the article body plain text.
//   * source_quote extracted downstream MUST still be an exact contiguous
//     substring of that plain text (the existing validator enforces this).
//
// No scraping of anything behind auth. No image OCR. Free tier only.

import { load } from "cheerio";
import { fetchJson } from "@/lib/http/retry";
import type { SourceAdapter, SourceRecord } from "@/lib/sources/types";

export type SubstackAdapterOptions = {
  /** RSS feed URL, e.g. https://noahsmith.substack.com/feed */
  feedUrl: string;
  /** Expert handle to attribute posts to (matches experts.x_handle for now). */
  authorHandle: string;
  /** Ignore items older than this date. */
  since?: Date;
  /** Cap items pulled per run. */
  maxItems?: number;
};

type SubstackItem = {
  title: string;
  link: string;
  pubDate: string;
  contentEncoded: string;
};

const USER_AGENT = "PublicLedger/0.1 (+https://publicledger.dev)";

async function fetchRss(feedUrl: string): Promise<SubstackItem[]> {
  const response = await fetch(feedUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml" },
  });
  if (!response.ok) throw new Error(`Substack RSS ${response.status} for ${feedUrl}`);
  const xml = await response.text();
  const $ = load(xml, { xmlMode: true });
  const items: SubstackItem[] = [];
  $("item").each((_, node) => {
    const item = $(node);
    items.push({
      title: item.find("title").first().text(),
      link: item.find("link").first().text(),
      pubDate: item.find("pubDate").first().text(),
      contentEncoded: item.find("content\\:encoded").first().text() || item.find("description").first().text(),
    });
  });
  return items;
}

function htmlToPlainText(html: string): string {
  const $ = load(`<div id="__pl_root">${html}</div>`);
  // Drop presentational cruft that adds noise to source_quote matching.
  $("#__pl_root script, #__pl_root style, #__pl_root figure, #__pl_root aside").remove();
  const text = $("#__pl_root").text();
  return text.replace(/\r/g, "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function fetchArticleBody(link: string): Promise<string> {
  const html = await fetchJson<string>(link, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  }).catch(async () => {
    // fetchJson expects JSON; fall back to text.
    const response = await fetch(link, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    if (!response.ok) throw new Error(`Substack article ${response.status} for ${link}`);
    return response.text();
  });
  const $ = load(typeof html === "string" ? html : "");
  const article = $("div.body.markup, article, main").first();
  if (article.length === 0) return "";
  return htmlToPlainText(article.html() ?? "");
}

export const substackAdapter: SourceAdapter<SubstackAdapterOptions> = {
  sourceType: "substack",
  async fetch(options) {
    const items = await fetchRss(options.feedUrl);
    const since = options.since?.getTime() ?? 0;
    const capped = items
      .filter((item) => new Date(item.pubDate).getTime() >= since)
      .slice(0, options.maxItems ?? 25);
    const records: SourceRecord[] = [];
    for (const item of capped) {
      const bodyFromFeed = htmlToPlainText(item.contentEncoded);
      // Prefer the on-page body when it's meaningfully longer; RSS truncates.
      const canonical = await fetchArticleBody(item.link).catch(() => "");
      const exactText = canonical.length > bodyFromFeed.length ? canonical : bodyFromFeed;
      if (!exactText) continue;
      records.push({
        sourceType: "substack",
        externalId: item.link,
        canonicalPath: item.link,
        authorHandle: options.authorHandle,
        publishedAt: new Date(item.pubDate),
        exactText: `${item.title}\n\n${exactText}`,
        metadata: { feedUrl: options.feedUrl, title: item.title },
      });
    }
    return records;
  },
};
