import { ImageResponse } from "next/og";

export const alt = "Project Lighthouse — a public record of predictions";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f4f1e8", color: "#151515", padding: "64px", border: "18px solid #151515" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, letterSpacing: 4, fontWeight: 800 }}><span>PROJECT LIGHTHOUSE</span><span>PUBLIC RECORD</span></div>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 980 }}>
        <div style={{ fontSize: 96, lineHeight: 0.95, fontWeight: 700, letterSpacing: -3 }}>PUBLIC PREDICTIONS.</div>
        <div style={{ fontSize: 96, lineHeight: 0.95, fontWeight: 700, letterSpacing: -3 }}>PUBLIC OUTCOMES.</div>
        <div style={{ marginTop: 28, fontSize: 26, lineHeight: 1.3, color: "#4a4a4a" }}>Source-backed. Frozen criteria. Auditable outcomes.</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "3px solid #151515", paddingTop: 20, fontSize: 20 }}><span>projectlighthouse.dev</span><span>Check the track record.</span></div>
    </div>,
    size,
  );
}
