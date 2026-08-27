import { isIP } from "node:net";

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIpv6(hostname: string): boolean {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value) || value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.") || value.startsWith("::ffff:192.168.");
}

export function parseSafePublicUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Enter a valid URL."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https URLs are allowed.");
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not allowed.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") throw new Error("Local and metadata-service URLs are not allowed.");
  if (isIP(hostname) === 4 && isPrivateIpv4(hostname)) throw new Error("Private network URLs are not allowed.");
  if (isIP(hostname.replace(/^\[|\]$/g, "")) === 6 && isPrivateIpv6(hostname)) throw new Error("Private network URLs are not allowed.");
  return url;
}

export function parseXPostUrl(input: string): { handle: string; postId: string } | null {
  const url = parseSafePublicUrl(input);
  const hostname = url.hostname.toLowerCase();
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(hostname)) return null;
  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
  return match ? { handle: match[1], postId: match[2] } : null;
}
