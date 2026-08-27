import { ImageResponse } from "next/og";

export const alt = "Receipts — a public record of predictions";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f4f1e8", color: "#151515", padding: "64px", border: "18px solid #151515" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, letterSpacing: 8, fontWeight: 800 }}><span>RECEIPTS</span><span>PUBLIC RECORD</span></div>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 980 }}>
        <div style={{ fontSize: 82, lineHeight: 0.98, fontWeight: 700 }}>Who&apos;s been right?</div>
        <div style={{ marginTop: 28, fontSize: 29, lineHeight: 1.25 }}>Source-backed predictions. Frozen criteria. Auditable outcomes.</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "3px solid #151515", paddingTop: 20, fontSize: 20 }}><span>Every forecast leaves a receipt.</span><span>receipts</span></div>
    </div>,
    size,
  );
}
