"use client";

import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "motion/react";
import { CalendarClock, FileCheck2, Link2, Lock, Quote } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

const STEPS = [
  { icon: Quote, title: "The quote is captured", body: "We store the speaker's exact words — a verbatim substring of the original post — with a link back to the source." },
  { icon: Lock, title: "The claim is frozen", body: "An editor normalizes it into one falsifiable sentence with resolution criteria. From publication on, it can't be quietly edited." },
  { icon: CalendarClock, title: "The clock starts", body: "Every record carries a hard deadline. Nobody gets to move the goalposts once the date is set." },
  { icon: FileCheck2, title: "The verdict lands", body: "At the deadline, evidence is checked and independently reviewed. Only then does the outcome reach a scorecard." },
];

const EASE = [0.16, 1, 0.3, 1] as const;

// Maps overall progress to a 0→1 ramp for one step's window.
function useStep(progress: MotionValue<number>, index: number) {
  // Steps play across the first 85% of the pin so the finished card holds briefly before release.
  const start = (index / STEPS.length) * 0.85;
  return useTransform(progress, [start, start + 0.55 / STEPS.length], [0, 1], { clamp: true });
}

// Apple-style pinned story: the section sticks while scrolling drives an
// illustrative record card through capture → freeze → deadline → verdict.
export function RecordStory() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (value) => setActive(Math.min(STEPS.length - 1, Math.floor((value / 0.85) * STEPS.length))));

  const s0 = useStep(scrollYProgress, 0);
  const s1 = useStep(scrollYProgress, 1);
  const s2 = useStep(scrollYProgress, 2);
  const s3 = useStep(scrollYProgress, 3);

  const highlight = useTransform(s0, [0.2, 1], ["0%", "100%"]);
  const claimOpacity = useTransform(s1, [0, 0.6], [0, 1]);
  const claimY = useTransform(s1, [0, 1], [24, 0]);
  const lockScale = useTransform(s1, [0.4, 0.8, 1], [0.4, 1.2, 1]);
  const lockOpacity = useTransform(s1, [0.4, 0.7], [0, 1]);
  const deadlineOpacity = useTransform(s2, [0, 0.5], [0, 1]);
  const deadlineBar = useTransform(s2, [0.2, 1], ["0%", "100%"]);
  const verdictScale = useTransform(s3, [0.2, 0.75, 1], [2.2, 0.94, 1]);
  const verdictOpacity = useTransform(s3, [0.2, 0.5], [0, 1]);
  const verdictRotate = useTransform(s3, [0.2, 1], [-18, -6]);
  const evidenceOpacity = useTransform(s3, [0.6, 1], [0, 1]);
  const progressHeight = useTransform(scrollYProgress, [0, 0.85], ["0%", "100%"]);
  const cueOpacity = useTransform(scrollYProgress, [0.75, 0.88], [1, 0]);

  return (
    <section ref={ref} className="relative h-[280vh]" aria-label="How a record is made">
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="container-page grid w-full items-center gap-10 pt-[72px] lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          {/* Steps */}
          <div className="relative">
            <p className="flex items-center gap-3 font-mono text-[13px] font-light tracking-[0.02em] uppercase text-muted-foreground">
              <span className="hatch text-foreground" aria-hidden="true" />How a record is made
            </p>
            <div className="relative mt-8 pl-6">
              <div className="absolute top-0 bottom-0 left-0 w-px bg-white/10" />
              <motion.div className="absolute top-0 left-0 w-px bg-white" style={{ height: progressHeight }} />
              <ol className="space-y-7">
                {STEPS.map((step, index) => {
                  const Icon = step.icon;
                  const on = index === active;
                  return (
                    <li key={step.title} className={cn("transition-all duration-500", on ? "opacity-100" : "opacity-30", !on && "max-lg:hidden")}>
                      <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.04em] text-white/60">
                        <Icon className="size-3.5" />Step {String(index + 1).padStart(2, "0")}
                      </p>
                      <h3 className="mt-2 text-[28px] leading-[1.1] tracking-[-0.03em] sm:text-[34px]">{step.title}</h3>
                      <motion.p
                        initial={false}
                        animate={{ height: on ? "auto" : 0, opacity: on ? 1 : 0 }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="max-w-md overflow-hidden text-[15px] leading-relaxed font-light text-white/65"
                      >
                        <span className="block pt-3">{step.body}</span>
                      </motion.p>
                    </li>
                  );
                })}
              </ol>
            </div>
            <motion.p
              className="mt-10 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.04em] text-white/45"
              style={{ opacity: cueOpacity }}
            >
              <span className="relative flex h-5 w-3 justify-center rounded-full border border-white/30">
                <span className="animate-scroll-cue mt-1 block size-1 rounded-full bg-white" />
              </span>
              Keep scrolling · step {active + 1} of {STEPS.length}
            </motion.p>
          </div>

          {/* Illustrative record */}
          <div className="relative">
            <div aria-hidden="true" className="absolute -inset-10 rounded-[40px] bg-[radial-gradient(closest-side,rgba(255,255,255,0.09),transparent)] blur-2xl" />
            <div className="grid-field relative overflow-hidden rounded-[20px] border border-white/10 bg-[#0b0b0b] p-6 pb-24 shadow-[0_40px_120px_rgba(0,0,0,0.6)] sm:p-8 sm:pb-28">
              <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.04em] text-white/50">
                <span className="max-sm:hidden">Record / illustration</span>
                <span className="rounded-full border border-white/15 px-2 py-0.5 whitespace-nowrap">Not a real prediction</span>
              </div>

              {/* 1. Quote */}
              <div className="mt-7">
                <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-white/45">Original statement</p>
                <blockquote className="mt-3 text-[19px] leading-[1.45] tracking-[-0.01em] text-white/85 sm:text-[22px]">
                  &ldquo;I think{" "}
                  <span className="relative whitespace-nowrap">
                    <motion.span aria-hidden="true" className="absolute inset-y-[0.08em] left-0 -z-0 rounded-[3px] bg-white/[0.16]" style={{ width: highlight }} />
                    <span className="relative">inflation drops below 3%</span>
                  </span>{" "}
                  before the year is out.&rdquo;
                </blockquote>
                <p className="mt-3 flex items-center gap-2 font-mono text-[11px] text-white/45"><Link2 className="size-3" />Example speaker · source link · exact substring</p>
              </div>

              {/* 2. Claim */}
              <motion.div className="mt-6 rounded-[14px] border border-white/10 bg-white/[0.03] p-4" style={{ opacity: claimOpacity, y: claimY }}>
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-white/45">Normalized claim</p>
                  <motion.span className="flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-[#060606]" style={{ scale: lockScale, opacity: lockOpacity }}>
                    <Lock className="size-3" />Frozen
                  </motion.span>
                </div>
                <p className="mt-2 text-[17px] leading-snug">Year-over-year CPI inflation will be below 3.0% by December 31.</p>
              </motion.div>

              {/* 3. Deadline */}
              <motion.div className="mt-4 rounded-[14px] border border-white/10 bg-white/[0.03] p-4" style={{ opacity: deadlineOpacity }}>
                <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.04em] text-white/45">
                  <span className="flex items-center gap-1.5"><CalendarClock className="size-3" />Deadline</span>
                  <span className="text-white/80">Dec 31</span>
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
                  <motion.div className="h-full rounded-full bg-white" style={{ width: deadlineBar }} />
                </div>
              </motion.div>

              {/* 4. Verdict */}
              <motion.p className="mt-5 flex items-center gap-2 font-mono text-[11px] text-white/50" style={{ opacity: evidenceOpacity }}>
                <FileCheck2 className="size-3.5" />Evidence cited · independently reviewed
              </motion.p>
              <motion.div
                aria-hidden={active < 3}
                className="pointer-events-none absolute right-6 bottom-6 rounded-[10px] border-2 border-correct bg-[#0b0b0b]/80 px-4 py-2 backdrop-blur-sm font-mono text-lg font-medium tracking-[0.08em] text-correct uppercase sm:right-10 sm:text-2xl"
                style={{ scale: verdictScale, opacity: verdictOpacity, rotate: verdictRotate }}
              >
                Verdict: correct
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
