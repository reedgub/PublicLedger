import { FileSearch } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="border border-dashed border-border bg-card/60 px-6 py-12 text-center">
      <FileSearch className="mx-auto size-6 text-muted-foreground" />
      <p className="editorial mt-4 text-2xl font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
