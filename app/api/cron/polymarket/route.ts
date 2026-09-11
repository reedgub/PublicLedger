import { revalidatePath } from "next/cache";
import { env, integrations } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchPolymarketMarkets } from "@/lib/sources/polymarket";
import { normalizeMarketTopic } from "@/lib/topics/normalize";

function authorized(request: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const bearer = request.headers.get("authorization");
  return bearer === `Bearer ${env.CRON_SECRET}` || request.headers.get("x-cron-secret") === env.CRON_SECRET;
}

async function handle(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!integrations.supabaseAdmin) return Response.json({ error: "Supabase admin is not configured" }, { status: 503 });
  const admin = createAdminSupabaseClient();
  const startedAt = new Date().toISOString();
  const { data: run } = await admin.from("ingestion_runs").insert({ source_type: "polymarket", job_type: "hourly_refresh", status: "running", started_at: startedAt }).select("id").single();
  try {
    const { active } = await fetchPolymarketMarkets({ activeLimit: 250, closedLimit: 0 });
    const payload = active.map((market) => ({
      provider: market.provider, provider_market_id: market.providerMarketId, provider_slug: market.providerSlug,
      question: market.question, description: market.description, end_at: market.endAt,
      active: market.active, closed: market.closed, volume: market.volume, liquidity: market.liquidity,
      yes_probability: market.yesProbability, no_probability: market.noProbability,
      fetched_at: market.fetchedAt, raw: market.raw ?? {},
    }));
    const { data: stored, error } = await admin.from("markets").upsert(payload, { onConflict: "provider,provider_market_id" }).select("id, provider_market_id, question, active, yes_probability, no_probability, volume, liquidity, fetched_at");
    if (error) throw error;
    const snapshots = (stored ?? []).map((market) => {
      const observed = new Date(market.fetched_at); observed.setUTCMinutes(0, 0, 0);
      return { market_id: market.id, observed_at: observed.toISOString(), yes_probability: market.yes_probability, no_probability: market.no_probability, volume: market.volume, liquidity: market.liquidity };
    });
    if (snapshots.length) {
      const { error: snapshotError } = await admin.from("market_snapshots").upsert(snapshots, { onConflict: "market_id,observed_at" });
      if (snapshotError) throw snapshotError;
    }
    // Normalize each active market into a topic and link the market to it.
    // Also sweep in any pre-existing active markets that never got a topic
    // (from earlier runs whose Polymarket response has since drifted), and
    // update stale category_slug on already-existing topics whose normalizer
    // now maps to a better category.
    const { data: orphanRows } = await admin
      .from("markets")
      .select("id, question")
      .eq("active", true)
      .is("topic_id", null)
      .limit(500);
    const topicsBySlug = new Map<string, { title: string; category: string; description: string; marketIds: string[] }>();
    const addToTopic = (marketId: string, question: string) => {
      const topic = normalizeMarketTopic(question);
      if (!topic.isUsefulTopic) return;
      const entry = topicsBySlug.get(topic.topicSlug) ?? { title: topic.topicTitle, category: topic.category, description: topic.description, marketIds: [] };
      entry.marketIds.push(marketId);
      topicsBySlug.set(topic.topicSlug, entry);
    };
    for (const market of stored ?? []) if (market.active) addToTopic(market.id, market.question);
    for (const orphan of orphanRows ?? []) addToTopic(orphan.id, orphan.question);
    let topicsCreated = 0;
    for (const [slug, info] of topicsBySlug) {
      const { data: topic, error: topicError } = await admin
        .from("topics")
        .upsert({ slug, title: info.title, category_slug: info.category, description: info.description, status: "active", created_from: "polymarket" }, { onConflict: "slug" })
        .select("id")
        .single();
      if (topicError || !topic) continue;
      topicsCreated += 1;
      const { error: linkError } = await admin.from("markets").update({ topic_id: topic.id }).in("id", info.marketIds);
      if (linkError) console.error("failed to link markets to topic", slug, linkError.message);
    }
    if (run) await admin.from("ingestion_runs").update({ status: "succeeded", finished_at: new Date().toISOString(), items_requested: 250, items_fetched: active.length, items_created: stored?.length ?? 0, metadata: { topics_created: topicsCreated, orphan_markets_swept: orphanRows?.length ?? 0 } }).eq("id", run.id);
    // Market prices, topic lists, and the homepage market rail are downstream
    // of this refresh; without an explicit revalidate they stay stale until an
    // admin acts.
    revalidatePath("/");
    revalidatePath("/topics");
    return Response.json({ ok: true, markets: active.length, snapshots: snapshots.length, topics: topicsCreated, orphansSwept: orphanRows?.length ?? 0 });
  } catch (error) {
    if (run) await admin.from("ingestion_runs").update({ status: "failed", finished_at: new Date().toISOString(), errors: 1, metadata: { error: error instanceof Error ? error.message : "unknown" } }).eq("id", run.id);
    return Response.json({ error: "Polymarket refresh failed" }, { status: 500 });
  }
}

// Vercel Cron sends GET; manual invocations may use POST. Both are gated on CRON_SECRET.
export const GET = handle;
export const POST = handle;
export const maxDuration = 60;
