"use client";

import Link from "next/link";
import { Search, LoaderCircle, ArrowUpRight } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import type { SearchResult } from "@/types/domain";

export function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const body = (await response.json()) as { results?: SearchResult[] };
        setResults(body.results ?? []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const open = focused && query.trim().length >= 2;
  return (
    <div className="relative" id={compact ? undefined : "search"}>
      <label htmlFor={id} className="sr-only">Search experts, predictions, topics, and markets</label>
      <Search className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 ${compact ? "size-4" : "size-5"}`} />
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-results`}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          if (nextQuery.trim().length < 2) setResults([]);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 150)}
        placeholder="Search an expert, claim, topic, or market…"
        className={`${compact ? "h-10 pl-10 text-sm" : "h-14 border-foreground bg-card pl-12 text-base shadow-none"} rounded-none`}
      />
      {loading && <LoaderCircle className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {open && (
        <div id={`${id}-results`} role="listbox" className="absolute z-30 mt-1 w-full border border-foreground bg-card shadow-[6px_6px_0_#11110f]">
          {results.length ? results.map((result) => (
            <Link key={`${result.type}-${result.id}`} href={result.href} role="option" className="group flex items-center justify-between gap-4 border-b px-4 py-3 last:border-0 hover:bg-muted">
              <span className="min-w-0">
                <span className="eyebrow block">{result.type}</span>
                <span className="block truncate text-sm font-medium">{result.title}</span>
                {result.subtitle && <span className="block truncate text-xs text-muted-foreground">{result.subtitle}</span>}
              </span>
              <ArrowUpRight className="size-4 shrink-0 opacity-40 group-hover:opacity-100" />
            </Link>
          )) : !loading ? <p className="px-4 py-5 text-sm text-muted-foreground">No matching public records.</p> : null}
        </div>
      )}
    </div>
  );
}
