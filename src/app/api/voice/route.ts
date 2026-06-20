import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { quote } from "@/lib/pricing";
import { dayMs } from "@/lib/dates";

/**
 * /api/voice — custom-function webhook for a Retell AI (or any) phone agent.
 *
 * The voice agent calls this mid-conversation to answer from the shop's LIVE Convex
 * inventory (same data as the Gaffer chat bot), so the phone line never quotes stale
 * info. Retell POSTs { name, args, call } and we reply { result: "<what the agent says>" }.
 *
 * Auth: a shared secret (set VOICE_WEBHOOK_SECRET). Configure Retell to send it either as
 * the header `X-Voice-Secret: <secret>` or as `?key=<secret>` on the URL.
 */
export const maxDuration = 30;

const say = (result: string) => NextResponse.json({ result });
const daysBetween = (start: string, end?: string) =>
  Math.max(1, Math.round((dayMs(end || start) - dayMs(start)) / 86400000) + 1);

/** Resolve a spoken item name ("the FX3", "a 70-200") to the best ACTIVE listing —
 * preferring the STANDALONE item over a bundle so the agent says "the Sony FX3" not
 * "the FX3 + 24-70 + tripod + mic kit". */
const isBundle = (t: string) => /\+|\bset\b|\bultimate\b|\bbundle\b|\bkit\b|\d\s*[x×]\s/i.test(String(t));
async function resolveItem(c: ConvexHttpClient, q: string | undefined) {
  if (!q || !String(q).trim()) return null;
  const r: any[] = await c.query(api.catalog.listListings, { search: String(q) }).catch(() => []);
  if (!r?.length) return null;
  const toks = String(q).toLowerCase().match(/[a-z0-9]+/g) || [];
  const score = (t: string) => toks.reduce((n, k) => n + (String(t).toLowerCase().includes(k) ? 1 : 0), 0);
  return [...r].sort((a, b) =>
    score(b.title) - score(a.title) ||                                   // most query tokens matched
    (isBundle(a.title) ? 1 : 0) - (isBundle(b.title) ? 1 : 0) ||         // standalone before bundle
    String(a.title).length - String(b.title).length ||                  // tighter (more specific) title
    (b.demandScore || 0) - (a.demandScore || 0),                        // then real demand
  )[0];
}

export async function POST(req: NextRequest) {
  // shared-secret auth (skip only if no secret configured)
  const secret = process.env.VOICE_WEBHOOK_SECRET;
  if (secret) {
    const got = req.headers.get("x-voice-secret") || new URL(req.url).searchParams.get("key");
    if (got !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body: any = await req.json().catch(() => ({}));
  // Works for Retell ({ name, args }) AND ElevenLabs (flat params body + ?fn=<function> in the URL).
  const name: string = body.name || body.function_name || body.function?.name || new URL(req.url).searchParams.get("fn") || "";
  const args: any = body.args || body.arguments || body.function?.arguments || body || {};
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

  try {
    switch (name) {
      case "check_availability": {
        const it = await resolveItem(c, args.item);
        if (!it) return say(`I couldn't find ${args.item || "that"} in our catalogue. We mainly stock Sony cinema cameras, G Master lenses, lighting and audio — what are you shooting?`);
        if (!args.start) return say(`Sure — what dates do you need the ${it.title}?`);
        const days = daysBetween(args.start, args.end);
        const av: any = await c.query(api.availability.forListing, { listingId: it._id, start: dayMs(args.start), end: dayMs(args.end || args.start) }).catch(() => null);
        const q: any = quote(it.pricing, days);
        if ((av?.available ?? 0) > 0)
          return say(`Good news — the ${it.title} is available${args.end ? ` from ${args.start} to ${args.end}` : ` on ${args.start}`}, at £${q.perDay} a day${days > 1 ? `, £${q.total} for the ${days} days` : ""}. We deliver across London. Would you like me to take your details to reserve it?`);
        return say(`I'm sorry, the ${it.title} is already booked for ${args.start}. Would you like me to check a similar option that's free, or pick different dates?`);
      }
      case "get_price": {
        const it = await resolveItem(c, args.item);
        if (!it) return say(`I couldn't find ${args.item || "that item"} — could you say the model again?`);
        const days = Math.max(1, Number(args.days) || 1);
        const q: any = quote(it.pricing, days);
        return say(`The ${it.title} is £${q.perDay} per day${days > 1 ? `, which works out to £${q.total} for ${days} days` : ""}. That includes London delivery options. Shall I check availability for your dates?`);
      }
      case "check_stock": {
        const it = await resolveItem(c, args.item);
        return say(it
          ? `Yes, we stock the ${it.title}. Would you like the price or to check availability?`
          : `We don't carry ${args.item || "that"} specifically, but we have a wide range of Sony cinema cameras, G Master lenses, lighting, audio and drones. What's the shoot?`);
      }
      case "request_callback": {
        const nm = String(args.name || "Phone caller").slice(0, 60);
        const phone = String(args.phone || "not provided").slice(0, 40);
        const message = `[Voice callback request] Phone: ${phone}. ${String(args.message || "").slice(0, 400)}`.trim();
        await c.mutation(api.contact.submit, { name: nm, email: String(args.email || "voice@dbcinemarentals.com").slice(0, 80), message }).catch(() => {});
        return say(`Thanks ${nm}, I've passed your number to the team and they'll call you back shortly. Anything else I can help with?`);
      }
      default:
        return say("Sorry, I didn't quite catch that — could you rephrase?");
    }
  } catch {
    return say("Sorry, I'm having trouble checking that right now. Could you leave your number and the team will call you straight back?");
  }
}

// Some agents probe the URL with GET first — return a simple health response.
export async function GET() {
  return NextResponse.json({ ok: true, service: "db-cinema voice webhook" });
}
