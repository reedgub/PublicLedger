// Podcast back catalogs: often the densest free source of forecasts.
//
// Audio is downloaded from the public RSS enclosure, transcoded with ffmpeg
// to 16 kHz mono at a low bitrate (≈14 MB/hour, which keeps every segment
// under hosted Whisper upload limits), cut into fixed segments, and sent to
// any OpenAI-compatible /audio/transcriptions endpoint.
//
// Integrity: transcripts are machine-generated and carry no speaker labels.
// Sources are stored as source_type "podcast" with the timeline needed to
// link a quote back to its timestamp, and candidates from shows where the
// expert is not the host are always routed to human review.

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { load } from "cheerio";
import OpenAI from "openai";
import { env } from "@/lib/env";
import type { SourceRecord } from "@/lib/sources/types";
import { FEED_USER_AGENT } from "@/lib/sources/feed";

export type PodcastEpisode = {
  guid: string;
  title: string;
  link: string | null;
  audioUrl: string;
  publishedAt: Date | null;
  durationSeconds: number | null;
};

export function parseDuration(value: string | undefined | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function parsePodcastFeed(xml: string): PodcastEpisode[] {
  const $ = load(xml, { xmlMode: true });
  const episodes: PodcastEpisode[] = [];
  $("item").each((_, node) => {
    const item = $(node);
    const audioUrl = item.children("enclosure").attr("url");
    if (!audioUrl || !/^https?:\/\//.test(audioUrl)) return;
    const date = new Date(item.children("pubDate").first().text().trim());
    episodes.push({
      guid: item.children("guid").first().text().trim() || audioUrl,
      title: item.children("title").first().text().trim(),
      link: item.children("link").first().text().trim() || null,
      audioUrl,
      publishedAt: Number.isNaN(date.getTime()) ? null : date,
      durationSeconds: parseDuration(item.children("itunes\\:duration").first().text()),
    });
  });
  return episodes;
}

export async function fetchPodcastEpisodes(feedUrl: string): Promise<PodcastEpisode[]> {
  const response = await fetch(feedUrl, { headers: { "User-Agent": FEED_USER_AGENT, Accept: "application/rss+xml,application/xml,text/xml" } });
  if (!response.ok) throw new Error(`Podcast feed ${response.status} for ${new URL(feedUrl).hostname}`);
  return parsePodcastFeed(await response.text());
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.slice(-400)}`))));
  });
}

export type TranscriptSegment = { start: number; end: number; text: string };

/** Join segments into one text and a compact char-offset → seconds timeline (≈ every 30 s). */
export function assembleTranscript(segments: TranscriptSegment[], everySeconds = 30): { text: string; timeline: Array<[number, number]> } {
  let text = "";
  const timeline: Array<[number, number]> = [];
  let lastMark = -Infinity;
  for (const segment of segments) {
    const piece = segment.text.trim();
    if (!piece) continue;
    if (text) text += " ";
    if (segment.start - lastMark >= everySeconds) {
      timeline.push([text.length, Math.floor(segment.start)]);
      lastMark = segment.start;
    }
    text += piece;
  }
  return { text, timeline };
}

let transcribeClient: OpenAI | null = null;

/** Download, transcode, segment and transcribe one episode. */
export async function transcribeEpisode(audioUrl: string, options: { segmentSeconds?: number } = {}): Promise<{ text: string; timeline: Array<[number, number]>; audioSeconds: number }> {
  if (!env.TRANSCRIBE_API_KEY) throw new Error("TRANSCRIBE_API_KEY is not configured.");
  transcribeClient ??= new OpenAI({ baseURL: env.TRANSCRIBE_BASE_URL, apiKey: env.TRANSCRIBE_API_KEY, maxRetries: 4, timeout: 300_000 });
  const segmentSeconds = options.segmentSeconds ?? 900;
  const dir = await mkdtemp(path.join(tmpdir(), "pl-podcast-"));
  try {
    const original = path.join(dir, "original");
    const response = await fetch(audioUrl, { headers: { "User-Agent": FEED_USER_AGENT } });
    if (!response.ok || !response.body) throw new Error(`Audio download ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(original));
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", original, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
      "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1", path.join(dir, "part%03d.mp3")]);
    const parts = (await readdir(dir)).filter((name) => name.startsWith("part")).sort();
    const segments: TranscriptSegment[] = [];
    let audioSeconds = 0;
    for (const [index, part] of parts.entries()) {
      const offset = index * segmentSeconds;
      const file = path.join(dir, part);
      if ((await stat(file)).size < 1024) continue;
      const result = await transcribeClient.audio.transcriptions.create({
        file: createReadStream(file),
        model: env.TRANSCRIBE_MODEL,
        response_format: "verbose_json",
        language: "en",
      }) as unknown as { text: string; duration?: number; segments?: Array<{ start: number; end: number; text: string }> };
      audioSeconds += result.duration ?? segmentSeconds;
      if (result.segments?.length) {
        for (const segment of result.segments) segments.push({ start: segment.start + offset, end: segment.end + offset, text: segment.text });
      } else {
        segments.push({ start: offset, end: offset + (result.duration ?? segmentSeconds), text: result.text });
      }
    }
    return { ...assembleTranscript(segments), audioSeconds };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function episodeRecord(episode: PodcastEpisode, transcript: { text: string; timeline: Array<[number, number]> }, options: { expertHandle: string | null; feedUrl: string; expertIsHost: boolean }): SourceRecord | null {
  if (!episode.publishedAt || !transcript.text) return null;
  return {
    sourceType: "podcast",
    externalId: episode.guid,
    canonicalPath: episode.link && /^https?:\/\//.test(episode.link) ? episode.link : episode.audioUrl,
    authorHandle: options.expertHandle ?? undefined,
    publishedAt: episode.publishedAt,
    exactText: transcript.text,
    metadata: {
      title: episode.title,
      audioUrl: episode.audioUrl,
      feedUrl: options.feedUrl,
      timeline: transcript.timeline,
      expertIsHost: options.expertIsHost,
      machineTranscript: true,
      transcribeModel: env.TRANSCRIBE_MODEL,
    },
  };
}
