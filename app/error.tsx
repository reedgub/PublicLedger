"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="container-receipts py-24 text-center"><p className="eyebrow">Temporary error</p><h1 className="editorial mt-4 text-5xl font-semibold">The record could not be loaded.</h1><p className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground">The source or database may be temporarily unavailable. No fallback data has been fabricated.</p><Button className="mt-8 rounded-none" onClick={reset}>Try again</Button></div>;
}
