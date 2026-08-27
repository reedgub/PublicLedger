import type { ReactNode } from "react";

export function SectionHeading({ index, title, aside }: { index: string; title: string; aside?: ReactNode }) {
  return (
    <div className="rule-title">
      <div className="flex items-baseline gap-3">
        <span className="metric text-[10px] text-muted-foreground">{index}</span>
        <h2 className="editorial text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      </div>
      {aside && <div className="pb-1">{aside}</div>}
    </div>
  );
}
