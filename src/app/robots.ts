import type { MetadataRoute } from "next";

// Indexable only once NEXT_PUBLIC_SITE_LIVE=true (set at launch).
const LIVE = process.env.NEXT_PUBLIC_SITE_LIVE === "true";

export default function robots(): MetadataRoute.Robots {
  if (!LIVE) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/checkout", "/account", "/verify"],
    },
    sitemap: "https://dbcinemarentals.com/sitemap.xml",
    host: "https://dbcinemarentals.com",
  };
}
