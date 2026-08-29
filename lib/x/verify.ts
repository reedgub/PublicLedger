// Source-quote verification. Compares an xAI-returned quote against the
// oEmbed-verified body text after safe presentation-level normalization only.
// Numbers, dates, currency, percentages, negations, and words stay exact.

function normalizeForCompare(value: string): string {
  return value
    .normalize("NFC")
    .replace(/ /g, " ") // non-breaking space -> ordinary space
    .replace(/[‘’‚‛′]/g, "'") // curly single quotes
    .replace(/[“”„‟″]/g, '"') // curly double quotes
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteIsPresent(quote: string | undefined | null, body: string | undefined | null): boolean {
  if (!quote || !body) return false;
  const needle = normalizeForCompare(quote);
  if (needle.length < 4) return false;
  const haystack = normalizeForCompare(body);
  return haystack.includes(needle);
}

export { normalizeForCompare };
