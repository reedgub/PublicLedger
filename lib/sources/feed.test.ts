import { describe, expect, it } from "vitest";
import { bylineMatches, htmlToPlainText, isAllowedByRobots, parseArticle, parseFeed, parseSitemap } from "@/lib/sources/feed";
import { assembleTranscript, parseDuration, parsePodcastFeed } from "@/lib/sources/podcast";

describe("feeds and sitemaps", () => {
  it("parses RSS and Atom items", () => {
    const rss = `<?xml version="1.0"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
      <item><title>Rates</title><link>https://ex.substack.com/p/rates</link><pubDate>Tue, 05 Mar 2024 10:00:00 GMT</pubDate><dc:creator>Jane Doe</dc:creator><content:encoded><![CDATA[<p>I expect cuts.</p>]]></content:encoded></item>
    </channel></rss>`;
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link rel="alternate" href="https://blog.ex/a"/><published>2023-01-02T00:00:00Z</published><author><name>Jane Doe</name></author><content type="html">&lt;p&gt;Hi&lt;/p&gt;</content></entry></feed>`;
    const [item] = parseFeed(rss);
    expect(item.link).toBe("https://ex.substack.com/p/rates");
    expect(item.author).toBe("Jane Doe");
    expect(item.publishedAt?.toISOString()).toBe("2024-03-05T10:00:00.000Z");
    expect(parseFeed(atom)[0].link).toBe("https://blog.ex/a");
  });

  it("parses sitemap indexes and url sets", () => {
    const index = parseSitemap(`<sitemapindex><sitemap><loc>https://ex.com/s1.xml</loc></sitemap></sitemapindex>`);
    expect(index.sitemaps).toEqual(["https://ex.com/s1.xml"]);
    const set = parseSitemap(`<urlset><url><loc>https://ex.com/p/a</loc><lastmod>2022-05-01</lastmod></url></urlset>`);
    expect(set.urls[0].loc).toBe("https://ex.com/p/a");
    expect(set.urls[0].lastmod?.getUTCFullYear()).toBe(2022);
  });

  it("honours robots.txt for * and our bot", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: OtherBot\nDisallow: /";
    expect(isAllowedByRobots(robots, "/p/post")).toBe(true);
    expect(isAllowedByRobots(robots, "/private/x")).toBe(false);
    expect(isAllowedByRobots(robots, "/private/ok/1")).toBe(true);
    expect(isAllowedByRobots("User-agent: PublicLedgerBot\nDisallow: /", "/anything")).toBe(false);
    expect(isAllowedByRobots("", "/anything")).toBe(true);
  });

  it("matches bylines to the expert and rejects guest authors", () => {
    expect(bylineMatches(null, "Larry Summers")).toBe(true);
    expect(bylineMatches("Lawrence H. Summers, Larry Summers", "Larry Summers")).toBe(true);
    expect(bylineMatches("François Chollet", "Francois Chollet")).toBe(true);
    expect(bylineMatches("Guest Writer", "Larry Summers")).toBe(false);
    expect(bylineMatches("Jane Summers", "Larry Summers")).toBe(false);
  });

  it("extracts article text, date and author from pages", () => {
    const html = `<html><head><title>T</title><meta property="article:published_time" content="2022-09-01T12:00:00Z">
      <script type="application/ld+json">{"@type":"Article","author":{"name":"Jane Doe"}}</script></head>
      <body><nav>menu</nav><article><p>I predict a recession by 2023.</p><p>Second para.</p><script>x()</script></article></body></html>`;
    const article = parseArticle(html, "https://ex.com/p/a");
    expect(article.publishedAt?.toISOString()).toBe("2022-09-01T12:00:00.000Z");
    expect(article.author).toBe("Jane Doe");
    expect(article.text).toContain("I predict a recession by 2023.");
    expect(article.text).toContain("\n\nSecond para.");
    expect(article.text).not.toContain("x()");
  });

  it("keeps paragraph boundaries when flattening HTML", () => {
    expect(htmlToPlainText("<p>One.</p><p>Two.</p>")).toBe("One.\n\nTwo.");
  });
});

describe("podcasts", () => {
  it("parses enclosures and durations", () => {
    const xml = `<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><item><title>Ep 1</title><guid>abc</guid>
      <pubDate>Mon, 01 May 2023 08:00:00 GMT</pubDate><enclosure url="https://cdn.ex/ep1.mp3" type="audio/mpeg"/><itunes:duration>1:02:03</itunes:duration></item>
      <item><title>No audio</title></item></channel></rss>`;
    const episodes = parsePodcastFeed(xml);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].durationSeconds).toBe(3723);
    expect(episodes[0].guid).toBe("abc");
    expect(parseDuration("3600")).toBe(3600);
    expect(parseDuration("bad")).toBeNull();
  });

  it("assembles transcripts with a sparse timeline", () => {
    const { text, timeline } = assembleTranscript([
      { start: 0, end: 5, text: " Hello there." },
      { start: 10, end: 15, text: "I think rates fall." },
      { start: 40, end: 45, text: "By 2025." },
    ]);
    expect(text).toBe("Hello there. I think rates fall. By 2025.");
    expect(timeline).toEqual([[0, 0], [text.indexOf("By 2025."), 40]]);
  });
});
