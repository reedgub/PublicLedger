import { describe, expect, it } from "vitest";
import { isDirectQuote, isExpertsOwnPage, xPostTimestamp } from "@/lib/sources/manualImport";
import { classifyPage } from "@/lib/sources/liveCheck";

describe("third-party attribution", () => {
  const article = [
    "Hayes sets bullish predictions as crypto stocks jump.",
    "Hayes expects Ethereum ETH rising from around $2.73K to $10K by the end of the year.",
    "“I think Bitcoin could reach $1 million by 2030,” Hayes said in an interview.",
    "He added that \"the most explosive rally will be late 2027, early 2028\" before stepping offstage.",
  ].join("\n");

  it("accepts words inside quotation marks", () => {
    expect(isDirectQuote(article, "Bitcoin could reach $1 million by 2030")).toBe(true);
    expect(isDirectQuote(article, "the most explosive rally will be late 2027, early 2028")).toBe(true);
    expect(isDirectQuote(article, "“I think Bitcoin could reach $1 million by 2030,”")).toBe(true);
  });

  it("rejects the writer's paraphrase", () => {
    expect(isDirectQuote(article, "Ethereum ETH rising from around $2.73K to $10K by the end of the year.")).toBe(false);
    expect(isDirectQuote(article, "Hayes said in an interview")).toBe(false);
  });

  it("rejects a quote that straddles quotation marks", () => {
    expect(isDirectQuote(article, "by 2030,” Hayes said")).toBe(false);
  });

  it("does not let a quotation in an earlier paragraph leak into the next", () => {
    const text = "He said “rates will fall.\nRates will rise next year according to analysts.";
    expect(isDirectQuote(text, "Rates will rise next year")).toBe(false);
  });

  it("recognises the expert's own pages by registered host or byline, never by default", () => {
    const expert = { name: "Larry Summers", ownUrls: ["https://larrysummers.substack.com/feed"] };
    expect(isExpertsOwnPage({ url: "https://www.larrysummers.substack.com/p/inflation", byline: null }, expert)).toBe(true);
    expect(isExpertsOwnPage({ url: "https://example.com/op-ed", byline: "Larry Summers" }, expert)).toBe(true);
    // Nicknames are not guessed: an unmatched byline fails closed.
    expect(isExpertsOwnPage({ url: "https://example.com/op-ed", byline: "Lawrence H. Summers" }, expert)).toBe(false);
    expect(isExpertsOwnPage({ url: "https://example.com/news", byline: "Jane Reporter" }, expert)).toBe(false);
    expect(isExpertsOwnPage({ url: "https://example.com/news", byline: null }, expert)).toBe(false);
  });
});

describe("X post ids", () => {
  it("decodes the posting time from the snowflake id", () => {
    const at = Date.UTC(2026, 0, 15, 12, 0, 0, 250);
    const id = (((BigInt(at) - BigInt(1288834974657)) << BigInt(22)) + BigInt(4095)).toString();
    expect(xPostTimestamp(id)?.toISOString()).toBe("2026-01-15T12:00:00.250Z");
    expect(xPostTimestamp("123")).toBeNull();
    expect(xPostTimestamp("not-a-number")).toBeNull();
  });
});

describe("source refresh classification", () => {
  const html = "<html><body><article><p>“There is a 70% chance we see a recession in 2027,” she wrote.</p></article></body></html>";

  it("treats 404 and 410 as gone and other failures as inconclusive", () => {
    expect(classifyPage(404, null, "https://e.com/a", ["x"]).state).toBe("gone");
    expect(classifyPage(410, null, "https://e.com/a", ["x"]).state).toBe("gone");
    expect(classifyPage(503, null, "https://e.com/a", ["x"]).state).toBe("unreachable");
    expect(classifyPage(403, null, "https://e.com/a", ["x"]).state).toBe("unreachable");
  });

  it("verifies quotes modulo typography and reports missing ones", () => {
    expect(classifyPage(200, html, "https://e.com/a", ["There is a 70% chance we see a recession in 2027"]).state).toBe("verified");
    expect(classifyPage(200, html, "https://e.com/a", ['"There is a 70% chance we see a recession in 2027,"'])).toEqual({ state: "verified" });
    expect(classifyPage(200, html, "https://e.com/a", ["There is a 90% chance we see a recession in 2027"])).toEqual({
      state: "quote_missing",
      missing: ["There is a 90% chance we see a recession in 2027"],
    });
  });
});
