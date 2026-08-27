import { describe, expect, it } from "vitest";
import { parseSafePublicUrl, parseXPostUrl } from "@/lib/security/urls";

describe("external URL safety", () => {
  it("accepts public http URLs", () => expect(parseSafePublicUrl("https://example.com/source").hostname).toBe("example.com"));
  it.each(["http://localhost/a", "http://127.0.0.1/a", "http://10.0.0.5/a", "http://192.168.1.1/a", "http://169.254.169.254/latest", "file:///etc/passwd", "https://user:pass@example.com"])("rejects unsafe URL %s", (url) => expect(() => parseSafePublicUrl(url)).toThrow());
  it("parses X post IDs without scraping", () => expect(parseXPostUrl("https://x.com/sama/status/123456789")).toEqual({ handle: "sama", postId: "123456789" }));
});
