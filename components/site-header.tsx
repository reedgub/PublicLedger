"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const links = [
  ["Topics", "/topics"],
  ["Experts", "/experts"],
  ["Leaderboard", "/leaderboard"],
  ["Submit", "/submit"],
] as const;

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-foreground/80 bg-background/95 backdrop-blur-sm">
      <div className="container-receipts flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-3" aria-label="Receipts home">
          <span className="font-mono text-[15px] font-black tracking-[0.22em]">RECEIPTS</span>
          <span className="hidden border-l border-border pl-3 font-mono text-[9px] tracking-[0.12em] text-muted-foreground uppercase lg:inline">Public record / v0.1</span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary navigation">
          {links.map(([label, href]) => (
            <Link key={href} href={href} className="font-mono text-[11px] font-semibold tracking-[0.08em] uppercase hover:underline hover:underline-offset-4">
              {label}
            </Link>
          ))}
          <Link href="/#search" className="flex size-8 items-center justify-center border border-foreground" aria-label="Search Receipts">
            <Search className="size-4" />
          </Link>
        </nav>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <SheetContent className="w-[88%] bg-background p-0" side="right">
            <SheetHeader className="border-b border-foreground px-5 py-5 text-left">
              <SheetTitle className="font-mono text-sm font-black tracking-[0.2em]">RECEIPTS</SheetTitle>
              <SheetDescription>Don&apos;t trust the title. Check the track record.</SheetDescription>
            </SheetHeader>
            <nav className="flex flex-col" aria-label="Mobile navigation">
              {links.map(([label, href], index) => (
                <Link key={href} href={href} onClick={() => setMobileOpen(false)} className="editorial flex items-center justify-between border-b px-5 py-5 text-3xl">
                  <span>{label}</span><span className="metric text-xs text-muted-foreground">0{index + 1}</span>
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
