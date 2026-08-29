import { describe, expect, it } from "vitest";
import { inferCategory, normalizeMarketTopic } from "./normalize";

describe("inferCategory", () => {
  const cases: Array<[string, string]> = [
    // Crypto
    ["Will Bitcoin reach $200,000 before 2028?", "crypto"],
    ["Ethereum price above $10K by 2027", "crypto"],
    ["Solana market cap doubles?", "crypto"],
    // Sports (was the largest 'other' bucket)
    ["Bayer Leverkusen be the 2026-27 Bundesliga champion", "sports"],
    ["Cardiff City FC vs. Sheffield United FC: Both Teams to Score", "sports"],
    ["Exact Score: Aston Villa FC 0 - 2 Arsenal FC", "sports"],
    ["1st 5 Innings Spread: Baltimore Orioles (-1.5)", "sports"],
    ["Bradley Barcola join Arsenal", "sports"],
    ["Nikita Tszyu vs. Ben Mahoney", "sports"],
    ["Lille OSC vs. Paris Saint-Germain FC: O/U 2.5", "sports"],
    // Economy
    ["PPI YoY be 5.1% or more in August", "economy-rates"],
    ["Will the Fed cut rates at the next FOMC?", "economy-rates"],
    ["CPI comes in above 3%", "economy-rates"],
    // Markets/investing
    ["S&P 500 above 6000 by year end", "markets-investing"],
    ["Anthropic's valuation be at least $2.25T at the end of August 2026", "markets-investing"],
    // Politics
    ["Will Trump win the 2028 presidential election?", "politics-elections"],
    ["Democrats take the House in the midterms", "politics-elections"],
    // Geopolitics
    ["An international court find Israel or its leaders guilty of Genocide Before 2027", "geopolitics-conflict"],
    ["At least 100 ships transit the Strait of Hormuz on any day by August 31, 2026", "geopolitics-conflict"],
    ["Ukraine reclaims Crimea by 2027", "geopolitics-conflict"],
    // AI/tech
    ["GPT-5 launches before June", "ai-tech"],
    ["Nvidia announces new AI chip", "ai-tech"],
    // Energy/climate
    ["A hurricane make landfall in New Jersey by November 30, 2026", "energy-climate"],
    ["OPEC cuts production this quarter", "energy-climate"],
    // Science/space
    ["SpaceX Starship reaches orbit by end of year", "science-space"],
    ["FDA approves gene therapy", "science-space"],
    // Business
    ["Company X files for IPO before Q4", "business-startups"],
    ["Series B funding round closes", "business-startups"],
    // Media/culture
    ["Barbenheimer sequel opens at #1 at the box office", "media-culture"],
    ["Taylor Swift releases new album this month", "media-culture"],
    // Fallback
    ["Some random question with no keywords", "other"],
  ];

  it.each(cases)("categorizes %s as %s", (text, expected) => {
    expect(inferCategory(text)).toBe(expected);
  });
});

describe("normalizeMarketTopic", () => {
  it("cleans a Bitcoin price target into a canonical title", () => {
    const result = normalizeMarketTopic("Will Bitcoin reach $200,000 before December 31, 2027?");
    expect(result.category).toBe("crypto");
    expect(result.topicSlug).toMatch(/bitcoin/);
    expect(result.isUsefulTopic).toBe(true);
  });

  it("normalizes a presidential election market into a shared topic", () => {
    const a = normalizeMarketTopic("Will Trump win the 2028 US Presidential Election?");
    const b = normalizeMarketTopic("Will Newsom win the 2028 Presidential Election?");
    expect(a.topicSlug).toBe(b.topicSlug);
    expect(a.category).toBe("politics-elections");
  });

  it("drops questions too short to be useful", () => {
    const result = normalizeMarketTopic("Yes?");
    expect(result.isUsefulTopic).toBe(false);
  });
});
