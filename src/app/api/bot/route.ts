import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { TIERS } from "@/lib/membership";
import { quote } from "@/lib/pricing";
import { SITE_FACTS } from "@/lib/botKnowledge";

const OR = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-chat";
const cx = () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const ms = (d: string) => {
  const t = Date.parse(/T/.test(d) ? d : d + "T00:00:00Z");
  return Number.isNaN(t) ? Date.now() : t;
};

function systemPrompt() {
  const mem = TIERS.map(
    (t) =>
      `${t.name} (£${t.monthlyGbp}/mo): ${t.pct}% off all rentals` +
      (t.freeAccessories ? `, ${t.freeAccessories} free accessor${t.freeAccessories > 1 ? "ies" : "y"}/month` : "") +
      (t.freeDelivery ? ", free local delivery" : "") +
      (t.exclusiveOffers ? ", exclusive member offers" : ""),
  ).join("; ");
  return `You are the friendly assistant for Db Cinema Rentals, a London cinema-gear rental shop. You help visitors find gear, check availability, get quotes, and understand how renting works. Be warm, concise and genuinely useful. You are an assistant (don't pretend to be a specific person), but speak naturally.

${SITE_FACTS}

MEMBERSHIP TIERS: ${mem}. Mention membership when a visitor is price-sensitive or renting often.

RULES:
- Use tools for ALL prices and availability — never guess numbers or make up gear. If a tool returns nothing, say so honestly.
- Recommend complementary gear (a camera wants lenses + ND filters; lighting wants stands; etc.) and link by suggesting they search the catalogue.
- To check availability you need dates (YYYY-MM-DD). Ask for them if missing.
- For complaints, damage, cancellations, refunds, or anything outside your knowledge, call escalate and tell the visitor a team member will follow up shortly.
- Keep replies short (2-4 sentences) unless asked for detail. Use the customer's words. Be encouraging about booking.`;
}

const tools = [
  {
    type: "function",
    function: {
      name: "search_catalog",
      description: "Search the rental catalogue by keyword and/or category. Returns matching gear with daily-from prices and slugs.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "keywords, e.g. 'sony fx', 'wide lens', 'led light'" },
          category: { type: "string", description: "optional category filter, e.g. Cameras, Lenses, Lighting" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Check if a specific item (by slug) is available for a date range.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string" },
          start: { type: "string", description: "YYYY-MM-DD" },
          end: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["slug", "start", "end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "quote_price",
      description: "Get the price for an item (by slug) for a number of rental days, including the multi-day discount.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" }, days: { type: "number" } },
        required: ["slug", "days"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate",
      description: "Flag a message for the human team (complaints, damage, cancellations, refunds, or anything you can't answer).",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "what the visitor needs" },
          email: { type: "string", description: "visitor email if provided, else empty" },
        },
        required: ["summary"],
      },
    },
  },
];

async function runTool(name: string, args: any): Promise<any> {
  const c = cx();
  if (name === "search_catalog") {
    const v: any[] = await c.query(api.catalog.listListings, {
      search: args.query || undefined,
      category: args.category || undefined,
    });
    return (v || []).slice(0, 6).map((l) => ({
      title: l.title,
      slug: l.slug,
      category: l.category,
      dailyFrom: l.pricing?.daily ?? null,
    }));
  }
  if (name === "check_availability") {
    const l: any = await c.query(api.catalog.getListingBySlug, { slug: args.slug });
    if (!l) return { error: "no such item" };
    const av: any = await c.query(api.availability.forListing, {
      listingId: l._id,
      start: ms(args.start),
      end: ms(args.end),
    });
    return { title: l.title, available: av?.available ?? 0, owned: av?.owned ?? 0 };
  }
  if (name === "quote_price") {
    const l: any = await c.query(api.catalog.getListingBySlug, { slug: args.slug });
    if (!l) return { error: "no such item" };
    const q = quote(l.pricing, args.days);
    return { title: l.title, days: args.days, perDay: q.perDay, total: q.total };
  }
  if (name === "escalate") {
    await c.mutation(api.contact.submit, {
      name: "Website chat",
      email: args.email || "chat@dbcinemarentals.com",
      message: args.summary,
    });
    return { ok: true };
  }
  return { error: "unknown tool" };
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
  const convo: any[] = [{ role: "system", content: systemPrompt() }, ...history];

  for (let i = 0; i < 5; i++) {
    let data: any;
    try {
      const res = await fetch(OR, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "content-type": "application/json",
          "X-Title": "Db Cinema Assistant",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: convo,
          tools,
          tool_choice: "auto",
          temperature: 0.3,
          max_tokens: 700,
          provider: { only: ["deepseek", "alibaba"] },
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      data = await res.json();
    } catch {
      return NextResponse.json({
        reply: "Sorry, I'm having a moment — please try again, or reach us via the contact page.",
      });
    }
    const msg = data?.choices?.[0]?.message;
    if (!msg) return NextResponse.json({ reply: "Sorry, I didn't get that — try again?" });
    convo.push(msg);
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let out: any;
        try {
          out = await runTool(tc.function.name, JSON.parse(tc.function.arguments || "{}"));
        } catch (e) {
          out = { error: String(e) };
        }
        convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 2500) });
      }
      continue;
    }
    return NextResponse.json({ reply: msg.content || "How can I help with your shoot?" });
  }
  return NextResponse.json({ reply: "Let me get a teammate to help — try the contact page if it's urgent." });
}
