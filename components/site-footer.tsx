import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-foreground bg-foreground text-background">
      <div className="container-page grid gap-10 py-10 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="font-mono text-sm font-black tracking-[0.2em]">PROJECT LIGHTHOUSE</p>
          <p className="editorial mt-4 max-w-xl text-2xl leading-tight text-background/80">
            A public record of falsifiable predictions—not a trust score, social network, or prediction market.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-8 gap-y-3 font-mono text-[10px] tracking-[0.1em] uppercase" aria-label="Footer navigation">
          <Link href="/methodology" className="hover:underline">Methodology</Link>
          <Link href="/submit" className="hover:underline">Submit a source</Link>
          <Link href="/leaderboard" className="hover:underline">Leaderboard</Link>
          <Link href="/admin" className="hover:underline">Admin</Link>
        </nav>
      </div>
    </footer>
  );
}
