// Stage 0 for long documents (articles, transcripts): pick only the passages
// that look forward-looking, with a little context, so the paid stages never
// see the rest. Every unit is an exact slice of the source text, so a quote
// extracted from a unit is automatically a contiguous substring of the full
// source as well.

import { scorePredictionHeuristic } from "@/lib/predictions/heuristics";

export type TextUnit = { text: string; start: number; end: number; score: number };

export type ChunkOptions = {
  /** Texts at or below this length are a single unit. */
  maxUnitChars?: number;
  /** Target size of the scoring blocks a long text is cut into. */
  blockChars?: number;
  /** Neighbouring blocks kept on each side of a hit, for context. */
  contextBlocks?: number;
  /** Cap on units per source; highest-scoring are kept. */
  maxUnits?: number;
};

type Block = { start: number; end: number };

/** Cut text into ~blockChars blocks at paragraph, then sentence, boundaries. */
export function splitBlocks(text: string, blockChars: number): Block[] {
  const blocks: Block[] = [];
  const boundaries: number[] = [];
  const pattern = /\n\s*\n|(?<=[.!?]["')\]]?)\s+(?=[A-Z0-9"'(\[])/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) boundaries.push(match.index + match[0].length);
  boundaries.push(text.length);
  let start = 0;
  for (const boundary of boundaries) {
    if (boundary - start >= blockChars || boundary === text.length) {
      // A block with no usable boundary (e.g. an unpunctuated transcript) is
      // cut hard at blockChars so no unit grows without bound.
      let cursor = start;
      while (boundary - cursor > blockChars * 2) {
        blocks.push({ start: cursor, end: cursor + blockChars });
        cursor += blockChars;
      }
      if (boundary > cursor) blocks.push({ start: cursor, end: boundary });
      start = boundary;
    }
  }
  return blocks.filter((block) => text.slice(block.start, block.end).trim().length > 0);
}

export function selectUnits(text: string, options: ChunkOptions = {}): TextUnit[] {
  const maxUnitChars = options.maxUnitChars ?? 2400;
  const blockChars = options.blockChars ?? 700;
  const contextBlocks = options.contextBlocks ?? 1;
  const maxUnits = options.maxUnits ?? 12;
  if (!text.trim()) return [];

  if (text.length <= maxUnitChars) {
    const { score, shouldExtract } = scorePredictionHeuristic(text);
    return shouldExtract ? [{ text, start: 0, end: text.length, score }] : [];
  }

  const blocks = splitBlocks(text, blockChars);
  const scores = blocks.map((block) => scorePredictionHeuristic(text.slice(block.start, block.end)));
  const keep = new Set<number>();
  scores.forEach((result, index) => {
    if (!result.shouldExtract) return;
    for (let offset = -contextBlocks; offset <= contextBlocks; offset += 1) {
      const neighbour = index + offset;
      if (neighbour >= 0 && neighbour < blocks.length) keep.add(neighbour);
    }
  });

  // Merge consecutive kept blocks into units, splitting at maxUnitChars.
  const units: TextUnit[] = [];
  let current: { start: number; end: number; score: number } | null = null;
  const flush = () => {
    if (current) units.push({ text: text.slice(current.start, current.end), start: current.start, end: current.end, score: current.score });
    current = null;
  };
  [...keep].sort((a, b) => a - b).forEach((index, position, sorted) => {
    const block = blocks[index];
    const contiguous = position > 0 && sorted[position - 1] === index - 1;
    if (current && contiguous && block.end - current.start <= maxUnitChars) {
      current.end = block.end;
      current.score = Math.max(current.score, scores[index].score);
    } else {
      flush();
      current = { start: block.start, end: block.end, score: scores[index].score };
    }
  });
  flush();

  if (units.length <= maxUnits) return units;
  return units
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, maxUnits)
    .sort((a, b) => a.start - b.start);
}
