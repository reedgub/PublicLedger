import { FileSearch } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid-field rounded-[20px] border border-border bg-card px-6 py-16 text-center">
      <span className="mx-auto flex size-11 items-center justify-center rounded-[12px] border border-border bg-muted"><FileSearch className="size-5 text-muted-foreground" /></span>
      <p className="editorial mt-6 text-3xl">{title}</p>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed font-light text-muted-foreground">{description}</p>
    </div>
  );
}
