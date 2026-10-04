"use client";

import { motion } from "motion/react";
import type { CSSProperties } from "react";

// Letters rise out of a mask one after another when the word enters view.
export function RisingLetters({ text, className, style }: { text: string; className?: string; style?: CSSProperties }) {
  return (
    <motion.p
      className={className}
      style={style}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: "0px 0px -5% 0px" }}
      transition={{ staggerChildren: 0.045 }}
      aria-label={text}
    >
      {text.split("").map((letter, index) => (
        <span key={index} aria-hidden="true" className="inline-block overflow-hidden pb-[0.18em] align-bottom">
          <motion.span
            className="inline-block"
            variants={{ hidden: { y: "105%" }, shown: { y: "0%" } }}
            transition={{ duration: 0.9, ease: [0.2, 0.7, 0.2, 1] }}
          >
            {letter}
          </motion.span>
        </span>
      ))}
    </motion.p>
  );
}
