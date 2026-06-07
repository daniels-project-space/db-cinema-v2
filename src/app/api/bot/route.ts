import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { mastra } from "@/mastra";
import { quote } from "@/lib/pricing";

export const maxDuration = 60;

const msOf = (d: string) => {
  const t = Date.parse(/T/.test(d) ? d : d + "T00:00:00Z");
  return Number.isNaN(t) ? 0 : t;
};

const OUT = z.object({
  reply: z.string().describe("short conversational reply to the customer"),
  start: z.string().optional().describe("rental start YYYY-MM-DD if known"),
  end: z.string().optional().describe("rental end YYYY-MM-DD if known"),
  wantsKit: z.boolean().optional().describe("true if the customer wants gear recommended or a kit built"),
  itemTypes: z
    .array(z.string())
    .optional()
    .describe("gear types to include, e.g. ['camera','lens','gimbal','light','nd-filter','battery','monitor','mic','tripod']"),
  proposals: z.array(z.object({ slug: z.string(), reason: z.string() })).optional(),
  swaps: z.array(z.object({ removeSlug: z.string(), addSlug: z.string(), reason: z.string() })).optional(),
});

const TERM: Record<string, string> = {
  "camera-body": "camera", camera: "camera", lens: "lens", lenses: "lens",
  gimbal: "gimbal", light: "light", lighting: "light", "nd-filter": "filter",
  filter: "filter", battery: "battery", monitor: "monitor", "wireless-mic": "mic",
  mic: "mic", audio: "mic", tripod: "tripod", drone: "drone", speaker: "speaker",
};

async function buildOne(c: ConvexHttpClient, slugOrTerm: string, start: string, end: string, checkAvail = true) {
  let l: any = await c.query(api.catalog.getListingBySlug, { slug: slugOrTerm });
  if (!l) {
    const r: any[] = await c.query(api.catalog.listListings, { search: slugOrTerm.replace(/-/g, " ") });
    l = (r || [])[0];
  }
  if (!l) return null;
  const days = Math.max(1, Math.round((msOf(end) - msOf(start)) / 86400000) + 1);
  let available = true;
  if (checkAvail) {
    const av: any = await c.query(api.availability.forListing, { listingId: l._id, start: msOf(start), end: msOf(end) });
    available = (av?.available ?? 0) > 0;
  }
  const q: any = quote(l.pricing, days);
  return {
    listingId: l._id, slug: l.slug, title: l.title, image: l.heroImage ?? null,
    start, end, days, perDay: q.perDay, total: q.total, deposit: l.depositAmount ?? 0, available,
    itemType: l.itemType ?? null, mount: l.specs?.mount ?? null, lensClass: l.specs?.lensClass ?? null,
  };
}

function lensFits(lensMount: string | null, camMounts: string[]) {
  if (!lensMount || camMounts.length === 0) return true;
  if (camMounts.every((m) => m === "fixed")) return false;
  return camMounts.some((m) => m === lensMount || (lensMount === "EF" && (m === "E" || m === "RF")));
}

async function firstAvailableByType(c: ConvexHttpClient, type: string, start: string, end: string, seen: Set<string>, camMounts: string[] = []) {
  const term = TERM[type] || type;
  const r: any[] = await c.query(api.catalog.listListings, { search: term });
  let fallback: any = null;
  for (const l of r || []) {
    if (seen.has(l._id)) continue;
    const item = await buildOne(c, l.slug, start, end, true);
    if (!item || !item.available) continue;
    if (item.itemType === "lens") {
      if (!lensFits(item.mount, camMounts)) continue;
      if (item.lensClass === "af") return item; // prefer autofocus glass for default kits
      if (!fallback) fallback = item;
      continue;
    }
    return item;
  }
  return fallback;
}

async function buildCards(c: ConvexHttpClient, out: any, camMounts: string[] = []) {
  const cards: any[] = [];
  if (!out?.start || !out?.end) return cards;
  const seen = new Set<string>();
  for (const p of out.proposals ?? []) {
    const item = await buildOne(c, p.slug, out.start, out.end, true);
    // never propose a lens that won't mount on the camera already in the kit
    if (item && item.itemType === "lens" && !lensFits(item.mount, camMounts)) continue;
    if (item && item.available && !seen.has(item.listingId)) {
      seen.add(item.listingId);
      cards.push({ kind: "add", reason: p.reason, item });
    }
  }
  for (const s of out.swaps ?? []) {
    const removed = await buildOne(c, s.removeSlug, out.start, out.end, false);
    const added = await buildOne(c, s.addSlug, out.start, out.end, true);
    if (added && added.available && !seen.has(added.listingId)) {
      seen.add(added.listingId);
      cards.push({ kind: "swap", reason: s.reason, removed, added });
    }
  }
  // deterministic kit fill: guarantee available cards even if the model's slugs miss
  if (out.wantsKit && cards.length < 5) {
    const types = out.itemTypes?.length ? out.itemTypes : ["camera", "lens", "light"];
    for (const t of types) {
      if (cards.length >= 6) break;
      const item = await firstAvailableByType(c, t, out.start, out.end, seen, camMounts);
      if (item) {
        seen.add(item.listingId);
        cards.push({ kind: "add", reason: `Recommended ${t}`, item });
      }
    }
  }
  return cards;
}

export async function POST(req: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY)
    return NextResponse.json({ reply: "The assistant isn't configured yet.", cards: [] });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reply: "Sorry, I didn't catch that.", cards: [] });
  }
  const history = Array.isArray(body?.messages) ? body.messages.slice(-12) : [];
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

  let ctx = "";
  if (body?.token) {
    try {
      const me: any = await c.query(api.accounts.me, { token: body.token });
      if (me) {
        ctx = `Signed-in customer: ${me.name || me.email}` + (me.membershipActive ? ` (${me.membershipTier} member)` : "") + ".";
        const bk: any = await c.query(api.accounts.myBookings, { token: body.token });
        if (Array.isArray(bk) && bk.length)
          ctx += ` Latest booking is ${bk[0].status}: ${bk[0].lineItems.map((li: any) => li.title).join(", ")}.`;
      }
    } catch {}
  }
  // camera mounts already in the kit — to refuse incompatible lens proposals
  let camMounts: string[] = [];
  if (Array.isArray(body?.cart) && body.cart.length) {
    ctx += ` Items currently in their kit: ${body.cart.map((x: any) => `${x.title} (${x.start}→${x.end})`).join("; ")}.`;
    try {
      const ids = body.cart.map((x: any) => x.listingId).filter(Boolean);
      if (ids.length) {
        const cds: any[] = await c.query(api.catalog.listingsByIds, { ids });
        camMounts = cds.filter((cd) => cd.itemType === "camera-body" && cd.specs?.mount).map((cd) => cd.specs.mount);
      }
    } catch {}
  }

  const messages = ctx ? [{ role: "system", content: ctx }, ...history] : history;
  try {
    const agent = mastra.getAgent("renterBot");
    const res: any = await agent.generate(messages, { maxSteps: 12, structuredOutput: { schema: OUT } });
    const out: any = res?.object ?? res?.structuredOutput ?? null;
    if (out && (!out.start || !out.end)) {
      const joined = history.map((m: any) => String(m.content || "")).join(" ");
      const ds = joined.match(/\d{4}-\d{2}-\d{2}/g);
      if (ds && ds.length >= 2) {
        out.start = out.start || ds[ds.length - 2];
        out.end = out.end || ds[ds.length - 1];
      }
    }
    const reply = out?.reply ?? res?.text ?? "How can I help with your shoot?";
    let cards = out ? await buildCards(c, out, camMounts) : [];
    // safety net: if they clearly asked for a kit but the model returned none, build a default
    const lastUser = [...history].reverse().find((m: any) => m.role === "user")?.content || "";
    if (out?.start && out?.end && cards.length === 0 && /\b(kit|build|assemble|recommend|set ?up|shoot|gear for|need)\b/i.test(lastUser)) {
      out.wantsKit = true;
      out.itemTypes = out.itemTypes?.length ? out.itemTypes : ["camera", "lens", "light", "mic"];
      cards = await buildCards(c, out, camMounts);
    }
    return NextResponse.json({ reply, cards });
  } catch {
    return NextResponse.json({
      reply: "Sorry, I'm having a moment — please try again, or reach us via the contact page.",
      cards: [],
    });
  }
}
