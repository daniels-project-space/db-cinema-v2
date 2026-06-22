import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Db Cinema Rentals",
    short_name: "Db Cinema",
    description: "Pro film & cinema gear, delivered across London.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    icons: [
      { src: "/db-cinema-logo-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
