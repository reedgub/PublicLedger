import { describe, expect, it } from "vitest";
import { parseBinaryOutcomePrices, parseProbability } from "@/lib/sources/polymarket-parser";
import { buildXQuery, encodeXQuery } from "@/lib/sources/x-query";
import { parseXSearchPage } from "@/lib/sources/x-parser";

describe("source adapters", () => {
  it("builds valid bounded X queries", () => {
    const query = buildXQuery("@sama", "forecast");
    expect(query).toContain("from:sama");
    expect(decodeURIComponent(encodeXQuery(query))).toBe(query);
  });

  it("parses X pagination metadata", () => {
    const page = parseXSearchPage({ data: [{ id: "1", text: "I predict..." }], meta: { next_token: "next" } });
    expect(page.meta?.next_token).toBe("next");
  });

  it("maps Polymarket outcomes by name rather than array order", () => {
    expect(parseBinaryOutcomePrices('["No","Yes"]', '["0.3","0.7"]')).toEqual({ yesProbability: 0.7, noProbability: 0.3 });
    expect(parseProbability("72")).toBe(0.72);
  });
});
