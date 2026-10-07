// Import a hand-curated list of predictions as cascade candidates.
//
//   pnpm import:manual seed/manual/2026-10-05.json [--no-verify]
//
// Rows are leads, not facts (see lib/sources/manualImport.ts): each one is
// re-checked against its live source, stored with the source's own text and
// date, and queued for the cascade verifier, which publishes or rejects it.
// Nothing here publishes directly. Re-running the same file is safe.

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";
import { EXTRACTION_SCHEMA_VERSION } from "@/lib/constants";
import { revalidateLive } from "@/lib/http/revalidate";
import { CASCADE_EXTRACTION_VERSION } from "@/lib/pipeline/extract";
import { createBudgetGuard, recordSpend, xReadCostUsd } from "@/lib/pipeline/spend";
import { contentHash, storeSourceRecords } from "@/lib/pipeline/store";
import { verifyPendingSync } from "@/lib/pipeline/verifyRunner";
import { isLikelyDuplicate } from "@/lib/predictions/dedupe";
import { isIsoDate, validateExtractedPrediction } from "@/lib/predictions/validation";
import { pageTextFromHtml } from "@/lib/resolution/evidence";
import { allowedToFetch, FEED_USER_AGENT, parseArticle } from "@/lib/sources/feed";
import { captureModeFor, dedupeRows, locateQuote, manualRowSchema, parseXStatusUrl, statedProbability, type ManualRow } from "@/lib/sources/manualImport";
import type { SourceRecord } from "@/lib/sources/types";
import { fetchXPostById } from "@/lib/sources/x";

type Expert = { id: string; slug: string; x_handle: string | null; x_user_id: string | null };
type Fetched = { record: SourceRecord; text: string; verificationLevel: "x_api" | null };
type Outcome = { expert: string; source: string; quote: string; result: string };

const xCache = new Map<string, SourceRecord | null>();
const pageCache = new Map<string, { html: string } | null>();

async function fetchXSource(id: string, expert: Expert, guard: Awaited<ReturnType<typeof createBudgetGuard>>): Promise<Fetched | string> {
  const sql = getDatabase();
  // Already collected by the daily job: reuse the stored official text (no X read).
  const [stored] = await sql<{ exact_text: string; published_at: Date; author_handle: string | null }[]>`
    select exact_text, published_at, author_handle from public.sources where source_type = 'x' and external_id = ${id} and deleted_at is null
  `;
  if (stored?.exact_text) {
    if (stored.author_handle && expert.x_handle && stored.author_handle.toLowerCase() !== expert.x_handle.toLowerCase()) return "not_expert_account";
    return {
      record: { sourceType: "x", externalId: id, authorHandle: stored.author_handle ?? undefined, publishedAt: new Date(stored.published_at), exactText: stored.exact_text, canonicalPath: `/${stored.author_handle ?? "i"}/status/${id}`, metadata: {} },
      text: stored.exact_text,
      verificationLevel: "x_api",
    };
  }
  if (!xCache.has(id)) {
    if (!guard.canSpend(xReadCostUsd(1, 1))) return "budget_exhausted";
    const record = await fetchXPostById(id).catch(() => null);
    await recordSpend({ scope: "daily", provider: "x", stage: "manual_lookup", units: 1, unitKind: "post_read", costUsd: xReadCostUsd(record ? 1 : 0, 1), metadata: { post_id: id } }, guard);
    xCache.set(id, record);
  }
  const record = xCache.get(id);
  if (!record?.exactText) return "x_post_unavailable";
  const sameAccount = expert.x_user_id
    ? record.authorExternalId === expert.x_user_id
    : Boolean(record.authorHandle && expert.x_handle && record.authorHandle.toLowerCase() === expert.x_handle.toLowerCase());
  if (!sameAccount) return "not_expert_account";
  const referenced = (record.metadata.referencedTweets as Array<{ type: string }> | undefined) ?? [];
  if (referenced.some((item) => item.type === "retweeted")) return "repost_not_authored";
  return { record, text: record.exactText, verificationLevel: "x_api" };
}

async function fetchWebSource(url: string, quote: string): Promise<Fetched | string> {
  if (!pageCache.has(url)) {
    try {
      if (!(await allowedToFetch(url))) {
        pageCache.set(url, null);
        return "robots_disallowed";
      }
      const response = await fetch(url, { headers: { "User-Agent": FEED_USER_AGENT, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
      pageCache.set(url, response.ok ? { html: await response.text() } : null);
    } catch {
      pageCache.set(url, null);
    }
  }
  const page = pageCache.get(url);
  if (!page) return "source_unreachable";
  const article = parseArticle(page.html, url);
  if (!article.publishedAt) return "source_date_unknown";
  const $ = load(page.html);
  const summary = $("meta[name='description'], meta[property='og:description']").map((_, node) => $(node).attr("content") ?? "").get().join("\n");
  for (const text of [article.text, pageTextFromHtml(page.html), summary]) {
    const located = text ? locateQuote(text, quote) : null;
    if (!located) continue;
    return {
      record: {
        sourceType: "web",
        // One row per quoted passage: each stores only its own excerpt.
        externalId: `web:${contentHash(article.canonicalUrl)}:${contentHash(located.quote).slice(0, 16)}`,
        publishedAt: article.publishedAt,
        exactText: located.excerpt,
        canonicalPath: article.canonicalUrl,
        metadata: { title: article.title, byline: article.author, excerpt_of_page: true, imported_via: "import-manual" },
      },
      text: located.excerpt,
      verificationLevel: null,
    };
  }
  return "quote_not_found_in_source";
}

export async function importManual(rows: ManualRow[]): Promise<Outcome[]> {
  const sql = getDatabase();
  const guard = await createBudgetGuard("daily");
  const experts = new Map<string, Expert>();
  const outcomes: Outcome[] = [];
  for (const row of dedupeRows(rows)) {
    const outcome: Outcome = { expert: row.expertSlug, source: row.sourcePath, quote: row.sourceQuote.slice(0, 80), result: "" };
    outcomes.push(outcome);
    if (!experts.has(row.expertSlug)) {
      const [expert] = await sql<Expert[]>`select id, slug, x_handle, x_user_id from public.experts where slug = ${row.expertSlug} and is_active`;
      if (expert) experts.set(row.expertSlug, expert);
    }
    const expert = experts.get(row.expertSlug);
    if (!expert) { outcome.result = "skipped: expert_not_found"; continue; }

    const x = parseXStatusUrl(row.sourcePath);
    const fetched = x ? await fetchXSource(x.id, expert, guard) : await fetchWebSource(row.sourcePath, row.sourceQuote);
    if (typeof fetched === "string") { outcome.result = `skipped: ${fetched}`; continue; }
    const located = locateQuote(fetched.text, row.sourceQuote);
    if (!located) { outcome.result = "skipped: quote_not_found_in_source"; continue; }

    const mode = captureModeFor(fetched.record.publishedAt);
    await storeSourceRecords([fetched.record], { expertId: expert.id, mode, verificationLevel: fetched.verificationLevel });
    const [source] = await sql<{ id: string; exact_text: string; published_at: Date }[]>`
      select id, exact_text, published_at from public.sources where source_type = ${fetched.record.sourceType} and external_id = ${fetched.record.externalId ?? ""}
    `;
    if (!source) { outcome.result = "skipped: source_not_stored"; continue; }
    // The cascade must not re-extract a source we are importing by hand.
    await sql`update public.sources set screen_status = 'extracted', expert_id = coalesce(expert_id, ${expert.id}) where id = ${source.id} and screen_status in ('pending', 'screened')`;

    const quote = locateQuote(source.exact_text, located.quote)?.quote ?? located.quote;
    const [already] = await sql<{ id: string }[]>`select id from public.prediction_candidates where source_id = ${source.id} and source_quote = ${quote} limit 1`;
    if (already) { outcome.result = "skipped: already_imported"; continue; }

    const candidate = {
      normalized_claim: row.normalizedClaim,
      source_quote: quote,
      resolution_date: row.resolutionDate,
      resolution_criteria: row.resolutionCriteria,
      explicit_probability: statedProbability(quote, row.explicitProbability),
      confidence_language: row.confidenceLanguage ?? null,
      category: row.category,
      extraction_confidence: 0.5,
      falsifiability_score: row.falsifiabilityScore,
      source_fidelity_score: 0.5,
      record_type: row.recordType,
      imputation_note: row.recordType === "take" ? row.imputationNote ?? null : null,
    };
    const deterministic = validateExtractedPrediction(source.exact_text, source.published_at, candidate);
    const existing = await sql<{ normalized_claim: string; resolution_date: string | null }[]>`
      select normalized_claim, resolution_date::text from public.predictions where expert_id = ${expert.id}
      union all
      select normalized_claim, resolution_date::text from public.prediction_candidates
      where expert_id = ${expert.id} and status in ('pending', 'review', 'auto_verified') and normalized_claim is not null
    `;
    const duplicate = deterministic.valid && existing.some((item) => isLikelyDuplicate(
      { expertId: expert.id, claim: candidate.normalized_claim, resolutionDate: candidate.resolution_date },
      { expertId: expert.id, claim: item.normalized_claim, resolutionDate: item.resolution_date },
    ));
    const status = !deterministic.valid ? "rejected" : duplicate ? "duplicate" : "pending";
    await sql`
      insert into public.prediction_candidates (source_id, expert_id, normalized_claim, source_quote, resolution_date, resolution_criteria,
        explicit_probability, confidence_language, category_slug, extraction_confidence, falsifiability_score, source_fidelity_score,
        status, reason_rejected, model_name, raw_extraction, record_type, imputation_note, pipeline)
      values (${source.id}, ${expert.id}, ${candidate.normalized_claim}, ${candidate.source_quote}, ${isIsoDate(candidate.resolution_date) ? candidate.resolution_date : null}, ${candidate.resolution_criteria},
        ${candidate.explicit_probability}, ${candidate.confidence_language}, ${candidate.category}, ${candidate.extraction_confidence}, ${candidate.falsifiability_score}, ${candidate.source_fidelity_score},
        ${status}, ${!deterministic.valid ? deterministic.errors.join(",") : duplicate ? "semantic_duplicate" : null}, 'manual-import',
        ${sql.json({ candidate, force_review: false, capture_mode: mode, manual_import: true, extraction_schema_version: EXTRACTION_SCHEMA_VERSION, cascade_version: CASCADE_EXTRACTION_VERSION } as never)},
        ${candidate.record_type}, ${candidate.imputation_note}, 'cascade')
    `;
    outcome.result = status === "pending" ? "queued for AI verification" : status === "duplicate" ? "skipped: duplicate_of_existing" : `rejected: ${deterministic.errors.join(",")}`;
  }
  return outcomes;
}

async function main() {
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (files.length === 0) throw new Error("Usage: pnpm import:manual <file.json> [more.json] [--no-verify]");
  const rows: ManualRow[] = [];
  const invalid: string[] = [];
  for (const file of files) {
    const data = JSON.parse(await readFile(file, "utf8")) as unknown;
    for (const [index, item] of (Array.isArray(data) ? data : []).entries()) {
      const parsed = manualRowSchema.safeParse(item);
      if (parsed.success) rows.push(parsed.data);
      else invalid.push(`${file}[${index}]: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    }
  }
  const outcomes = await importManual(rows);
  for (const outcome of outcomes) console.log(JSON.stringify(outcome));
  for (const line of invalid) console.log(JSON.stringify({ result: "skipped: invalid_row", detail: line }));
  const tally = outcomes.reduce<Record<string, number>>((acc, item) => { const key = item.result.split(":")[0]; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
  console.log(JSON.stringify({ stage: "manual_import_summary", rows: rows.length + invalid.length, unique: outcomes.length, invalid: invalid.length, ...tally }));

  if (!process.argv.includes("--no-verify")) {
    const guard = await createBudgetGuard("daily");
    const verified = await verifyPendingSync({ guard, scope: "daily" });
    console.log(JSON.stringify({ stage: "verify_sync_summary", ...verified }));
    if (verified.published > 0) await revalidateLive(["/", "/leaderboard"]);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(closeDatabase);
}
