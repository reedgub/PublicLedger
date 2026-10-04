// Light beams that travel along the stat grid's hairlines, Vercel-style.
export function BeamGrid() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[20px]">
      <span className="beam-h absolute top-0 left-0 h-px w-40" />
      <span className="beam-h absolute bottom-0 left-0 h-px w-40 [animation-delay:-3.5s]" />
      <span className="beam-v absolute top-0 left-1/4 hidden h-24 w-px lg:block" />
      <span className="beam-v absolute top-0 left-1/2 hidden h-24 w-px [animation-delay:-2s] sm:block" />
      <span className="beam-v absolute top-0 left-3/4 hidden h-24 w-px [animation-delay:-4s] lg:block" />
    </div>
  );
}
