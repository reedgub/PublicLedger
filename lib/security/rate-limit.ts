// In-process token-bucket rate limiter.
//
// Best-effort: state lives in-memory, so a serverless instance seeing a burst
// of requests from one IP will throttle within that instance but a different
// instance sees a fresh bucket. For the surfaces this protects — /api/search
// autocomplete typing — the intent is to blunt naive DoS from a single client,
// not to enforce a hard fair-share across the fleet. Persistent per-IP quotas
// belong on the CDN or a shared Redis when we grow into them.

import { createHash } from "node:crypto";
import { env } from "@/lib/env";

type Bucket = { tokens: number; lastRefillMs: number };

export type RateLimitConfig = {
  capacity: number;
  refillPerSecond: number;
};

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000; // Cheap cap; oldest are evicted when we exceed it.

export function requestIpHash(request: Request): string {
  const forwarded =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return createHash("sha256").update(`${env.SUBMISSION_HASH_SALT}:${forwarded}`).digest("hex");
}

export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const composite = `${config.capacity}:${config.refillPerSecond}:${key}`;
  let bucket = buckets.get(composite);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) evictOldest();
    bucket = { tokens: config.capacity, lastRefillMs: now };
    buckets.set(composite, bucket);
  } else {
    const elapsedSeconds = (now - bucket.lastRefillMs) / 1000;
    if (elapsedSeconds > 0) {
      bucket.tokens = Math.min(config.capacity, bucket.tokens + elapsedSeconds * config.refillPerSecond);
      bucket.lastRefillMs = now;
    }
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / config.refillPerSecond)) };
}

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const [key, bucket] of buckets) {
    if (bucket.lastRefillMs < oldestMs) {
      oldestMs = bucket.lastRefillMs;
      oldestKey = key;
    }
  }
  if (oldestKey) buckets.delete(oldestKey);
}
