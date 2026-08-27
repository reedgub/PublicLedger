import { z } from "zod";
import { searchPublic } from "@/lib/data/public";

const querySchema = z.string().trim().min(2).max(120);

export async function GET(request: Request) {
  const query = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!query.success) return Response.json({ results: [] });
  try {
    return Response.json({ results: await searchPublic(query.data) });
  } catch (error) {
    console.error("Search failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Search is temporarily unavailable.", results: [] }, { status: 503 });
  }
}
