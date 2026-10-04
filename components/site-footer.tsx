import Link from "next/link";
import { PixelButton } from "@/components/brand/pixel-button";
import { SectionLabel } from "@/components/brand/section-label";
import { Wordmark } from "@/components/brand/wordmark";

const quickLinks = [
  ["Home", "/"],
  ["Topics", "/topics"],
  ["Experts", "/experts"],
  ["Leaderboard", "/leaderboard"],
] as const;

const otherLinks = [
  ["Methodology", "/methodology"],
  ["Submit a source", "/submit"],
  ["Admin", "/admin"],
] as const;

export function SiteFooter() {
  const year = new Date().getUTCFullYear();
  return (
    <footer className="mt-32 px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="surface-light overflow-hidden rounded-[20px]">
        <div className="container-page grid gap-12 py-16 md:grid-cols-[1.3fr_1fr] md:py-20">
          <div>
            <SectionLabel>Get started</SectionLabel>
            <p className="display-2 mt-5 max-w-lg text-balance">Don&apos;t trust the title. Check the track record.</p>
            <p className="lede mt-5 max-w-md">A public record of falsifiable predictions — not a trust score, social network, or prediction market.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PixelButton href="/leaderboard" variant="dark">See the leaderboard</PixelButton>
              <PixelButton href="/submit" variant="dark" className="bg-transparent text-[#060606] border-[rgba(6,6,6,0.12)] hover:bg-black/[0.04]">Submit a source</PixelButton>
            </div>
          </div>
          <nav className="grid grid-cols-2 gap-8" aria-label="Footer navigation">
            <div>
              <p className="font-mono text-[13px] font-light uppercase tracking-[0.02em] text-muted-foreground">Quick links</p>
              <ul className="mt-5 space-y-3">
                {quickLinks.map(([label, href]) => <li key={href}><Link href={href} className="text-lg font-medium opacity-80 transition-opacity hover:opacity-100">{label}</Link></li>)}
              </ul>
            </div>
            <div>
              <p className="font-mono text-[13px] font-light uppercase tracking-[0.02em] text-muted-foreground">Other links</p>
              <ul className="mt-5 space-y-3">
                {otherLinks.map(([label, href]) => <li key={href}><Link href={href} className="text-lg font-medium opacity-80 transition-opacity hover:opacity-100">{label}</Link></li>)}
              </ul>
            </div>
          </nav>
        </div>
        <div className="container-page flex flex-wrap items-center justify-between gap-4 border-t border-border py-6">
          <Wordmark />
          <p className="font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground">©{year} PublicLedger · Every claim linked to its source</p>
        </div>
        <div aria-hidden="true" className="pointer-events-none select-none overflow-hidden px-4 sm:px-6 lg:px-10">
          <p className="translate-y-[18%] text-center text-[17.5vw] leading-[0.8] font-medium tracking-[-0.06em] text-[#060606]" style={{ fontVariationSettings: '"opsz" 32' }}>publicledger</p>
        </div>
      </div>
    </footer>
  );
}
