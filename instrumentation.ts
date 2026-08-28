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
  const asciiSafe = (value: unknown): string => String(value ?? "").replace(/[^\x00-\xFF]/g, "");

  // Patch Headers.prototype.set / .append so ANY code path that builds a
  // Headers object silently strips characters undici would otherwise reject.
  // Covers cases where supabase-js / postgrest-js / Next.js internals build
  // the Headers before our fetch wrapper ever sees them.
  if (typeof globalThis.Headers === "function") {
    const proto = globalThis.Headers.prototype;
    const originalSet = proto.set;
    const originalAppend = proto.append;
    if (!(proto as { __receiptsPatched?: boolean }).__receiptsPatched) {
      proto.set = function (name: string, value: string) {
        return originalSet.call(this, name, asciiSafe(value));
      };
      proto.append = function (name: string, value: string) {
        return originalAppend.call(this, name, asciiSafe(value));
      };
      (proto as { __receiptsPatched?: boolean }).__receiptsPatched = true;
    }
  }

  // Belt-and-braces: also sanitize the init that reaches globalThis.fetch,
  // in case a header is passed via an object literal instead of a Headers.
  if (typeof globalThis.fetch !== "function") return;
  const sanitize = (init: HeadersInit | undefined): HeadersInit | undefined => {
    if (!init) return init;
    if (init instanceof Headers) return init; // already patched via prototype
    if (Array.isArray(init)) {
      return init.map(([k, v]) => [k, asciiSafe(v)] as [string, string]);
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(init as Record<string, string>)) {
      out[k] = asciiSafe(v);
    }
    return out;
  };
  const original = globalThis.fetch.bind(globalThis) as typeof fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const nextInit = init ? { ...init, headers: sanitize(init.headers) } : undefined;
    return original(input as string | URL | Request, nextInit);
  }) as typeof fetch;
}
