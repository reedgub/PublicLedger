import { ImageResponse } from "next/og";
import { getExpertBySlug } from "@/lib/data/public";

export const alt = "An expert prediction track record on Project Lighthouse";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function ExpertOpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getExpertBySlug(slug);
  const card = result?.scorecard;
  const name = card?.expert.displayName ?? "Expert record";
  const accuracy = card?.accuracy == null ? "—" : `${Math.round(card.accuracy * 100)}%`;
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f4f1e8", color: "#151515", padding: "64px", border: "18px solid #151515" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, letterSpacing: 4, fontWeight: 800 }}><span>PROJECT LIGHTHOUSE</span><span>EXPERT RECORD</span></div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 40 }}>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 780 }}><div style={{ fontSize: 76, lineHeight: 1, fontWeight: 700 }}>{name}</div><div style={{ fontSize: 24, marginTop: 20 }}>Public, source-backed prediction history</div></div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}><div style={{ fontSize: 102, fontWeight: 700, letterSpacing: -7 }}>{accuracy}</div><div style={{ fontSize: 18, letterSpacing: 4 }}>ACCURACY</div></div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "3px solid #151515", paddingTop: 20, fontSize: 19 }}><span>{card?.resolvedPredictions ?? 0} resolved · {card?.openPredictions ?? 0} open</span><span>Frozen criteria · auditable outcomes</span></div>
    </div>,
    size,
  );
}
