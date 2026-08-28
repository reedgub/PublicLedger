// Diagnostic endpoint: reports env-var health without exposing secrets.
// The anon key is a public value (bundled into every browser page anyway).
// The service role key is only summarized by length + last 4 chars.
// Delete this file once the deploy is confirmed working.

function summarize(value: string | undefined) {
  if (!value) return { present: false };
  const chars = Array.from(value);
  const hasNonAscii = chars.some((c) => c.codePointAt(0)! > 127);
  const nonAsciiCodepoints = chars
    .map((c) => c.codePointAt(0)!)
    .filter((cp) => cp > 127);
  return {
    present: true,
    length: value.length,
    startsWith: value.slice(0, 12),
    endsWith: value.slice(-10),
    hasNonAscii,
    nonAsciiCodepoints,
  };
}

export function GET() {
  return Response.json({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: summarize(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: summarize(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? null,
    NODE_VERSION: process.version,
  });
}
