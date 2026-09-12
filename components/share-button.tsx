"use client";

import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";

export function ShareButton({ title, text }: { title: string; text: string }) {
  async function share() {
    track("share_click");
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title, text, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) toast.error("Could not share this prediction");
    }
  }
  return <Button variant="outline" onClick={share} className="rounded-none border-foreground"><Share2 /> Share</Button>;
}
