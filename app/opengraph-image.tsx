import { ImageResponse } from "next/og";

export const alt = "PublicLedger — a public record of predictions";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#060606", color: "#ffffff", padding: "64px", border: "18px solid #ffffff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, letterSpacing: 1, fontWeight: 800 }}><span>PublicLedger</span><span>PUBLIC RECORD</span></div>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 980 }}>
        <div style={{ fontSize: 96, lineHeight: 0.95, fontWeight: 700, letterSpacing: -3 }}>PUBLIC PREDICTIONS.</div>
        <div style={{ fontSize: 96, lineHeight: 0.95, fontWeight: 700, letterSpacing: -3 }}>PUBLIC OUTCOMES.</div>
        <div style={{ marginTop: 28, fontSize: 26, lineHeight: 1.3, color: "#a3a3a3" }}>Source-backed. Frozen criteria. Auditable outcomes.</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.2)", paddingTop: 20, fontSize: 20 }}><span>publicledger.dev</span><span>Check the track record.</span></div>
    </div>,
    size,
  );
}
