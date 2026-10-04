"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PixelButton } from "@/components/brand/pixel-button";
import { Wordmark } from "@/components/brand/wordmark";
import { ScrollProgress } from "@/components/motion/scroll-progress";

const links = [
  ["Topics", "/topics"],
  ["Experts", "/experts"],
  ["Leaderboard", "/leaderboard"],
  ["Methodology", "/methodology"],
] as const;

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <header className="glass sticky top-0 z-40 border-b border-white/[0.06]">
      <div className="container-page flex h-[72px] items-center justify-between gap-6">
        <Link href="/" aria-label="PublicLedger home">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary navigation">
          {links.map(([label, href]) => (
            <Link key={href} href={href} className="text-[13px] font-medium tracking-[0.06em] uppercase text-white/75 transition-colors hover:text-white">
              {label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <Link href="/#search" className="flex size-11 items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.06] text-white/80 transition-colors hover:text-white" aria-label="Search predictions">
            <Search className="size-4" />
          </Link>
          <PixelButton href="/submit">Submit a source</PixelButton>
        </div>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <SheetContent className="w-[88%] border-white/10 bg-background p-0" side="right">
            <SheetHeader className="border-b border-white/10 px-5 py-6 text-left">
              <SheetTitle><Wordmark /></SheetTitle>
              <SheetDescription>Don&apos;t trust the title. Check the track record.</SheetDescription>
            </SheetHeader>
            <nav className="flex flex-col" aria-label="Mobile navigation">
              {[...links, ["Submit a source", "/submit"] as const].map(([label, href], index) => (
                <Link key={href} href={href} onClick={() => setMobileOpen(false)} className="editorial flex items-center justify-between border-b border-white/10 px-5 py-5 text-2xl uppercase">
                  <span>{label}</span><span className="metric text-xs text-muted-foreground">0{index + 1}</span>
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
      <ScrollProgress />
    </header>
  );
}
