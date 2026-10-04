// Hero backdrop: a slow-drifting light bloom seen through a dot screen and a
// faint square grid, fading to the page background at the bottom. Pure
// CSS/SVG so it costs nothing to load. A cursor-following light sits on top.
import { CursorSpotlight } from "@/components/motion/cursor-spotlight";

export function HeroField() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-[#060606]">
      <div className="animate-drift absolute -inset-[20%]">
        <div className="absolute top-[8%] left-[38%] h-[70%] w-[55%] rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.95),rgba(220,225,235,0.25)_50%,transparent)] blur-2xl" />
        <div className="absolute top-[30%] left-[10%] h-[50%] w-[40%] rounded-full bg-[radial-gradient(closest-side,rgba(170,180,200,0.55),transparent)] blur-3xl" />
      </div>
      {/* Dot screen turns the bloom into a halftone. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(6,6,6,0) 1.1px, rgba(6,6,6,0.92) 1.6px)",
          backgroundSize: "5px 5px",
        }}
      />
      <div className="grid-field absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
      <svg className="absolute inset-0 size-full opacity-[0.12] mix-blend-overlay">
        <filter id="hero-noise"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" /></filter>
        <rect width="100%" height="100%" filter="url(#hero-noise)" />
      </svg>
      <CursorSpotlight />
      <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-b from-transparent to-[#060606]" />
    </div>
  );
}
