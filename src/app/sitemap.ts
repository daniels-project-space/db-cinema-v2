import type { MetadataRoute } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { GUIDES } from "@/lib/guides";

import { SITE_URL as BASE } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // lastModified signals freshness so Google re-crawls (e.g. now the site became crawlable).
  const now = new Date();
  const statics: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/gear`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/membership`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/guides`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/how-it-works`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
  const guides: MetadataRoute.Sitemap = GUIDES.map((g) => ({
    url: `${BASE}/guides/${g.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
  let gear: MetadataRoute.Sitemap = [];
  try {
    const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const slugs: { slug: string }[] = await c.query(api.catalog.allSlugs, {});
    gear = slugs.map((s) => ({
      url: `${BASE}/gear/${s.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
  } catch {
    // sitemap still valid with static routes if Convex is unreachable at build
  }
  return [...statics, ...guides, ...gear];
}
