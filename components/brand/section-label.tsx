import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-center gap-3 font-mono text-[13px] font-light tracking-[0.02em] uppercase text-muted-foreground", className)}>
      <span className="hatch text-foreground" aria-hidden="true" />
      {children}
    </p>
  );
}
