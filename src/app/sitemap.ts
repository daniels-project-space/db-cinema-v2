import type { MetadataRoute } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";

const BASE = "https://dbcinemarentals.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/gear`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/membership`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/how-it-works`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/about`, changeFrequency: "monthly", priority: 0.5 },
  ];
  let gear: MetadataRoute.Sitemap = [];
  try {
    const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const slugs: { slug: string }[] = await c.query(api.catalog.allSlugs, {});
    gear = slugs.map((s) => ({
      url: `${BASE}/gear/${s.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
  } catch {
    // sitemap still valid with static routes if Convex is unreachable at build
  }
  return [...statics, ...gear];
}
