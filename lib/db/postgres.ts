import postgres, { type Sql } from "postgres";
import { env } from "@/lib/env";

let client: Sql | null = null;

export function getDatabase(): Sql {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }
  client ??= postgres(env.DATABASE_URL, {
    max: Math.max(1, env.SEED_CONCURRENCY),
    prepare: false,
    idle_timeout: 20,
  });
  return client;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
  }
}
