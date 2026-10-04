"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";

// A panel that grows from inset to full width as it scrolls into place.
export function ScaleIn({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 0.35"] });
  const scale = useTransform(scrollYProgress, [0, 1], [0.9, 1]);
  const borderRadius = useTransform(scrollYProgress, [0, 1], [40, 20]);
  return (
    <motion.div ref={ref} className={className} style={{ scale, borderRadius }}>
      {children}
    </motion.div>
  );
}
