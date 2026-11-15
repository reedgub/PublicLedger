// X post URL parsing + canonicalization.
// IDs stay strings — a 64-bit Twitter snowflake exceeds Number precision.

export type XPostRef = {
  handle: string;
  postId: string;
  canonical: string;
};

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);

export function canonicalizeXPostUrl(input: string): XPostRef | null {
  if (typeof input !== "string" || input.length === 0) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!X_HOSTS.has(url.hostname.toLowerCase())) return null;
  // Path: /<handle>/status/<id> — reject i/status, intent, other things.
  const parts = url.pathname.split("/").filter(Boolean);
  const statusIndex = parts.indexOf("status");
  if (statusIndex < 1) return null;
  const handleSegment = parts[statusIndex - 1];
  const idSegment = parts[statusIndex + 1];
  if (!handleSegment || handleSegment.toLowerCase() === "i") return null;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handleSegment)) return null;
  if (!idSegment || !/^\d{5,25}$/.test(idSegment)) return null;
  return {
    handle: handleSegment,
    postId: idSegment,
    canonical: `https://x.com/${handleSegment}/status/${idSegment}`,
  };
}

// Author guard: verify a returned canonical URL matches the expected expert
// handle case-insensitively. Rejects hallucinations that attribute a post to
// the wrong account.
export function authorMatches(canonicalRef: XPostRef, expectedHandle: string): boolean {
  return canonicalRef.handle.toLowerCase() === expectedHandle.replace(/^@/, "").toLowerCase();
}
