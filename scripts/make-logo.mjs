import sharp from "sharp";
import { writeFileSync } from "node:fs";

const ACCENT = "#f97316", ACCENT2 = "#ea580c", ACCENT_L = "#fb923c";

// a row of little "film strip" squares
const filmStrip = (y, n, w, gap, x0, size) =>
  Array.from({ length: n }, (_, i) =>
    `<rect x="${x0 + i * (w + gap)}" y="${y}" width="${w}" height="${size}" rx="3" fill="#ffffff" fill-opacity="0.10"/>`
  ).join("");

const defs = `
  <defs>
    <radialGradient id="bg" cx="50%" cy="36%" r="80%">
      <stop offset="0%" stop-color="#211b16"/><stop offset="60%" stop-color="#0f0d0b"/><stop offset="100%" stop-color="#080807"/>
    </radialGradient>
    <linearGradient id="or" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${ACCENT_L}"/><stop offset="100%" stop-color="${ACCENT2}"/>
    </linearGradient>
  </defs>`;

// aperture-style ring mark
const aperture = (cx, cy, r) => {
  const blades = Array.from({ length: 6 }, (_, i) => {
    const a = (i * 60 + 20) * Math.PI / 180;
    return `<line x1="${cx + Math.cos(a) * r * 0.32}" y1="${cy + Math.sin(a) * r * 0.32}" x2="${cx + Math.cos(a) * r * 0.92}" y2="${cy + Math.sin(a) * r * 0.92}" stroke="url(#or)" stroke-width="${r * 0.07}" stroke-linecap="round" opacity="0.9"/>`;
  }).join("");
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#or)" stroke-width="${r * 0.12}"/>${blades}<circle cx="${cx}" cy="${cy}" r="${r * 0.16}" fill="${ACCENT}"/>`;
};

// ---- square logo 1024x1024 ----
const logo = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <rect width="1024" height="1024" rx="180" fill="url(#bg)"/>
  <rect x="64" y="64" width="896" height="896" rx="130" fill="none" stroke="${ACCENT}" stroke-opacity="0.45" stroke-width="5"/>
  ${filmStrip(120, 11, 48, 26, 120, 30)}
  ${filmStrip(874, 11, 48, 26, 120, 30)}
  ${aperture(512, 340, 120)}
  <text x="512" y="640" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="240" letter-spacing="6" fill="#ffffff">DB</text>
  <text x="512" y="752" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="104" letter-spacing="20" fill="url(#or)">CINEMA</text>
  <text x="512" y="824" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="40" letter-spacing="22" fill="#b8b0a8">RENTALS &#183; LONDON</text>
</svg>`;

// ---- landscape cover 1200x675 ----
const cover = `<svg width="1200" height="675" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <rect width="1200" height="675" fill="url(#bg)"/>
  ${filmStrip(40, 18, 44, 24, 40, 26)}
  ${filmStrip(609, 18, 44, 24, 40, 26)}
  ${aperture(238, 338, 120)}
  <text x="430" y="320" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="150" letter-spacing="2" fill="#ffffff">DB <tspan fill="${ACCENT}">CINEMA</tspan></text>
  <text x="434" y="392" font-family="DejaVu Sans, Arial, sans-serif" font-size="40" letter-spacing="14" fill="#b8b0a8">CAMERA &#183; LENS &#183; LIGHTING RENTALS &#8212; LONDON</text>
</svg>`;

await sharp(Buffer.from(logo)).png().toFile("public/db-cinema-logo.png");
await sharp(Buffer.from(logo)).resize(512, 512).png().toFile("public/db-cinema-logo-512.png");
await sharp(Buffer.from(cover)).png().toFile("public/db-cinema-cover.png");
console.log("wrote public/db-cinema-logo.png (1024), -512, and db-cinema-cover.png (1200x675)");
