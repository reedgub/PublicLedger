"use client";

import { motion, useSpring } from "motion/react";
import type { ReactNode } from "react";

// Pulls its child a few pixels toward the cursor while hovered.
export function Magnetic({ children, strength = 0.28 }: { children: ReactNode; strength?: number }) {
  const x = useSpring(0, { stiffness: 220, damping: 16, mass: 0.4 });
  const y = useSpring(0, { stiffness: 220, damping: 16, mass: 0.4 });
  return (
    <motion.span
      className="inline-flex"
      style={{ x, y }}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        const rect = event.currentTarget.getBoundingClientRect();
        x.set((event.clientX - rect.left - rect.width / 2) * strength);
        y.set((event.clientY - rect.top - rect.height / 2) * strength);
      }}
      onPointerLeave={() => { x.set(0); y.set(0); }}
    >
      {children}
    </motion.span>
  );
}
