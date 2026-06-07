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
  proposals: z
    .array(z.object({ slug: z.string(), reason: z.string() }))
    .optional()
    .describe("items to offer as add-to-kit cards (must be real slugs from search_catalog)"),
  swaps: z
    .array(z.object({ removeSlug: z.string(), addSlug: z.string(), reason: z.string() }))
    .optional()
    .describe("substitutions: remove one item (red) and add a replacement (green)"),
});

async function buildOne(c: ConvexHttpClient, slug: string, start?: string, end?: string, checkAvail = true) {
  const l: any = await c.query(api.catalog.getListingBySlug, { slug });
  if (!l) return null;
  const have = !!(start && end);
  const days = have ? Math.max(1, Math.round((msOf(end!) - msOf(start!)) / 86400000) + 1) : 0;
  let available = true;
  if (have && checkAvail) {
    const av: any = await c.query(api.availability.forListing, {
      listingId: l._id,
      start: msOf(start!),
      end: msOf(end!),
    });
    available = (av?.available ?? 0) > 0;
  }
  const q: any = have ? quote(l.pricing, days) : null;
  return {
    listingId: l._id,
    slug: l.slug,
    title: l.title,
    image: l.heroImage ?? null,
    start: start ?? null,
    end: end ?? null,
    days,
    perDay: q ? q.perDay : l.pricing?.daily ?? null,
    total: q ? q.total : null,
    deposit: l.depositAmount ?? 0,
    available,
  };
}

async function buildCards(c: ConvexHttpClient, out: any) {
  const cards: any[] = [];
  if (!out?.start || !out?.end) return cards; // cards need a period
  for (const p of out.proposals ?? []) {
    const item = await buildOne(c, p.slug, out.start, out.end, true);
    if (item && item.available) cards.push({ kind: "add", reason: p.reason, item });
  }
  for (const s of out.swaps ?? []) {
    const removed = await buildOne(c, s.removeSlug, out.start, out.end, false);
    const added = await buildOne(c, s.addSlug, out.start, out.end, true);
    if (added && added.available) cards.push({ kind: "swap", reason: s.reason, removed, added });
  }
  return cards;
}

export async function POST(req: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY)
    return NextResponse.json({ reply: "The assistant isn't configured yet." });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reply: "Sorry, I didn't catch that." });
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
  // pass the kit already in the cart so the bot assembles around it
  if (body?.cart && Array.isArray(body.cart) && body.cart.length) {
    ctx += ` Items currently in their kit: ${body.cart.map((x: any) => `${x.title} (${x.start}→${x.end})`).join("; ")}.`;
  }

  const messages = ctx ? [{ role: "system", content: ctx }, ...history] : history;
  try {
    const agent = mastra.getAgent("renterBot");
    const res: any = await agent.generate(messages, { maxSteps: 6, structuredOutput: { schema: OUT } });
    const out: any = res?.object ?? res?.structuredOutput ?? null;
    const reply = out?.reply ?? res?.text ?? "How can I help with your shoot?";
    const cards = out ? await buildCards(c, out) : [];
    return NextResponse.json({ reply, cards });
  } catch {
    return NextResponse.json({
      reply: "Sorry, I'm having a moment — please try again, or reach us via the contact page.",
      cards: [],
    });
  }
}
