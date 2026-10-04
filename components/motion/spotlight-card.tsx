"use client";

import { motion, useMotionTemplate, useMotionValue, useSpring } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Card with a cursor-tracking glow on its surface and border, plus a gentle 3D tilt.
export function SpotlightCard({ children, className, tilt = 6 }: { children: ReactNode; className?: string; tilt?: number }) {
  const mx = useMotionValue(50);
  const my = useMotionValue(50);
  const rx = useSpring(0, { stiffness: 180, damping: 18 });
  const ry = useSpring(0, { stiffness: 180, damping: 18 });
  const glow = useMotionTemplate`radial-gradient(360px circle at ${mx}% ${my}%, rgba(255,255,255,0.10), transparent 60%)`;
  const edge = useMotionTemplate`radial-gradient(240px circle at ${mx}% ${my}%, rgba(255,255,255,0.55), transparent 70%)`;

  return (
    <motion.div
      className={cn("group/spot relative h-full [perspective:900px]", className)}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        const rect = event.currentTarget.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width;
        const py = (event.clientY - rect.top) / rect.height;
        mx.set(px * 100);
        my.set(py * 100);
        rx.set((0.5 - py) * tilt);
        ry.set((px - 0.5) * tilt);
      }}
      onPointerLeave={() => { rx.set(0); ry.set(0); }}
    >
      <motion.div className="relative h-full rounded-[20px]" style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}>
        {/* Border light: a masked 1px ring that brightens near the cursor. */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[20px] p-px opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100 [mask-composite:exclude] [mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)]"
          style={{ background: edge }}
        />
        <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[20px] opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100" style={{ background: glow }} />
        {children}
      </motion.div>
    </motion.div>
  );
}
