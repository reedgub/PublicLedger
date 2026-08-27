import type { MetadataRoute } from "next";
import { getExperts, getTopics } from "@/lib/data/public";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "http://localhost:3000";
  const [experts, topics] = await Promise.all([getExperts(), getTopics()]);
  return [
    "", "/experts", "/topics", "/leaderboard", "/submit", "/methodology",
    ...experts.map((expert) => `/experts/${expert.slug}`),
    ...topics.map((topic) => `/topics/${topic.slug}`),
  ].map((path) => ({ url: `${origin}${path}`, lastModified: new Date(), changeFrequency: path === "" ? "hourly" : "daily", priority: path === "" ? 1 : 0.7 }));
}
