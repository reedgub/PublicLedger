import { describe, expect, it } from "vitest";
import { authorMatches, canonicalizeXPostUrl } from "@/lib/x/url";

describe("canonicalizeXPostUrl", () => {
  it("accepts x.com/handle/status/id", () => {
    expect(canonicalizeXPostUrl("https://x.com/nate_silver/status/1234567890")).toEqual({
      handle: "nate_silver",
      postId: "1234567890",
      canonical: "https://x.com/nate_silver/status/1234567890",
    });
  });

  it("normalizes twitter.com and mobile.twitter.com to x.com", () => {
    expect(canonicalizeXPostUrl("https://twitter.com/EndWokeness/status/9999999")?.canonical).toBe(
      "https://x.com/EndWokeness/status/9999999",
    );
    expect(canonicalizeXPostUrl("https://mobile.twitter.com/foo/status/1234567")?.canonical).toBe(
      "https://x.com/foo/status/1234567",
    );
  });

  it("strips query and fragment via reconstruction", () => {
    expect(canonicalizeXPostUrl("https://x.com/foo/status/1234567?s=20&t=abc")?.canonical).toBe(
      "https://x.com/foo/status/1234567",
    );
  });

  it("rejects i/status broadcast links", () => {
    expect(canonicalizeXPostUrl("https://x.com/i/status/1234567")).toBeNull();
  });

  it("rejects non-numeric ids", () => {
    expect(canonicalizeXPostUrl("https://x.com/foo/status/notanid")).toBeNull();
  });

  it("rejects non-X hosts", () => {
    expect(canonicalizeXPostUrl("https://example.com/foo/status/1234567")).toBeNull();
  });

  it("rejects bad handles", () => {
    expect(canonicalizeXPostUrl("https://x.com/way-too-long-handle-here/status/1234567")).toBeNull();
  });

  it("returns null for malformed inputs", () => {
    expect(canonicalizeXPostUrl("")).toBeNull();
    expect(canonicalizeXPostUrl("not a url")).toBeNull();
  });
});

describe("authorMatches", () => {
  it("is case-insensitive", () => {
    const ref = canonicalizeXPostUrl("https://x.com/NateSilver/status/1234567")!;
    expect(authorMatches(ref, "natesilver")).toBe(true);
    expect(authorMatches(ref, "@NateSilver")).toBe(true);
  });

  it("rejects a different handle", () => {
    const ref = canonicalizeXPostUrl("https://x.com/somebody/status/1234567")!;
    expect(authorMatches(ref, "elonmusk")).toBe(false);
  });
});
