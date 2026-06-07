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
          background: "linear-gradient(135deg,#0a0a0f 0%,#0d1424 60%,#0a0a0f 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 110, fontWeight: 800, letterSpacing: -3 }}>
          <span style={{ color: "#f4f4f5" }}>DB&nbsp;</span>
          <span style={{ color: "#38bdf8" }}>CINEMA</span>
        </div>
        <div style={{ fontSize: 36, color: "#9ca3af", marginTop: 20 }}>
          Pro cinema gear hire · London · delivered
        </div>
        <div style={{ fontSize: 24, color: "#6b7280", marginTop: 40 }}>
          Cameras · Lenses · Lighting · Audio · Drones
        </div>
      </div>
    ),
    { ...size },
  );
}
