import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// 6x3 pixel arrow pointing right. Cells marked 1 are lit.
const ARROW = [
  [0, 0, 0, 1, 0, 0],
  [1, 1, 1, 1, 1, 0],
  [0, 0, 0, 1, 0, 0],
];

export function PixelMark({ className }: { className?: string }) {
  let index = 0;
  return (
    <svg viewBox="0 0 18 9" className={cn("pixel-mark h-[9px] w-[18px]", className)} aria-hidden="true">
      {ARROW.flatMap((row, y) =>
        row.map((on, x) => (
          <rect key={`${x}-${y}`} x={x * 3} y={y * 3} width="2.4" height="2.4" fill="currentColor" data-on={on ? "" : undefined} style={{ ["--i" as string]: index++ }} />
        )),
      )}
    </svg>
  );
}

type Variant = "light" | "dark" | "ghost";

const variants: Record<Variant, { shell: string; chip: string }> = {
  light: { shell: "bg-white text-[#0d0d0d] border-[rgba(13,13,13,0.06)] hover:bg-white/90", chip: "bg-[#0d0d0d] text-white" },
  dark: { shell: "bg-[#0d0d0d] text-white border-white/10 hover:bg-[#1a1a1a]", chip: "bg-white text-[#0d0d0d]" },
  ghost: { shell: "bg-white/[0.06] text-white border-white/10 hover:bg-white/10", chip: "bg-white text-[#0d0d0d]" },
};

export function PixelButton({ variant = "light", className, children, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  const style = variants[variant];
  return (
    <Link
      {...props}
      className={cn("group/pixel inline-flex h-11 items-center gap-3 rounded-[14px] border py-1.5 pr-5 pl-1.5 text-sm tracking-[0.02em] transition-colors", style.shell, className)}
    >
      <span className={cn("flex size-8 items-center justify-center rounded-[8px]", style.chip)}><PixelMark /></span>
      <span>{children}</span>
    </Link>
  );
}
