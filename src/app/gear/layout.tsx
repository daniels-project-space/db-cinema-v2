import type { Metadata } from "next";

// Distinct, keyword-targeted metadata for the catalogue landing (the page itself is a client
// component, so its title/description live here in a server layout instead of the root default).
export const metadata: Metadata = {
  title: "Camera & Film Equipment Hire London — Browse the Catalogue",
  description:
    "Browse cinema cameras, lenses, lighting, audio and drones for hire in London. Sony, RED, ARRI, Blackmagic and more — daily, 3-day & weekly rates, delivered or collect in central London.",
  alternates: { canonical: "/gear" },
  openGraph: {
    title: "Camera & Film Equipment Hire London — Db Cinema Rentals",
    description:
      "Cinema cameras, lenses, lighting, audio and drones for hire across London. Daily rates, delivered.",
  },
};

export default function GearLayout({ children }: { children: React.ReactNode }) {
  return children;
}
