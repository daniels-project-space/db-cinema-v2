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
  camera: "camera", lens: "lens", gimbal: "gimbal", light: "light",
  "tube-light": "tube", "nd-filter": "filter", battery: "battery", monitor: "monitor",
  "lav-mic": "lav", "shotgun-mic": "shotgun", "wireless-mic": "wireless mic",
  tripod: "tripod", drone: "drone", speaker: "speaker", slider: "slider",
};
const ORDER = ["camera", "lens", "gimbal", "monitor", "lav-mic", "shotgun-mic", "wireless-mic", "light", "tube-light", "nd-filter", "battery", "tripod", "slider", "drone", "speaker"];
const MULTI = new Set(["lens", "light", "tube-light", "nd-filter", "battery", "lav-mic"]); // can pick several

const FALLBACK: Record<string, string[]> = {
  interview: ["camera", "lens", "lav-mic", "shotgun-mic", "light", "monitor", "tripod"],
  "music video": ["camera", "lens", "gimbal", "tube-light", "light", "nd-filter", "monitor"],
  documentary: ["camera", "lens", "shotgun-mic", "wireless-mic", "light", "tripod"],
  event: ["camera", "lens", "light", "shotgun-mic", "tripod"],
  product: ["camera", "lens", "light", "tripod", "monitor", "nd-filter"],
  wedding: ["camera", "lens", "gimbal", "shotgun-mic", "light"],
  default: ["camera", "lens", "light", "shotgun-mic", "tripod"],
};

// ── compatibility inference ───────────────────────────────────
function mountOf(title: string): string {
  const t = title.toLowerCase();
  const any = (...k: string[]) => k.some((x) => t.includes(x));
  if (any("gopro", "osmo action", "insta360", "action 4", "action 5", "action4", "action5", "osmo pocket", "pocket 3")) return "fixed";
  if (any("mft", "m4/3", "micro four", "gh5", "gh6", "gh7", "bmpcc 4k", "pocket 4k")) return "MFT";
  if (any("komodo", "raptor")) return "RF";
  if (any(" rf", "rf ", "r5", "r6", "r3", "r8", "canon r")) return "RF";
  if (any("pl mount", " pl ", "arri", "alexa", "amira")) return "PL";
  if (any("bmpcc", "pocket cinema", "6k pro", "6k g2")) return "EF";
  if (any(" ef", "ef ", "ef-", "canon ef")) return "EF";
  if (any("sony", "fx3", "fx6", "fx9", "fx30", "a7", "a1", "a9", "burano", " fe ", "gm", "g master", "e-mount", "emount", "sigma e", "tamron e")) return "E";
  return "any";
}
function roleOf(cat: string): string {
  const c = (cat || "").toLowerCase();
  if (c.includes("lens")) return "lens";
  if (c.includes("camera")) return "camera";
  return "other";
}

const SCHEMA = z.object({
  reply: z.string(),
  stages: z.array(z.object({ key: z.string(), label: z.string(), note: z.string(), upsell: z.boolean().optional() })),
  compatibility: z.array(z.string()),
});

async function optionsForType(c: ConvexHttpClient, key: string, start: string, end: string, limit = 12) {
  const term = TERM[key] || key.replace(/-/g, " ");
  const r: any[] = await c.query(api.catalog.listListings, { search: term });
  const days = Math.max(1, Math.round((msOf(end) - msOf(start)) / 86400000) + 1);
  const out: any[] = [];
  for (const l of (r || []).slice(0, 18)) {
    const av: any = await c.query(api.availability.forListing, { listingId: l._id, start: msOf(start), end: msOf(end) });
    if ((av?.available ?? 0) <= 0) continue;
    const q: any = quote(l.pricing, days);
    const role = roleOf(l.category);
    out.push({
      listingId: l._id, slug: l.slug, title: l.title, image: l.heroImage ?? null, category: l.category,
      start, end, days, perDay: q.perDay, total: q.total, deposit: l.depositAmount ?? 0,
      role, mount: role === "camera" || role === "lens" ? mountOf(l.title) : null,
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

  let design: any = null;
  try {
    const or = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
    const { object } = await generateObject({
      model: or(process.env.BOT_MODEL || "deepseek/deepseek-chat") as any,
      schema: SCHEMA,
      prompt: `You are a senior kit designer at Db Cinema Rentals (London cinema hire). Plan a STAGE-BY-STAGE kit build for this shoot. Output ordered "stages" — each a gear category the customer will choose from. Use these keys only: camera, lens, gimbal, monitor, lav-mic, shotgun-mic, wireless-mic, light, tube-light, nd-filter, battery, tripod, slider, drone, speaker. ALWAYS put camera first and lens second. Each stage: short friendly label + one-line note guiding the choice. Mark 1-3 stages upsell:true (premium add-ons to push). Add 3-5 short "compatibility" notes (mounts, power, media, adapters). Tailor to budget, crew size, camera count.\n\nSHOOT: ${b.shootType || "general"}. Dates ${start} to ${end}. Budget ~£${b.budget ?? "flexible"}. Cameras: ${b.cameras ?? 1}. Crew: ${b.size || "small"}. Notes: ${b.note || "none"}.`,
    });
    design = object;
  } catch {
    design = null;
  }

  let keys: string[] = design?.stages?.length ? design.stages.map((s: any) => s.key) : FALLBACK[(b.shootType || "default").toLowerCase()] || FALLBACK.default;
  keys = Array.from(new Set(keys));
  const oi = (k: string) => (ORDER.indexOf(k) === -1 ? 99 : ORDER.indexOf(k));
  keys.sort((a, z) => oi(a) - oi(z)); // enforce camera, then lens, then the rest

  const stages: any[] = [];
  for (const k of keys.slice(0, 9)) {
    const meta = design?.stages?.find((s: any) => s.key === k);
    let options = await optionsForType(c, k, start, end);
    if (k === "lens") options = options.filter((o: any) => o.role === "lens"); // no camera bodies in the lens stage
    if (k === "camera") options = options.filter((o: any) => o.role === "camera");
    if (options.length)
      stages.push({
        key: k,
        label: meta?.label || k,
        note: meta?.note || "",
        multi: MULTI.has(k),
        upsell: !!meta?.upsell,
        options,
      });
  }

  return NextResponse.json({
    reply: design?.reply || `Let's build your ${b.shootType || "shoot"} kit step by step.`,
    compatibility: design?.compatibility || [],
    stages,
  });
}
