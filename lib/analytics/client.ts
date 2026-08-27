"use client";

declare global {
  interface Window {
    posthog?: { capture: (event: string, properties?: Record<string, unknown>) => void };
  }
}

export type AnalyticsEvent =
  | "homepage_view" | "search" | "search_result_click" | "expert_view" | "prediction_view"
  | "topic_view" | "market_context_view" | "source_click" | "share_click"
  | "submission_started" | "submission_completed" | "leaderboard_sort" | "leaderboard_filter";

export function track(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY || typeof window === "undefined") return;
  window.posthog?.capture(event, properties);
}
