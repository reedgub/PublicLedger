"use client";

import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { useRef } from "react";

function Word({ word, index, total, progress }: { word: string; index: number; total: number; progress: MotionValue<number> }) {
  const start = index / total;
  const opacity = useTransform(progress, [start, Math.min(1, start + 1.5 / total)], [0.16, 1]);
  return <motion.span style={{ opacity }}>{word} </motion.span>;
}

// Each word brightens in reading order as the paragraph scrolls through the viewport.
export function ScrollWords({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.45"] });
  const words = text.split(" ");
  return (
    <p ref={ref} className={className}>
      {words.map((word, index) => <Word key={index} word={word} index={index} total={words.length} progress={scrollYProgress} />)}
    </p>
  );
}
