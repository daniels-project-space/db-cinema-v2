import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { TIERS } from "@/lib/membership";
import { quote } from "@/lib/pricing";
import { SITE_FACTS } from "@/lib/botKnowledge";

const cx = () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const ms = (d: string) => {
  const t = Date.parse(/T/.test(d) ? d : d + "T00:00:00Z");
  return Number.isNaN(t) ? Date.now() : t;
};
// tolerate both Mastra execute signatures (input direct, or {context})
const inp = (a: any) => (a && a.context ? a.context : a) || {};

export const searchCatalog = createTool({
  id: "search_catalog",
  description:
    "Search the rental catalogue by keyword and/or category. Returns matching gear with daily-from prices and slugs. Use for 'do you have…' questions and recommendations.",
  inputSchema: z.object({ query: z.string().optional(), category: z.string().optional() }),
  execute: async (a: any) => {
    const { query, category } = inp(a);
    const v: any[] = await cx().query(api.catalog.listListings, {
      search: query || undefined,
      category: category || undefined,
    });
    return (v || []).slice(0, 7).map((l) => ({
      title: l.title,
      slug: l.slug,
      category: l.category,
      dailyFrom: l.pricing?.daily ?? null,
    }));
  },
});

export const getListing = createTool({
  id: "get_listing",
  description:
    "Get details for one item by slug: category and daily price. Accessories named in the title are INCLUDED in the price.",
  inputSchema: z.object({ slug: z.string() }),
  execute: async (a: any) => {
    const { slug } = inp(a);
    const l: any = await cx().query(api.catalog.getListingBySlug, { slug });
    if (!l) return { error: "no such item" };
    return {
      title: l.title,
      category: l.category,
      dailyFrom: l.pricing?.daily ?? null,
      note: "Accessories named in the title are included in the price.",
    };
  },
});

export const checkAvailability = createTool({
  id: "check_availability",
  description: "Check if an item (by slug) is available for a date range. Dates are YYYY-MM-DD.",
  inputSchema: z.object({ slug: z.string(), start: z.string(), end: z.string() }),
  execute: async (a: any) => {
    const { slug, start, end } = inp(a);
    const l: any = await cx().query(api.catalog.getListingBySlug, { slug });
    if (!l) return { error: "no such item" };
    const av: any = await cx().query(api.availability.forListing, {
      listingId: l._id,
      start: ms(start),
      end: ms(end),
    });
    return { title: l.title, available: av?.available ?? 0, isAvailable: (av?.available ?? 0) > 0 };
  },
});

export const quotePrice = createTool({
  id: "quote_price",
  description: "Get the price for an item (by slug) for N rental days, including the automatic multi-day discount.",
  inputSchema: z.object({ slug: z.string(), days: z.number() }),
  execute: async (a: any) => {
    const { slug, days } = inp(a);
    const l: any = await cx().query(api.catalog.getListingBySlug, { slug });
    if (!l) return { error: "no such item" };
    const q: any = quote(l.pricing, days);
    return { title: l.title, days, perDay: q.perDay, total: q.total };
  },
});

export const siteInfo = createTool({
  id: "site_info",
  description:
    "Facts about how Db Cinema works: opening hours, delivery, deposit/insurance, membership tiers, booking and cancellation.",
  inputSchema: z.object({}),
  execute: async () => {
    const mem = TIERS.map(
      (t) =>
        `${t.name} £${t.monthlyGbp}/mo: ${t.pct}% off` +
        (t.freeAccessories ? `, ${t.freeAccessories} free accessor${t.freeAccessories > 1 ? "ies" : "y"}/mo` : "") +
        (t.freeDelivery ? ", free delivery" : "") +
        (t.exclusiveOffers ? ", exclusive offers" : ""),
    ).join("; ");
    return { facts: SITE_FACTS, membership: mem };
  },
});

export const escalate = createTool({
  id: "escalate",
  description:
    "Hand off to the human team (complaints, damage, cancellations, refunds, bespoke deals, or anything you can't answer). Pass a short summary and the visitor's email if known.",
  inputSchema: z.object({ summary: z.string(), email: z.string().optional() }),
  execute: async (a: any) => {
    const { summary, email } = inp(a);
    await cx().mutation(api.contact.submit, {
      name: "Website chat",
      email: email || "chat@dbcinemarentals.com",
      message: summary,
    });
    return { ok: true };
  },
});
