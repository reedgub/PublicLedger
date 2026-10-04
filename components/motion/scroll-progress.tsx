"use client";

import { motion, useScroll, useSpring } from "motion/react";

// Hairline under the nav that fills as the page is read.
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 160, damping: 30, mass: 0.3 });
  return <motion.div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px origin-left bg-white/70" style={{ scaleX }} />;
}
