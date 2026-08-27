import "dotenv/config";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";
import { fetchPolymarketMarkets } from "@/lib/sources/polymarket";
import { normalizeMarketTopic } from "@/lib/topics/normalize";

export async function seedPolymarket(): Promise<{ markets: number; active: number; closed: number; topics: number }> {
  const sql = getDatabase();
  const startedAt = new Date();
  const [run] = await sql<{ id: string }[]>`insert into public.ingestion_runs (source_type, job_type, status, started_at, items_requested) values ('polymarket', 'initial_seed', 'running', ${startedAt}, 500) returning id`;
  try {
    const result = await fetchPolymarketMarkets({ activeLimit: 250, closedLimit: 250 });
    const markets = [...result.active, ...result.closed];
    let topicCount = 0;
    for (const market of markets) {
      const [stored] = await sql<{ id: string }[]>`
        insert into public.markets (provider, provider_market_id, provider_slug, question, description, end_at, active, closed, volume, liquidity, yes_probability, no_probability, raw, fetched_at)
        values (${market.provider}, ${market.providerMarketId}, ${market.providerSlug}, ${market.question}, ${market.description}, ${market.endAt}, ${market.active}, ${market.closed}, ${market.volume}, ${market.liquidity}, ${market.yesProbability}, ${market.noProbability}, ${sql.json((market.raw ?? {}) as never)}, ${market.fetchedAt})
        on conflict (provider, provider_market_id) do update set provider_slug = excluded.provider_slug, question = excluded.question,
          description = excluded.description, end_at = excluded.end_at, active = excluded.active, closed = excluded.closed,
          volume = excluded.volume, liquidity = excluded.liquidity, yes_probability = excluded.yes_probability,
          no_probability = excluded.no_probability, raw = excluded.raw, fetched_at = excluded.fetched_at
        returning id
      `;
      const observed = new Date(market.fetchedAt); observed.setUTCMinutes(0, 0, 0);
      await sql`insert into public.market_snapshots (market_id, observed_at, yes_probability, no_probability, volume, liquidity) values (${stored.id}, ${observed}, ${market.yesProbability}, ${market.noProbability}, ${market.volume}, ${market.liquidity}) on conflict (market_id, observed_at) do update set yes_probability = excluded.yes_probability, no_probability = excluded.no_probability, volume = excluded.volume, liquidity = excluded.liquidity`;
      if (market.active) {
        const topic = normalizeMarketTopic(market.question);
        if (topic.isUsefulTopic) {
          const [storedTopic] = await sql<{ id: string }[]>`
            insert into public.topics (slug, title, category_slug, description, status, created_from)
            values (${topic.topicSlug}, ${topic.topicTitle}, ${topic.category}, ${topic.description}, 'active', 'polymarket')
            on conflict (slug) do update set title = excluded.title, category_slug = excluded.category_slug,
              description = excluded.description, status = 'active', updated_at = now()
            returning id
          `;
          await sql`update public.markets set topic_id = ${storedTopic.id} where id = ${stored.id}`;
          topicCount += 1;
        }
      }
    }
    await sql`update public.ingestion_runs set status = 'succeeded', finished_at = now(), items_fetched = ${markets.length}, items_created = ${markets.length}, metadata = ${sql.json({ active: result.active.length, closed: result.closed.length })} where id = ${run.id}`;
    const [{ count }] = await sql<{ count: number }[]>`select count(distinct topic_id)::integer as count from public.markets where topic_id is not null`;
    return { markets: markets.length, active: result.active.length, closed: result.closed.length, topics: count ?? topicCount };
  } catch (error) {
    await sql`update public.ingestion_runs set status = 'failed', finished_at = now(), errors = 1, metadata = ${sql.json({ error: error instanceof Error ? error.message : "unknown" })} where id = ${run.id}`;
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedPolymarket().then((result) => console.log(`Polymarket markets: ${result.markets}\nActive: ${result.active}\nClosed: ${result.closed}\nTopics: ${result.topics}`)).finally(closeDatabase);
}
