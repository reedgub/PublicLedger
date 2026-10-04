"use client";

import { motion, useMotionTemplate, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef } from "react";

// A soft light that trails the cursor across the hero halftone.
export function CursorSpotlight() {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(-1000);
  const y = useMotionValue(-1000);
  const sx = useSpring(x, { stiffness: 120, damping: 24, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 120, damping: 24, mass: 0.6 });
  const background = useMotionTemplate`radial-gradient(420px circle at ${sx}px ${sy}px, rgba(255,255,255,0.22), rgba(255,255,255,0.06) 40%, transparent 70%)`;

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent || window.matchMedia("(pointer: coarse)").matches) return;
    const move = (event: PointerEvent) => {
      const rect = parent.getBoundingClientRect();
      x.set(event.clientX - rect.left);
      y.set(event.clientY - rect.top);
    };
    const leave = () => { x.set(-1000); y.set(-1000); };
    parent.addEventListener("pointermove", move);
    parent.addEventListener("pointerleave", leave);
    return () => {
      parent.removeEventListener("pointermove", move);
      parent.removeEventListener("pointerleave", leave);
    };
  }, [x, y]);

  return <motion.div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 mix-blend-screen" style={{ background }} />;
}
