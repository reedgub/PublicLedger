// Roster growth helpers (pure).

const HANDLE = /(?:^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{2,15})\b/g;

/** Distinct lower-cased @handles mentioned in a post (ignores emails like a@b.com). */
export function extractMentions(text: string): string[] {
  const handles = new Set<string>();
  for (const match of text.matchAll(HANDLE)) handles.add(match[1].toLowerCase());
  return [...handles];
}
