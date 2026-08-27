"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { AnalyticsEvent } from "@/lib/analytics/client";

export function AnalyticsProvider() {
  const pathname = usePathname();
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    void import("posthog-js").then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
        person_profiles: "identified_only",
        capture_pageview: false,
        capture_pageleave: false,
      });
      window.posthog = posthog;
    });
  }, []);
  useEffect(() => {
    if (!window.posthog) return;
    let event: AnalyticsEvent | null = null;
    if (pathname === "/") event = "homepage_view";
    else if (pathname.startsWith("/experts/")) event = "expert_view";
    else if (pathname.startsWith("/predictions/")) event = "prediction_view";
    else if (pathname.startsWith("/topics/")) event = "topic_view";
    if (event) window.posthog.capture(event);
  }, [pathname]);
  return null;
}
