import { ImageResponse } from "next/og";

export const alt = "Db Cinema Rentals — pro cinema gear hire in London";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: "radial-gradient(900px 500px at 50% 40%, #0c1626 0%, #060608 70%)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        {/* letterbox bars */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 44, background: "#000", display: "flex" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 44, background: "#000", display: "flex" }} />
        {/* corner brackets */}
        <div style={{ position: "absolute", top: 76, left: 64, width: 36, height: 36, borderTop: "3px solid rgba(255,255,255,0.35)", borderLeft: "3px solid rgba(255,255,255,0.35)", display: "flex" }} />
        <div style={{ position: "absolute", top: 76, right: 64, width: 36, height: 36, borderTop: "3px solid rgba(255,255,255,0.35)", borderRight: "3px solid rgba(255,255,255,0.35)", display: "flex" }} />
        <div style={{ position: "absolute", bottom: 76, left: 64, width: 36, height: 36, borderBottom: "3px solid rgba(255,255,255,0.35)", borderLeft: "3px solid rgba(255,255,255,0.35)", display: "flex" }} />
        <div style={{ position: "absolute", bottom: 76, right: 64, width: 36, height: 36, borderBottom: "3px solid rgba(255,255,255,0.35)", borderRight: "3px solid rgba(255,255,255,0.35)", display: "flex" }} />
        {/* REC */}
        <div style={{ position: "absolute", top: 88, left: 124, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 14, height: 14, borderRadius: 999, background: "#f43f5e", display: "flex" }} />
          <div style={{ fontSize: 22, letterSpacing: 6, color: "rgba(255,255,255,0.65)" }}>REC</div>
        </div>
        <div style={{ position: "absolute", top: 88, right: 124, fontSize: 22, letterSpacing: 4, color: "rgba(255,255,255,0.5)", display: "flex" }}>
          00:00:00:00
        </div>

        <div style={{ display: "flex", fontSize: 130, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>
          <span style={{ color: "#f4f4f5" }}>DB&nbsp;</span>
          <span style={{ color: "#38bdf8" }}>CINEMA</span>
        </div>
        <div style={{ fontSize: 38, color: "#9ca3af", marginTop: 26, display: "flex" }}>
          Pro cinema gear hire · London · delivered
        </div>
        <div style={{ fontSize: 24, color: "#64748b", marginTop: 34, letterSpacing: 5, display: "flex" }}>
          CAMERAS · LENSES · LIGHTING · AUDIO · DRONES
        </div>
      </div>
    ),
    { ...size },
  );
}
