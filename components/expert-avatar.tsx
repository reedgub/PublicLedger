import Image from "next/image";
import { cn } from "@/lib/utils";
import type { Expert } from "@/types/domain";

// Deterministic angle per name so each monogram tile reads as distinct.
function hash(value: string) {
  let h = 0;
  for (const char of value) h = (h * 31 + char.charCodeAt(0)) >>> 0;
  return h;
}

// Shows the stored X profile image when the verify pipeline has one;
// otherwise a monogram tile. Never fetches avatars from third parties.
export function ExpertAvatar({ expert, size, className }: { expert: Pick<Expert, "displayName" | "avatarUrl">; size: number; className?: string }) {
  const frame = cn("shrink-0 overflow-hidden rounded-[12px] border border-white/10", className);
  if (expert.avatarUrl) {
    return <Image src={expert.avatarUrl} alt="" width={size} height={size} className={cn(frame, "bg-card object-cover")} style={{ width: size, height: size }} />;
  }
  const initials = expert.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  const angle = hash(expert.displayName) % 360;
  return (
    <span
      aria-hidden="true"
      className={cn(frame, "relative flex items-center justify-center font-medium tracking-[-0.03em] text-white")}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        backgroundImage: `radial-gradient(rgba(255,255,255,0.09) 0.8px, transparent 1px), linear-gradient(${angle}deg, #2b2b2b, #0d0d0d)`,
        backgroundSize: "4px 4px, 100% 100%",
      }}
    >
      {initials}
    </span>
  );
}
