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

// stage key → which itemType(s) to pull, optional must-match / prefer-first
const STAGE: Record<string, { types: string[]; must?: RegExp; prefer?: RegExp }> = {
  camera: { types: ["camera-body"] },
  lens: { types: ["lens"] },
  gimbal: { types: ["gimbal"] },
  monitor: { types: ["monitor"] },
  light: { types: ["light"] },
  "key-light": { types: ["light"], prefer: /nanlite|forza|aputure|600|300|key/i },
  "tube-light": { types: ["light"], must: /tube|pavotube|titan|astera|t8|t12|rgb/i },
  "nd-filter": { types: ["nd-filter"] },
  battery: { types: ["battery"] },
  tripod: { types: ["tripod"] },
  "lav-mic": { types: ["wireless-mic"], prefer: /lav|wireless/i },
  "wireless-mic": { types: ["wireless-mic"] },
  "shotgun-mic": { types: ["boom-mic"] },
  slider: { types: ["slider"] },
  drone: { types: ["drone"] },
  speaker: { types: ["speaker"] },
};
const ORDER = ["camera", "lens", "gimbal", "monitor", "key-light", "light", "tube-light", "lav-mic", "shotgun-mic", "wireless-mic", "nd-filter", "battery", "tripod", "slider", "drone", "speaker"];
const MULTI = new Set(["lens", "light", "key-light", "tube-light", "nd-filter", "battery", "lav-mic"]);

const FALLBACK: Record<string, string[]> = {
  interview: ["camera", "lens", "lav-mic", "shotgun-mic", "key-light", "light", "monitor", "tripod"],
  "music video": ["camera", "lens", "gimbal", "tube-light", "key-light", "nd-filter", "monitor"],
  documentary: ["camera", "lens", "shotgun-mic", "wireless-mic", "light", "tripod"],
  event: ["camera", "lens", "light", "shotgun-mic", "tripod"],
  product: ["camera", "lens", "key-light", "light", "tripod", "nd-filter"],
  wedding: ["camera", "lens", "gimbal", "shotgun-mic", "light"],
  default: ["camera", "lens", "key-light", "shotgun-mic", "tripod"],
};

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

const SCHEMA = z.object({
  reply: z.string(),
  stages: z.array(z.object({ key: z.string(), label: z.string(), note: z.string(), recommend: z.string().optional(), upsell: z.boolean().optional() })),
  compatibility: z.array(z.string()),
});

async function optionsForStage(c: ConvexHttpClient, key: string, start: string, end: string, lensPref?: string) {
  const def = STAGE[key];
  if (!def) return [];
  let items: any[] = await c.query(api.catalog.byItemType, { types: def.types });
  if (def.must) items = items.filter((l) => def.must!.test(l.title));
  const days = Math.max(1, Math.round((msOf(end) - msOf(start)) / 86400000) + 1);
  const out: any[] = [];
  for (const l of items.slice(0, 30)) {
    const av: any = await c.query(api.availability.forListing, { listingId: l._id, start: msOf(start), end: msOf(end) });
    if ((av?.available ?? 0) <= 0) continue;
    const q: any = quote(l.pricing, days);
    const role = l.itemType === "camera-body" ? "camera" : l.itemType === "lens" ? "lens" : "other";
    out.push({
      listingId: l._id, slug: l.slug, title: l.title, image: l.heroImage ?? null, category: l.category,
      start, end, days, perDay: q.perDay, total: q.total, deposit: l.depositAmount ?? 0,
      role,
      mount: l.specs?.mount ?? (role === "camera" || role === "lens" ? mountOf(l.title) : null),
      specs: l.specs ?? {},
    });
    if (out.length >= 16) break;
  }
  out.sort((a, b) => {
    if (key === "lens" && lensPref) {
      const ac = a.specs?.lensClass === lensPref ? 0 : 1;
      const bc = b.specs?.lensClass === lensPref ? 0 : 1;
      if (ac !== bc) return ac - bc; // preferred lens class first (af for small, cine for large)
    }
    const pa = def.prefer && def.prefer.test(a.title) ? 0 : 1;
    const pb = def.prefer && def.prefer.test(b.title) ? 0 : 1;
    return pa - pb || a.total - b.total;
  });
  return out;
}

function pickRecommended(options: any[], hint?: string) {
  if (options.length === 0) return null;
  if (hint) {
    const tokens = hint.toLowerCase().match(/[a-z0-9.\-]{3,}/g) || [];
    let best: any = null, bestScore = 0;
    for (const o of options) {
      const t = o.title.toLowerCase();
      const score = tokens.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (best && bestScore > 0) return best.listingId;
  }
  return options[0].listingId; // prefer-sorted / cheapest
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
      prompt: `You are a senior kit designer at Db Cinema Rentals (London cinema hire). Plan a STAGE-BY-STAGE kit build. Output ordered "stages" using ONLY these keys: camera, lens, gimbal, monitor, key-light, light, tube-light, lav-mic, shotgun-mic, wireless-mic, nd-filter, battery, tripod, slider, drone, speaker. ALWAYS camera first, lens second. Each stage: friendly label, one-line note, and a "recommend" = the IDEAL item for this shoot as a short search phrase (e.g. for wedding lens "70-200mm telephoto", for interview light "Nanlite Forza key light", for music video "anamorphic"). Mark 1-3 stages upsell:true. Add 3-5 short "compatibility" notes. Tailor to budget, crew size, camera count.\n\nSHOOT: ${b.shootType || "general"}. Dates ${start} to ${end}. Budget ~£${b.budget ?? "flexible"}. Cameras: ${b.cameras ?? 1}. Crew: ${b.size || "small"}. Notes: ${b.note || "none"}.`,
    });
    design = object;
  } catch {
    design = null;
  }

  let keys: string[] = design?.stages?.length ? design.stages.map((s: any) => s.key) : FALLBACK[(b.shootType || "default").toLowerCase()] || FALLBACK.default;
  keys = keys.filter((k) => STAGE[k]);
  keys = Array.from(new Set(keys));
  const oi = (k: string) => (ORDER.indexOf(k) === -1 ? 99 : ORDER.indexOf(k));
  keys.sort((a, z) => oi(a) - oi(z));

  // small/solo shoots favour autofocus glass (run-and-gun); large productions favour cinema glass
  const lensPref = (b.size || "").toLowerCase().includes("large") ? "cine" : "af";

  const stages: any[] = [];
  for (const k of keys.slice(0, 9)) {
    const meta = design?.stages?.find((s: any) => s.key === k);
    const options = await optionsForStage(c, k, start, end, lensPref);
    if (!options.length) continue;
    let note = meta?.note || "";
    if (k === "lens")
      note += (note ? " " : "") + (lensPref === "cine"
        ? "Cinema glass first for a larger crew (manual focus, focus puller recommended)."
        : "Autofocus glass first for fast, small-crew shooting.");
    stages.push({
      key: k,
      label: meta?.label || k,
      note,
      multi: MULTI.has(k),
      upsell: !!meta?.upsell,
      recommendedId: pickRecommended(options, meta?.recommend),
      options,
    });
  }

  return NextResponse.json({
    reply: design?.reply || `Let's build your ${b.shootType || "shoot"} kit step by step.`,
    compatibility: design?.compatibility || [],
    stages,
  });
}
