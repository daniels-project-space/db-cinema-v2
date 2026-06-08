import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { mastra } from "@/mastra";
import { quote } from "@/lib/pricing";
import { tierByKey } from "@/lib/membership";
import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// deterministic, grounded Q&A: retrieve item knowledge then answer with a plain LLM call
async function knowledgeAnswer(c: ConvexHttpClient, userMsg: string, memberPct: number): Promise<string | null> {
  try {
    const STOP = new Set(["what", "are", "the", "limitations", "limits", "of", "and", "or", "should", "i", "pair", "with", "it", "does", "do", "work", "for", "an", "my", "to", "is", "can", "you", "will", "how", "much", "price", "about", "tell", "me", "on", "use", "using", "need", "that", "this", "they", "them", "get", "have", "has", "which", "good", "best", "vs", "compatible", "compatibility", "lens", "camera"]);
    const allToks = (userMsg.toLowerCase().match(/[a-z0-9][a-z0-9-]+/g) || []).filter((t) => !STOP.has(t));
    const distinctive = allToks.filter((t) => /\d/.test(t) || t.length >= 4);
    const queries = [distinctive.join(" "), allToks.join(" "), ...distinctive].filter(Boolean);
    let top: any[] = [];
    for (const qy of queries) {
      const r: any[] = await c.query(api.catalog.listListings, { search: qy });
      if (r && r.length) { top = r.slice(0, 3); break; }
    }
    const facts: string[] = [];
    for (const r of top) {
      const l: any = await c.query(api.catalog.getListingBySlug, { slug: r.slug });
      const k = l?.knowledge;
      if (!k) continue;
      facts.push(
        `${l.title} [${l.category}${l.specs?.mount ? `, ${l.specs.mount} mount` : ""}]: ${k.summary}. Features: ${(k.features || []).join(", ")}. Limits: ${(k.limits || []).join(", ")}. Pairs with: ${(k.pairsWith || []).join(", ")}. From £${l.pricing?.daily}/day${memberPct ? ` (£${Math.round((l.pricing?.daily || 0) * (1 - memberPct / 100))}/day for you as a member)` : ""}.`,
      );
    }
    if (!facts.length) return null;
    const or = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
    const { text } = await generateText({
      model: or(process.env.BOT_MODEL || "deepseek/deepseek-chat") as any,
      prompt: `You are the Db Cinema rental assistant. Answer the customer's question concisely (2-4 sentences, warm, plain language) using ONLY these facts. Be specific about limits and compatibility — lens mounts: Sony = E, Canon mirrorless = RF, Canon EF needs an EF→E/RF adapter, cine/PL is manual. Never invent specs.\n\nFACTS:\n${facts.join("\n")}\n\nCUSTOMER: ${userMsg}\n\nANSWER:`,
    });
    return text?.trim() || null;
  } catch {
    return null;
  }
}

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

async function buildCards(c: ConvexHttpClient, out: any, camMounts: string[] = [], memberPct = 0) {
  const cards: any[] = [];
  if (!out?.start || !out?.end) return cards;
  const mp = (it: any) => {
    if (it && memberPct > 0) { it.memberPct = memberPct; it.memberTotal = Math.round(it.total * (1 - memberPct / 100)); }
    return it;
  };
  const seen = new Set<string>();
  for (const p of out.proposals ?? []) {
    const item = await buildOne(c, p.slug, out.start, out.end, true);
    // never propose a lens that won't mount on the camera already in the kit
    if (item && item.itemType === "lens" && !lensFits(item.mount, camMounts)) continue;
    if (item && item.available && !seen.has(item.listingId)) {
      seen.add(item.listingId);
      cards.push({ kind: "add", reason: p.reason, item: mp(item) });
    }
  }
  for (const s of out.swaps ?? []) {
    const removed = await buildOne(c, s.removeSlug, out.start, out.end, false);
    const added = await buildOne(c, s.addSlug, out.start, out.end, true);
    if (added && added.available && !seen.has(added.listingId)) {
      seen.add(added.listingId);
      cards.push({ kind: "swap", reason: s.reason, removed, added: mp(added) });
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
        cards.push({ kind: "add", reason: `Recommended ${t}`, item: mp(item) });
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
  let memberPct = 0;
  if (body?.token) {
    try {
      const me: any = await c.query(api.accounts.me, { token: body.token });
      if (me) {
        const tier = me.membershipActive ? tierByKey(me.membershipTier) : null;
        memberPct = tier?.pct ?? 0;
        const name = me.name || (me.email ? me.email.split("@")[0] : "there");
        const bk: any = await c.query(api.accounts.myBookings, { token: body.token });
        const past: any[] = Array.isArray(bk) ? bk : [];
        const recent = (past[0]?.lineItems ?? []).map((li: any) => li.title).slice(0, 3);
        const openB = past.find((b: any) => ["confirmed", "pending", "reserved", "active", "paid"].includes(String(b.status).toLowerCase()));
        const bits: string[] = [];
        bits.push(
          past.length >= 2
            ? `Returning, reliable customer ${name} (${past.length} past bookings) — greet them back warmly BY NAME.`
            : past.length === 1
              ? `Customer ${name} (1 previous booking) — welcome them back by name.`
              : `Customer ${name} (first time) — be welcoming.`,
        );
        if (tier) bits.push(`${tier.name} member (active): apply their ${memberPct}% member discount to every quote and mention the saving.`);
        if (recent.length) bits.push(`Previously rented: ${recent.join(", ")} — personalise suggestions to this.`);
        if (openB) bits.push(`They have a ${openB.status} booking (${(openB.lineItems ?? []).map((li: any) => li.title).join(", ")}); gear can be added to it up to 1h before pickup — offer relevant add-ons.`);
        ctx = bits.join(" ");
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
    let reply = out?.reply ?? res?.text ?? "How can I help with your shoot?";
    let cards = out ? await buildCards(c, out, camMounts, memberPct) : [];
    const lastUser = [...history].reverse().find((m: any) => m.role === "user")?.content || "";

    // no-defer guard: DeepSeek often replies "let me check…" (or empty) without answering.
    // Fall back to deterministic knowledge retrieval + a plain grounded answer.
    const isDefer =
      cards.length === 0 &&
      (reply.trim().length < 12 ||
        /\b(let me|i['’]?ll|one moment|give me a moment|hang on|fetch|pull(ing)? up|look(ing)?\s*(it|that)?\s*up|check (the|on|compat|details)|will check|getting (that|the)|moment)\b/i.test(reply));
    if (isDefer && lastUser) {
      const ka = await knowledgeAnswer(c, lastUser, memberPct);
      if (ka) reply = ka;
    }
    // safety net: if they clearly asked for a kit but the model returned none, build a default
    if (out?.start && out?.end && cards.length === 0 && /\b(kit|build|assemble|recommend|set ?up|shoot|gear for|need)\b/i.test(lastUser)) {
      out.wantsKit = true;
      out.itemTypes = out.itemTypes?.length ? out.itemTypes : ["camera", "lens", "light", "mic"];
      cards = await buildCards(c, out, camMounts, memberPct);
    }
    return NextResponse.json({ reply, cards });
  } catch {
    return NextResponse.json({
      reply: "Sorry, I'm having a moment — please try again, or reach us via the contact page.",
      cards: [],
    });
  }
}
