import type { ReactNode } from "react";
import { SectionLabel } from "@/components/brand/section-label";

export function SectionHeading({ index, title, aside, label }: { index: string; title: string; aside?: ReactNode; label?: string }) {
  return (
    <div className="rule-title">
      <div>
        <SectionLabel>{label ? `${index} / ${label}` : index}</SectionLabel>
        <h2 className="display-2 mt-5 text-balance">{title}</h2>
      </div>
      {aside && <div className="pb-1">{aside}</div>}
    </div>
  );
}
