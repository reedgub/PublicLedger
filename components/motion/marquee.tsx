import { cn } from "@/lib/utils";

// Infinite, edge-faded ticker. Content is duplicated once so the loop is seamless;
// the second copy is hidden from assistive tech. Pauses on hover.
export function Marquee({ items, className, reverse = false, speed = 60 }: { items: string[]; className?: string; reverse?: boolean; speed?: number }) {
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center gap-10 pr-10">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex items-center gap-10 whitespace-nowrap">
          <span>{item}</span>
          <span aria-hidden="true" className="size-1.5 rotate-45 bg-current opacity-40" />
        </li>
      ))}
    </ul>
  );
  return (
    <div className={cn("group/marquee flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]", className)}>
      <div
        className="animate-marquee flex group-hover/marquee:[animation-play-state:paused]"
        style={{ animationDuration: `${speed}s`, animationDirection: reverse ? "reverse" : "normal" }}
      >
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
