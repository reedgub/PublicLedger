// Runs once when the Next.js server starts. Wraps global fetch to strip
// non-ASCII characters from outgoing HTTP header values.
//
// Node 22's undici enforces the WHATWG ByteString rule for header values
// (bytes only), and throws TypeError when a value contains a character with
// code point > 255. In production we've observed rare cases where a request-
// scoped Supabase client emits a header value with a bullet (U+2022) — likely
// via a downstream helper that reflects request context — and the whole
// server component tree hits the error boundary as a result. Sanitizing at
// the fetch layer prevents any such value from ever reaching undici.
//
// The stripped bytes were already not going to survive an HTTP hop; removing
// them is safe. Header names, method, url, and body are untouched.

export function register() {
  if (typeof globalThis.fetch !== "function") return;
  const asciiSafe = (value: string): string => value.replace(/[^\x00-\xFF]/g, "");
  const sanitize = (init: HeadersInit | undefined): HeadersInit | undefined => {
    if (!init) return init;
    if (init instanceof Headers) {
      const out = new Headers();
      init.forEach((value, key) => out.set(key, asciiSafe(value)));
      return out;
    }
    if (Array.isArray(init)) {
      return init.map(([k, v]) => [k, asciiSafe(String(v))] as [string, string]);
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(init as Record<string, string>)) {
      out[k] = asciiSafe(String(v));
    }
    return out;
  };

  const original = globalThis.fetch.bind(globalThis) as typeof fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (input instanceof Request) {
      // Rebuild the Request with sanitized headers.
      const clonedHeaders = new Headers();
      input.headers.forEach((value, key) => clonedHeaders.set(key, asciiSafe(value)));
      const merged = init ? { ...init, headers: sanitize(init.headers) ?? clonedHeaders } : { headers: clonedHeaders };
      const rebuilt = new Request(input, merged);
      return original(rebuilt);
    }
    const nextInit = init ? { ...init, headers: sanitize(init.headers) } : undefined;
    return original(input, nextInit);
  }) as typeof fetch;
}
