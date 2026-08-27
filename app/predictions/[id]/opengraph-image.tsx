import { ImageResponse } from "next/og";
import { getPredictionById } from "@/lib/data/public";

export const alt = "A verified prediction Receipt";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function PredictionOpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prediction = await getPredictionById(id);
  const expert = prediction?.expert.displayName ?? "Receipts";
  const claim = prediction?.normalizedClaim ?? "A source-backed public prediction record.";
  const status = prediction?.resolution?.outcome ?? prediction?.status ?? "record";
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center", background: "#ebe7dc", color: "#151515", padding: "46px" }}>
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#fffdf7", borderTop: "5px solid #151515", borderBottom: "5px solid #151515", padding: "42px 58px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 19, letterSpacing: 6, fontWeight: 800 }}><span>RECEIPTS</span><span>{status.toUpperCase()}</span></div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", borderTop: "2px dashed #888", borderBottom: "2px dashed #888", margin: "28px 0", padding: "28px 0" }}>
          <div style={{ fontSize: 25, fontWeight: 700 }}>{expert}</div>
          <div style={{ marginTop: 18, fontSize: claim.length > 150 ? 42 : 50, lineHeight: 1.08, fontWeight: 650 }}>{claim}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 }}><span>Source-backed · criteria frozen</span><span>#{id.slice(0, 8)}</span></div>
      </div>
    </div>,
    size,
  );
}
