"use client";

import { motion } from "motion/react";
import type { ElementType } from "react";

const EASE = [0.16, 1, 0.3, 1] as const;

// Words slide up out of a clipping mask, one after another — on load
// (`immediate`) or the first time the heading scrolls into view.
export function SplitReveal({ text, as = "h2", className, delay = 0, immediate = false }: { text: string; as?: ElementType; className?: string; delay?: number; immediate?: boolean }) {
  const Tag = as;
  const words = text.split(" ");
  const trigger = immediate ? { animate: "shown" } : { whileInView: "shown", viewport: { once: true, margin: "0px 0px -10% 0px" } };
  return (
    <Tag className={className}>
      <span className="sr-only">{text}</span>
      <motion.span aria-hidden="true" initial="hidden" {...trigger} transition={{ staggerChildren: 0.07, delayChildren: delay }}>
        {words.map((word, index) => (
          <span key={index} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
            <motion.span
              className="inline-block"
              variants={{ hidden: { y: "110%", rotate: 4 }, shown: { y: "0%", rotate: 0 } }}
              transition={{ duration: 1.1, ease: EASE }}
            >
              {word}
            </motion.span>
            {index < words.length - 1 ? " " : null}
          </span>
        ))}
      </motion.span>
    </Tag>
  );
}
