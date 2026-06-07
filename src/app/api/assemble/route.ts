import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { quote } from "@/lib/pricing";

export const maxDuration = 60;

const msOf = (d: string) => {
  const t = Date.parse(/T/.test(d) ? d : d + "T00:00:00Z");
  return Number.isNaN(t) ? 0 : t;
};

const TERM: Record<string, string> = {
  camera: "camera", "camera-body": "camera", lens: "lens", gimbal: "gimbal",
  light: "light", "key-light": "light", "fill-light": "light", "tube-light": "tube",
  "nd-filter": "filter", filter: "filter", battery: "battery", monitor: "monitor",
  mic: "mic", "lav-mic": "lav", "shotgun-mic": "shotgun", "wireless-mic": "wireless mic",
  tripod: "tripod", drone: "drone", speaker: "speaker", slider: "slider", haze: "haze",
};

const FALLBACK: Record<string, string[]> = {
  interview: ["camera", "lens", "lav-mic", "shotgun-mic", "key-light", "fill-light", "tripod", "monitor"],
  "music video": ["camera", "lens", "gimbal", "tube-light", "light", "nd-filter"],
  documentary: ["camera", "lens", "shotgun-mic", "wireless-mic", "light", "tripod"],
  event: ["camera", "lens", "light", "shotgun-mic", "tripod"],
  product: ["camera", "lens", "light", "tripod", "monitor"],
  wedding: ["camera", "lens", "gimbal", "shotgun-mic", "light"],
  default: ["camera", "lens", "light", "mic", "tripod"],
};

const SCHEMA = z.object({
  reply: z.string(),
  sections: z.array(z.object({ type: z.string(), label: z.string(), note: z.string(), qty: z.number() })),
  compatibility: z.array(z.string()),
  upsell: z.array(z.object({ type: z.string(), label: z.string(), note: z.string() })),
});

async function optionsForType(c: ConvexHttpClient, type: string, start: string, end: string, limit = 8) {
  const term = TERM[type] || type.replace(/-/g, " ");
  const r: any[] = await c.query(api.catalog.listListings, { search: term });
  const days = Math.max(1, Math.round((msOf(end) - msOf(start)) / 86400000) + 1);
  const out: any[] = [];
  for (const l of (r || []).slice(0, 14)) {
    const av: any = await c.query(api.availability.forListing, { listingId: l._id, start: msOf(start), end: msOf(end) });
    if ((av?.available ?? 0) <= 0) continue;
    const q: any = quote(l.pricing, days);
    out.push({
      listingId: l._id, slug: l.slug, title: l.title, image: l.heroImage ?? null,
      category: l.category, start, end, days, perDay: q.perDay, total: q.total, deposit: l.depositAmount ?? 0,
    });
    if (out.length >= limit) break;
  }
  out.sort((a, b) => a.total - b.total);
  return out;
}

export async function POST(req: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: "not configured" }, { status: 500 });
  const b: any = await req.json().catch(() => ({}));
  const start: string = b.start, end: string = b.end;
  if (!start || !end) return NextResponse.json({ error: "dates required" }, { status: 400 });
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

  // 1) design the kit (categories + notes) — model decides, heuristic fallback
  let design: any = null;
  try {
    const or = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
    const { object } = await generateObject({
      model: or(process.env.BOT_MODEL || "deepseek/deepseek-chat") as any,
      schema: SCHEMA,
      prompt: `You are a senior kit designer at Db Cinema Rentals (London cinema-gear hire). Design a rental kit for this shoot. Pick the gear CATEGORIES needed as "sections" (use these type keywords: camera, lens, gimbal, light, key-light, fill-light, tube-light, nd-filter, battery, monitor, lav-mic, shotgun-mic, wireless-mic, tripod, drone, slider, haze, speaker). Give each section a friendly label, a one-line note, and a recommended quantity. Be thorough and shoot-appropriate. Add 2-4 "upsell" sections (premium add-ons that elevate the shoot — push hard). Add 2-4 short "compatibility" notes (mounts, power, media, etc.). Tailor to the budget, crew size and camera count.\n\nSHOOT: ${b.shootType || "general"}. Dates ${start} to ${end}. Budget around £${b.budget ?? "flexible"} total. Cameras needed: ${b.cameras ?? 1}. Crew/size: ${b.size || "small"}. Notes: ${b.note || "none"}.`,
    });
    design = object;
  } catch {
    design = null;
  }

  const types: string[] = design?.sections?.length
    ? design.sections.map((s: any) => s.type)
    : FALLBACK[(b.shootType || "default").toLowerCase()] || FALLBACK.default;

  // 2) fill each section with real available, priced options (server-authoritative)
  const seen = new Set<string>();
  const sections: any[] = [];
  for (const t of types.slice(0, 8)) {
    const meta = design?.sections?.find((s: any) => s.type === t);
    const options = (await optionsForType(c, t, start, end)).filter((o) => !seen.has(o.listingId));
    options.forEach((o) => seen.add(o.listingId));
    if (options.length)
      sections.push({ type: t, label: meta?.label || t, note: meta?.note || "", qty: meta?.qty || 1, upsell: false, options });
  }
  // upsell sections
  for (const u of (design?.upsell || []).slice(0, 4)) {
    const options = (await optionsForType(c, u.type, start, end, 6)).filter((o) => !seen.has(o.listingId));
    options.forEach((o) => seen.add(o.listingId));
    if (options.length)
      sections.push({ type: u.type, label: u.label || u.type, note: u.note || "", qty: 1, upsell: true, options });
  }

  return NextResponse.json({
    reply: design?.reply || `Here's a suggested kit for your ${b.shootType || "shoot"} — pick what you like from each row.`,
    compatibility: design?.compatibility || [],
    sections,
  });
}
