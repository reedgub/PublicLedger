import { cn } from "@/lib/utils";

// Ledger mark: three stacked rows of cells, the last one filled — an entry being recorded.
export function LedgerMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cn("size-5", className)} aria-hidden="true">
      <rect x="0" y="0" width="20" height="5" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="0" y="7.5" width="20" height="5" rx="1.5" fill="currentColor" opacity="0.6" />
      <rect x="0" y="15" width="12" height="5" rx="1.5" fill="currentColor" />
      <rect x="14" y="15" width="6" height="5" rx="1.5" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LedgerMark />
      <span className="text-[19px] font-medium tracking-[-0.04em] lowercase">publicledger</span>
    </span>
  );
}
