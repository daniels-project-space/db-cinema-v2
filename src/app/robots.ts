import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

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
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
