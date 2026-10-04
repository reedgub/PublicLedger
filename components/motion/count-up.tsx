"use client";

import { animate, useInView } from "motion/react";
import { useEffect, useRef } from "react";

const format = (value: number) => new Intl.NumberFormat("en-US").format(Math.round(value));

// Server-renders the real number, then counts up from zero when it scrolls into view.
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });

  useEffect(() => {
    const node = ref.current;
    if (!node || !inView || value === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const controls = animate(0, value, { duration: 1.8, ease: [0.16, 1, 0.3, 1], onUpdate: (latest) => { node.textContent = format(latest); } });
    return () => controls.stop();
  }, [inView, value]);

  return <span ref={ref} className={className}>{format(value)}</span>;
}
