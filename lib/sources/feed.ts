// Free text sources: RSS/Atom feeds (new posts) and sitemaps (full archives
// for backfill). Covers Substack, Ghost, WordPress, Medium-style blogs and
// most publication sites.
//
// Integrity rules applied here:
//   * Article text is re-derived from the canonical page, never from a
//     summary, so source quotes are exact substrings of what was published.
//   * Byline check: when a page declares an author that is not the expert,
//     it is skipped — multi-author blogs must not leak guest posts onto an
//     expert's record.
//   * robots.txt is respected; nothing behind a login is fetched.

import { load } from "cheerio";
import { withRetry, HttpError } from "@/lib/http/retry";
import type { SourceRecord } from "@/lib/sources/types";

export const FEED_USER_AGENT = "PublicLedgerBot/0.2 (+https://publicledger.dev/methodology)";

export type FeedItem = { title: string; link: string; publishedAt: Date | null; contentHtml: string; author: string | null };
export type SitemapEntry = { loc: string; lastmod: Date | null };

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

export function htmlToPlainText(html: string): string {
  const $ = load(`<div id="__pl_root">${html}</div>`);
  $("#__pl_root script, #__pl_root style, #__pl_root figure, #__pl_root aside, #__pl_root nav, #__pl_root form, #__pl_root button").remove();
  // Keep block boundaries as paragraph breaks so chunking can find them.
  $("#__pl_root p, #__pl_root li, #__pl_root h1, #__pl_root h2, #__pl_root h3, #__pl_root h4, #__pl_root blockquote, #__pl_root br").each((_, node) => {
    $(node).append("\n\n");
  });
  return $("#__pl_root").text().replace(/\r/g, "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function parseFeed(xml: string): FeedItem[] {
  const $ = load(xml, { xmlMode: true });
  const items: FeedItem[] = [];
  $("item").each((_, node) => {
    const item = $(node);
    items.push({
      title: item.children("title").first().text().trim(),
      link: item.children("link").first().text().trim() || item.children("guid").first().text().trim(),
      publishedAt: parseDate(item.children("pubDate").first().text() || item.children("dc\\:date").first().text()),
      contentHtml: item.children("content\\:encoded").first().text() || item.children("description").first().text(),
      author: item.children("dc\\:creator").first().text().trim() || item.children("author").first().text().trim() || null,
    });
  });
  $("entry").each((_, node) => {
    const entry = $(node);
    const link = entry.children("link[rel='alternate']").attr("href") ?? entry.children("link").first().attr("href") ?? "";
    items.push({
      title: entry.children("title").first().text().trim(),
      link: link.trim(),
      publishedAt: parseDate(entry.children("published").first().text() || entry.children("updated").first().text()),
      contentHtml: entry.children("content").first().text() || entry.children("summary").first().text(),
      author: entry.find("author > name").first().text().trim() || null,
    });
  });
  return items.filter((item) => /^https?:\/\//.test(item.link));
}

export function parseSitemap(xml: string): { urls: SitemapEntry[]; sitemaps: string[] } {
  const $ = load(xml, { xmlMode: true });
  const urls: SitemapEntry[] = [];
  const sitemaps: string[] = [];
  $("sitemapindex > sitemap").each((_, node) => {
    const loc = $(node).children("loc").first().text().trim();
    if (loc) sitemaps.push(loc);
  });
  $("urlset > url").each((_, node) => {
    const loc = $(node).children("loc").first().text().trim();
    if (loc) urls.push({ loc, lastmod: parseDate($(node).children("lastmod").first().text()) });
  });
  return { urls, sitemaps };
}

/** Minimal robots.txt check for the "*" and PublicLedgerBot groups. */
export function isAllowedByRobots(robotsTxt: string, path: string): boolean {
  let applies = false;
  let groupHasAgent = false;
  const disallows: string[] = [];
  const allows: string[] = [];
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!groupHasAgent) applies = false;
      groupHasAgent = true;
      if (value === "*" || value.toLowerCase().startsWith("publicledgerbot")) applies = true;
      continue;
    }
    groupHasAgent = false;
    if (!applies) continue;
    if (key === "disallow" && value) disallows.push(value);
    if (key === "allow" && value) allows.push(value);
  }
  const longest = (rules: string[]) => Math.max(-1, ...rules.filter((rule) => path.startsWith(rule.replace(/\*$/, ""))).map((rule) => rule.length));
  return longest(allows) >= longest(disallows);
}

const robotsCache = new Map<string, string>();

async function fetchText(url: string, accept: string): Promise<string> {
  return withRetry(async () => {
    const response = await fetch(url, { headers: { "User-Agent": FEED_USER_AGENT, Accept: accept }, redirect: "follow" });
    if (!response.ok) throw new HttpError(`HTTP ${response.status} for ${new URL(url).hostname}`, response.status, response.headers);
    return response.text();
  }, { attempts: 3 });
}

export async function allowedToFetch(url: string): Promise<boolean> {
  const parsed = new URL(url);
  if (!robotsCache.has(parsed.origin)) {
    robotsCache.set(parsed.origin, await fetchText(`${parsed.origin}/robots.txt`, "text/plain").catch(() => ""));
  }
  return isAllowedByRobots(robotsCache.get(parsed.origin) ?? "", parsed.pathname);
}

/** Normalised name tokens for byline matching. */
function nameTokens(value: string): string[] {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z]{2,}/g) ?? [];
}

/** True when a declared byline plausibly names the expert (or no byline is declared). */
export function bylineMatches(byline: string | null, expertName: string): boolean {
  if (!byline) return true;
  const expert = nameTokens(expertName);
  const declared = new Set(nameTokens(byline));
  if (expert.length === 0) return true;
  const last = expert[expert.length - 1];
  return declared.has(last) && expert.filter((token) => declared.has(token)).length >= Math.min(2, expert.length);
}

export type Article = { title: string; text: string; publishedAt: Date | null; author: string | null; canonicalUrl: string };

export function parseArticle(html: string, url: string): Article {
  const $ = load(html);
  let publishedAt = parseDate($("meta[property='article:published_time']").attr("content"))
    ?? parseDate($("time[datetime]").first().attr("datetime"));
  let author: string | null = $("meta[name='author']").attr("content")?.trim() || null;
  $("script[type='application/ld+json']").each((_, node) => {
    try {
      const data = JSON.parse($(node).text());
      for (const entry of Array.isArray(data) ? data : data["@graph"] ?? [data]) {
        publishedAt ??= parseDate(entry?.datePublished);
        if (!author && entry?.author) {
          const authors = Array.isArray(entry.author) ? entry.author : [entry.author];
          author = authors.map((item: { name?: string } | string) => (typeof item === "string" ? item : item?.name)).filter(Boolean).join(", ") || null;
        }
      }
    } catch { /* malformed JSON-LD is common; ignore */ }
  });
  const canonical = $("link[rel='canonical']").attr("href");
  const body = $("div.body.markup, article .entry-content, .post-content, .entry-content, article, main").first();
  return {
    title: $("meta[property='og:title']").attr("content")?.trim() || $("title").first().text().trim(),
    text: body.length ? htmlToPlainText(body.html() ?? "") : "",
    publishedAt,
    author,
    canonicalUrl: canonical && /^https?:\/\//.test(canonical) ? canonical : url,
  };
}

export async function fetchArticle(url: string): Promise<Article | null> {
  if (!(await allowedToFetch(url))) return null;
  return parseArticle(await fetchText(url, "text/html"), url);
}

/** Article URLs from a site's sitemap(s); recurses one sitemap-index level. */
export async function discoverSitemapUrls(sitemapUrl: string, options: { since?: Date; pathPattern?: RegExp; maxUrls?: number; maxSitemaps?: number } = {}): Promise<SitemapEntry[]> {
  const maxUrls = options.maxUrls ?? 5000;
  const maxSitemaps = options.maxSitemaps ?? 40;
  const root = parseSitemap(await fetchText(sitemapUrl, "application/xml,text/xml"));
  const entries = [...root.urls];
  for (const child of root.sitemaps.slice(0, maxSitemaps)) {
    if (entries.length >= maxUrls * 2) break;
    const parsed = parseSitemap(await fetchText(child, "application/xml,text/xml").catch(() => ""));
    entries.push(...parsed.urls);
  }
  return entries
    // lastmod is "last modified", not "published": only use it to skip pages
    // untouched since before the window.
    .filter((entry) => !options.since || !entry.lastmod || entry.lastmod >= options.since)
    .filter((entry) => !options.pathPattern || options.pathPattern.test(new URL(entry.loc).pathname))
    .slice(0, maxUrls);
}

function articleRecord(article: Article, link: string, options: { expertHandle: string | null; feedKind: "feed" | "sitemap"; sourceUrl: string }): SourceRecord | null {
  if (!article.text || !article.publishedAt) return null;
  return {
    sourceType: "writing",
    externalId: article.canonicalUrl || link,
    canonicalPath: article.canonicalUrl || link,
    authorHandle: options.expertHandle ?? undefined,
    publishedAt: article.publishedAt,
    exactText: article.title ? `${article.title}\n\n${article.text}` : article.text,
    metadata: { title: article.title, byline: article.author, collectedVia: options.feedKind, collectionUrl: options.sourceUrl },
  };
}

export type CollectStats = { fetched: number; skippedByline: number; skippedRobots: number; outOfWindow: number };

/** New/recent posts from an RSS or Atom feed. */
export async function collectFeed(options: { feedUrl: string; expertName: string; expertHandle: string | null; since?: Date; until?: Date; maxItems?: number }): Promise<{ records: SourceRecord[]; stats: CollectStats }> {
  const stats: CollectStats = { fetched: 0, skippedByline: 0, skippedRobots: 0, outOfWindow: 0 };
  const items = parseFeed(await fetchText(options.feedUrl, "application/rss+xml,application/atom+xml,application/xml,text/xml"));
  const records: SourceRecord[] = [];
  for (const item of items.slice(0, options.maxItems ?? 50)) {
    if (item.publishedAt && ((options.since && item.publishedAt < options.since) || (options.until && item.publishedAt >= options.until))) {
      stats.outOfWindow += 1;
      continue;
    }
    if (!bylineMatches(item.author, options.expertName)) {
      stats.skippedByline += 1;
      continue;
    }
    // Feed content is published for syndication, so it is used even when
    // robots.txt disallows fetching the page itself.
    const allowed = await allowedToFetch(item.link).catch(() => false);
    if (!allowed) stats.skippedRobots += 1;
    const page = allowed ? await fetchArticle(item.link).catch(() => null) : null;
    const fromFeed = htmlToPlainText(item.contentHtml);
    // Prefer the on-page body when it is meaningfully longer; feeds truncate.
    const article: Article = page && page.text.length >= fromFeed.length
      ? { ...page, publishedAt: page.publishedAt ?? item.publishedAt }
      : { title: item.title, text: fromFeed, publishedAt: item.publishedAt, author: item.author, canonicalUrl: item.link };
    if (!bylineMatches(article.author, options.expertName)) {
      stats.skippedByline += 1;
      continue;
    }
    const record = articleRecord(article, item.link, { expertHandle: options.expertHandle, feedKind: "feed", sourceUrl: options.feedUrl });
    if (record) {
      records.push(record);
      stats.fetched += 1;
    }
  }
  return { records, stats };
}

/** Historical posts from a sitemap, filtered to [since, until) by publish date. */
export async function collectSitemap(options: {
  sitemapUrl: string;
  expertName: string;
  expertHandle: string | null;
  since: Date;
  until: Date;
  pathPattern?: RegExp;
  maxArticles?: number;
  delayMs?: number;
}): Promise<{ records: SourceRecord[]; stats: CollectStats }> {
  const stats: CollectStats = { fetched: 0, skippedByline: 0, skippedRobots: 0, outOfWindow: 0 };
  const entries = await discoverSitemapUrls(options.sitemapUrl, { since: options.since, pathPattern: options.pathPattern, maxUrls: options.maxArticles ?? 2000 });
  const records: SourceRecord[] = [];
  for (const entry of entries) {
    if (!(await allowedToFetch(entry.loc))) {
      stats.skippedRobots += 1;
      continue;
    }
    const article = await fetchArticle(entry.loc).catch(() => null);
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    if (!article?.publishedAt) continue;
    if (article.publishedAt < options.since || article.publishedAt >= options.until) {
      stats.outOfWindow += 1;
      continue;
    }
    if (!bylineMatches(article.author, options.expertName)) {
      stats.skippedByline += 1;
      continue;
    }
    const record = articleRecord(article, entry.loc, { expertHandle: options.expertHandle, feedKind: "sitemap", sourceUrl: options.sitemapUrl });
    if (record) {
      records.push(record);
      stats.fetched += 1;
    }
  }
  return { records, stats };
}
