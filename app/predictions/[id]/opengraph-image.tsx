import { ImageResponse } from "next/og";
import { getPredictionById } from "@/lib/data/public";

export const alt = "A verified public prediction on Project Lighthouse";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  correct: { bg: "#0f5132", fg: "#ecfdf5" },
  incorrect: { bg: "#7f1d1d", fg: "#fef2f2" },
  partial: { bg: "#78350f", fg: "#fffbeb" },
  ambiguous: { bg: "#3f3f46", fg: "#fafafa" },
  void: { bg: "#3f3f46", fg: "#fafafa" },
  open: { bg: "#151515", fg: "#fffdf7" },
  due: { bg: "#78350f", fg: "#fffbeb" },
  resolution_pending: { bg: "#78350f", fg: "#fffbeb" },
};

export default async function PredictionOpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const prediction = await getPredictionById(id);
  const expert = prediction?.expert.displayName ?? "Project Lighthouse";
  const claim = prediction?.normalizedClaim ?? "A source-backed public prediction record.";
  const status = prediction?.resolution?.outcome ?? prediction?.status ?? "record";
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.open;
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center", background: "#ebe7dc", color: "#151515", padding: "46px" }}>
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#fffdf7", borderTop: "5px solid #151515", borderBottom: "5px solid #151515", padding: "42px 58px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 19, letterSpacing: 4, fontWeight: 800 }}>
          <span>PROJECT LIGHTHOUSE</span>
          <span style={{ background: colors.bg, color: colors.fg, padding: "8px 16px", letterSpacing: 3 }}>{status.toUpperCase().replace(/_/g, " ")}</span>
        </div>
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
