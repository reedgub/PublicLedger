export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryable?: (error: unknown) => boolean;
};

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly headers: Headers,
    public readonly body?: string,
  ) {
    super(message);
  }
}

const defaultRetryable = (error: unknown) =>
  error instanceof HttpError ? error.status === 429 || error.status >= 500 : true;

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const retryable = options.retryable ?? defaultRetryable;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !retryable(error)) throw error;
      const rateLimitDelay =
        error instanceof HttpError
          ? parseRateLimitDelay(error.headers.get("retry-after"), error.headers.get("x-rate-limit-reset"))
          : null;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitter = Math.random() * exponential * 0.25;
      await new Promise((resolve) => setTimeout(resolve, rateLimitDelay ?? exponential + jitter));
    }
  }
  throw lastError;
}

function parseRateLimitDelay(retryAfter: string | null, resetAt: string | null): number | null {
  if (retryAfter && Number.isFinite(Number(retryAfter))) return Math.max(0, Number(retryAfter) * 1000);
  if (resetAt && Number.isFinite(Number(resetAt))) return Math.max(0, Number(resetAt) * 1000 - Date.now());
  return null;
}

export async function fetchJson<T>(url: string | URL, init?: RequestInit): Promise<T> {
  return withRetry(async () => {
    const response = await fetch(url, init);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new HttpError(`HTTP ${response.status} for ${new URL(url).hostname}`, response.status, response.headers, body.slice(0, 500));
    }
    return (await response.json()) as T;
  });
}
