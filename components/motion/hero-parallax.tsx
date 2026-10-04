"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";

// Hero depth on scroll: the backdrop slowly zooms while the copy drifts up and fades.
export function HeroParallax({ backdrop, children, className }: { backdrop: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.18]);
  const backdropOpacity = useTransform(scrollYProgress, [0, 0.9], [1, 0.35]);
  const y = useTransform(scrollYProgress, [0, 1], [0, -140]);
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  return (
    <section ref={ref} className={className}>
      <motion.div className="absolute inset-0" style={{ scale, opacity: backdropOpacity }}>{backdrop}</motion.div>
      <motion.div className="relative" style={{ y, opacity }}>{children}</motion.div>
    </section>
  );
}
