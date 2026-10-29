import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import { botModel } from "@/lib/ai";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { quote } from "@/lib/pricing";
import { dayMs as msOf } from "@/lib/dates";
import { parseMounts, mountCompat } from "@/lib/mount";
import { coverageCompat, battOk, isRigPower } from "@/lib/compat";
import { PICKUP_SLOTS } from "@/lib/site";
import { rateLimit } from "@/lib/ratelimit";
import { compareOptions, isCameraSet } from "@/lib/kitRank";
import { automaticRecommendation, documentedIncludedTypes, includedLensFocals, rentableCandidate, unrequestedCameraExtras, type RecommendationItem } from "../../../../shared/recommendationPolicy";
import { normalizeEquipmentName, equipmentModelTokens, equipmentModelsMatch } from "../../../../shared/equipmentIdentity";
import { rentalPricingDays } from "../../../../shared/rentalDuration";
import { createTypeListingLoader } from "@/lib/catalogCandidates";

export const maxDuration = 60;

// stage key → which itemType(s) to pull, optional must-match / prefer-first
const STAGE: Record<string, { types: string[]; must?: RegExp; prefer?: RegExp }> = {
  camera: { types: ["camera-body"] },
  lens: { types: ["lens"] },
  gimbal: { types: ["gimbal"] },
  monitor: { types: ["monitor"] },
  light: { types: ["light"] },
  "nd-filter": { types: ["nd-filter"] },
  battery: { types: ["battery"] },
  tripod: { types: ["tripod"] },
  "lav-mic": { types: ["wireless-mic"], prefer: /lav|wireless/i },
  "wireless-mic": { types: ["wireless-mic"] },
  "shotgun-mic": { types: ["boom-mic"] },
  slider: { types: ["slider"] },
  drone: { types: ["drone"] },
  speaker: { types: ["speaker"] },
  recorder: { types: ["recorder"] }, "dj-deck": { types: ["dj-deck"] }, mixer: { types: ["mixer"] },
  headphones: { types: ["headphones"] }, projector: { types: ["projector"] }, accessory: { types: ["accessory"] },
};
const ORDER = Object.keys(STAGE);
// stage key → the itemType it represents (for "already in the chosen bundle" suppression)
const STAGE_ITEMTYPE: Record<string, string> = {
  camera: "camera-body", lens: "lens", gimbal: "gimbal", monitor: "monitor",
  light: "light", "nd-filter": "nd-filter",
  battery: "battery", tripod: "tripod", "lav-mic": "wireless-mic", "wireless-mic": "wireless-mic",
  "shotgun-mic": "boom-mic", slider: "slider", drone: "drone", speaker: "speaker",
  recorder:"recorder","dj-deck":"dj-deck",mixer:"mixer",headphones:"headphones",projector:"projector",accessory:"accessory",
};
const MULTI = new Set(["lens", "light", "nd-filter", "battery", "lav-mic"]);

const DEFAULT_LABEL: Record<string, string> = {
  camera: "Camera", lens: "Lens", gimbal: "Gimbal", monitor: "Monitor", light: "Lighting",
  "lav-mic": "Lav mic", "shotgun-mic": "Shotgun mic", "wireless-mic": "Wireless mic",
  "nd-filter": "ND filter", battery: "Battery", tripod: "Tripod", slider: "Slider", drone: "Drone", speaker: "Speaker",
  recorder:"Recorder","dj-deck":"DJ deck",mixer:"Mixer",headphones:"Headphones",projector:"Projector",accessory:"Accessories",
};

const FALLBACK: Record<string, string[]> = {
  interview: ["camera", "lens", "lav-mic", "shotgun-mic", "light", "monitor", "tripod"],
  "music video": ["camera", "lens", "gimbal", "light", "nd-filter", "monitor"],
  documentary: ["camera", "lens", "shotgun-mic", "wireless-mic", "light", "tripod"],
  event: ["camera", "lens", "light", "shotgun-mic", "tripod"],
  product: ["camera", "lens", "light", "tripod", "nd-filter"],
  wedding: ["camera", "lens", "gimbal", "shotgun-mic", "light"],
  default: ["camera", "lens", "light", "shotgun-mic", "tripod"],
};

/** Last-resort mount GUESS from a title, used ONLY when specs.mount is missing.
 * Compatibility decisions go through mount.ts (mountCompat/parseMounts) — this
 * just supplies a best-effort mount token so cards still carry one. The local
 * three-state copy that used to live here was deleted; this is data-only. */
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
  if (any("canon")) return "EF"; // Canon-branded glass → EF, AFTER the Sony/E cue so an E lens that only mentions Canon isn't stolen
  return "any";
}

const SCHEMA = z.object({
  reply: z.string(),
  stages: z.array(z.object({ key: z.string(), label: z.string(), note: z.string(), recommend: z.string().optional(), upsell: z.boolean().optional() })),
  compatibility: z.array(z.string()),
});

/** Best mount compatibility of an option's mount string vs the kit's camera
 * mounts. "unknown" when either side is empty (don't block on missing data). */
function optionCompat(optionMount: string | null | undefined, camMounts: string[]): "native" | "adapter" | "incompatible" | "unknown" {
  const lensMounts = parseMounts(optionMount);
  if (!lensMounts.length || !camMounts.length) return "unknown";
  let best: "adapter" | "incompatible" = "incompatible";
  for (const lm of lensMounts) for (const cm of camMounts) {
    const r = mountCompat(lm, cm);
    if (r === "native") return "native";
    if (r === "adapter") best = "adapter";
  }
  return best;
}

/** leading "3x" / "2 x" quantity in a title (a 5-mic bundle is overkill for a solo shoot). */
function titleQty(title: string): number {
  const m = String(title || "").match(/^\s*(\d+)\s*[x×]/i);
  return m ? Math.min(parseInt(m[1], 10) || 1, 9) : 1;
}
/** does a mic/accessory title actually lead with a CAMERA (i.e. it's a camera bundle, not a mic)? */
const CAM_BUNDLE = /gopro|go ?pro|hero ?\d|fx ?3|fx ?6|a7|a7s|a7r|\ba1\b|komodo|bmpcc|\br5\b|\bc70\b|cinema camera|mirrorless camera/i;
/** power compatibility of a battery option vs the kit camera's battery type. */
function batteryCompat(optBatt: string | null | undefined, camBatt: string | null | undefined): "native" | "incompatible" | "unknown" {
  if (isRigPower(optBatt)) return "native"; // V-mount/broadcast powers cinema rigs via a plate + D-tap — never blocked
  if (!optBatt || !camBatt) return "unknown"; // power stations / unknown → neutral, never blocked
  return battOk(camBatt, optBatt) ? "native" : "incompatible";
}

type StageOpts = { compatibilityKits?: RecommendationItem[]; pickupTime?: string; returnTime?: string; selected?: RecommendationItem[]; lensPref?: string; camMounts?: string[]; camCoverage?: string | null; camBattery?: string | null; includedFocal?: string | null; small?: boolean; refreshStock?: (listingId: string) => Promise<void> };

async function optionsForStage(c: ConvexHttpClient, key: string, start: string, end: string, o: StageOpts = {}, getTypeListings = createTypeListingLoader(c)) {
  const { lensPref, camMounts = [], camCoverage = null, camBattery = null, includedFocal = null, small = false } = o;
  const def = STAGE[key];
  if (!def) return [];
  let items: any[] = await getTypeListings(def.types);
  items = items.filter(rentableCandidate);
  if (def.must) items = items.filter((l) => def.must!.test(l.title));
  // mic stages: drop camera BUNDLES that merely contain mics (a "GoPro interview set" is not a lav-mic)
  if (key === "lav-mic" || key === "wireless-mic" || key === "shotgun-mic") items = items.filter((l) => !CAM_BUNDLE.test(l.title));
  // consider the most in-demand items FIRST (byItemType is unsorted) so the availability-checked
  // window always includes the gear people actually rent (e.g. the Sony 24-70 GM).
  if (key === "camera") items.sort((a, b) => (isCameraSet(a.title) ? 1 : 0) - (isCameraSet(b.title) ? 1 : 0) || (b.demandScore ?? 0) - (a.demandScore ?? 0));
  else items.sort((a, b) => (b.demandScore ?? 0) - (a.demandScore ?? 0));
  if (items.length) await o.refreshStock?.(String(items[0]._id));
  const days = rentalPricingDays(msOf(start), msOf(end), o.pickupTime, o.returnTime);
  const out: any[] = [];
  for (const l of items.slice(0, 36)) {

    const av: any = await c.query(api.availability.forListing, { listingId: l._id, start: msOf(start), end: msOf(end), pickupTime: o.pickupTime, returnTime: o.returnTime });
    if ((av?.available ?? 0) <= 0) continue;
    const q: any = quote(l.pricing, days);
    const role = l.itemType === "camera-body" ? "camera" : l.itemType === "lens" ? "lens" : "other";
    const mount = l.specs?.mount ?? (role === "camera" || role === "lens" ? mountOf(l.title) : null);
    // per-stage compatibility verdict (shown to the user; incompatible items are GREYED, not hidden):
    let compat: string | undefined;
    let compatReason: string | undefined;
    if (key === "lens" && camMounts.length) {
      compat = optionCompat(mount, camMounts);
      if (compat === "adapter") compatReason = `needs a ${mount}→${camMounts[0]} adapter`;
      else if (compat === "incompatible") compatReason = `${mount} mount won't fit your ${camMounts[0]} camera`;
      else if (coverageCompat(l.specs?.coverage, camCoverage) === "vignette") compatReason = `${String(l.specs?.coverage).toUpperCase()} lens — vignettes on full-frame`;
    } else if (key === "battery" && camBattery) {
      compat = batteryCompat(l.specs?.batteryType, camBattery);
      if (compat === "incompatible") compatReason = `${l.specs?.batteryType} won't power your ${camBattery} camera`;
    }
    if (key === "lens" && !automaticRecommendation(l, o.selected ?? [], o.compatibilityKits) && !compatReason)
      compatReason = "Check the exact mount, sensor coverage and included glass before adding this lens.";
    if (key === "gimbal" && !automaticRecommendation(l, o.selected ?? [], o.compatibilityKits))
      compatReason = "Confirm the camera/lens payload, mounting and balance before adding this combination.";
    out.push({
      listingId: l._id, slug: l.slug, title: l.title, image: l.heroImage ?? null, imageSources: l.imageSources, category: l.category,
      start, end, pickupTime: o.pickupTime, returnTime: o.returnTime, days, perDay: q.perDay, total: q.total, deposit: l.depositAmount ?? 0,
      role, mount, itemType: l.itemType ?? null,
      compat, compatReason,
      components: l.components, inventoryFacts: l.inventoryFacts, rentalContents: l.rentalContents,
      automaticEligible: automaticRecommendation(l, o.selected ?? [], o.compatibilityKits),
      qty: titleQty(l.title),
      demandScore: l.demandScore ?? 0,
      specs: l.specs ?? {},
      tip: l.tip ?? null,
    });
    if (out.length >= 18) break;
  }
  out.sort((a, b) =>
    compareOptions(a, b, { key, camMounts, camCoverage, camBatts: camBattery ? [camBattery] : [], includedFocal, small, lensPref, prefer: def.prefer }),
  );
  return out;
}

function pickRecommended(options: any[], hint?: string) {
  if (options.length === 0) return null;
  if (hint) {
    const tokens = normalizeEquipmentName(hint).match(/[a-z0-9.\-]{2,}/g) || [];
    let best: any = null, bestScore = 0;
    for (const o of [...options].sort((a, b) => unrequestedCameraExtras(a, hint) - unrequestedCameraExtras(b, hint))) {
      if (!equipmentModelsMatch(hint, o.title)) continue;
      const t = normalizeEquipmentName(o.title);
      const score = tokens.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
      if (score > 0 && (!best || unrequestedCameraExtras(o, hint) < unrequestedCameraExtras(best, hint) || unrequestedCameraExtras(o, hint) === unrequestedCameraExtras(best, hint) && score > bestScore)) { bestScore = score; best = o; }
    }
    if (best && bestScore > 0) return best.listingId;
    if (equipmentModelTokens(hint).length) return null;
  }
  return options[0].listingId; // prefer-sorted / cheapest
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, "assemble", 15, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "rate_limited", stages: [] }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: "not configured" }, { status: 500 });
  const b: any = await req.json().catch(() => ({}));
  const start: string = b.start, end: string = b.end;
  if (!start || !end) return NextResponse.json({ error: "dates required" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || end < start)
    return NextResponse.json({ error: "Choose a valid rental date range.", stages: [] }, { status: 400 });
  const { pickupTime, returnTime } = b;
  if (!PICKUP_SLOTS.includes(pickupTime) || !PICKUP_SLOTS.includes(returnTime))
    return NextResponse.json({ error: "Choose pickup and return times before checking kit availability.", stages: [] }, { status: 400 });
  if (start === end && returnTime <= pickupTime)
    return NextResponse.json({ error: "Return time must be after pickup time.", stages: [] }, { status: 400 });
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const getTypeListings = createTypeListingLoader(c);
  let stockRefresh: Promise<void> | undefined;
  let stockRefreshFailed = false;
  const refreshStock = (listingId: string) => stockRefresh ??= c.action(api.sync.refreshCartStock, {
    items: [{ listingId: listingId as any, start: msOf(start), end: msOf(end), pickupTime, returnTime, qty: 1 }],
  }).then(() => undefined).catch(error => {
    stockRefreshFailed = true;
    throw error;
  });

  const compatibilityKits = await c.query(api.catalog.compatibilityKits, {}).catch(() => []);
  let design: any = null;
  try {
    const { object } = await generateObject({
      model: botModel() as any,
      schema: SCHEMA,
      prompt: `You are a senior kit designer at Db Cinema Rentals (London cinema hire). Plan a STAGE-BY-STAGE kit build. Output ordered "stages" using ONLY these keys: ${Object.keys(STAGE).join(", ")}. Put camera before lens when either is needed; audio, DJ and projection builds do not require a camera. Each stage: friendly label, one-line note, and a "recommend" = the IDEAL item for this shoot as a short search phrase (e.g. for wedding lens "70-200mm telephoto", for interview light "Nanlite Forza key light", for music video "anamorphic"). Mark 1-3 stages upsell:true. Add 3-5 short "compatibility" notes. Tailor to budget, crew size, camera count.\n\nSHOOT: ${b.shootType || "general"}. Dates ${start} to ${end}. Budget ~£${b.budget ?? "flexible"}. Cameras: ${b.cameras ?? 1}. Crew: ${b.size || "small"}. Mainly needs: ${(b.categories || []).join(", ") || "a full kit"}. Notes: ${b.note || "none"}. Build out the "mainly needs" categories fully and draw your upsell stages from them.`,
    });
    design = object;
  } catch {
    design = null;
  }

  const cameraOnly = /\b(?:camera|body)\s+only\b|\bonly\s+(?:a\s+)?(?:camera|body)\b/i.test(b.note || "");
  let keys: string[] = cameraOnly ? ["camera"] : design?.stages?.length ? design.stages.map((s: any) => s.key) : FALLBACK[(b.shootType || "default").toLowerCase()] || FALLBACK.default;
  keys = keys.filter((k) => STAGE[k]);
  keys = Array.from(new Set(keys));
  const oi = (k: string) => (ORDER.indexOf(k) === -1 ? 99 : ORDER.indexOf(k));
  keys.sort((a, z) => oi(a) - oi(z));

  // onboarding: emphasize the categories the customer said they mainly need (right after camera + lens)
  const CAT_MAP: Record<string, string[]> = {
    Lenses: ["lens"], Lighting: ["light"], Audio: ["lav-mic", "shotgun-mic", "wireless-mic"],
    Stabilisation: ["gimbal", "slider"], Support: ["tripod", "slider"], Monitoring: ["monitor"],
    "DJ & sound":["dj-deck","mixer","speaker","headphones"],Recording:["recorder"],Projection:["projector"],Drones:["drone"],Accessories:["accessory"],
  };
  const wanted = new Set<string>();
  for (const cat of (b.categories || []) as string[]) for (const k of CAT_MAP[cat] || []) if (STAGE[k]) wanted.add(k);
  if (wanted.size && !cameraOnly) {
    for (const k of wanted) if (!keys.includes(k)) keys.push(k);
    const pri = (k: string) => (k === "camera" ? 0 : k === "lens" ? 1 : wanted.has(k) ? 2 : 3);
    keys.sort((a, z) => pri(a) - pri(z) || oi(a) - oi(z));
  }

  // small/solo shoots favour autofocus glass (run-and-gun); large productions favour cinema glass
  const sizeL = (b.size || "").toLowerCase();
  const lensPref = sizeL.includes("large") ? "cine" : "af";
  const small = sizeL.includes("solo") || sizeL.includes("small") || !sizeL;

  const stages: any[] = [];
  // anchored to the RECOMMENDED camera so the lens/battery stages reason about the real body.
  let camMounts: string[] = [];
  let camCoverage: string | null = null;
  let camBattery: string | null = null;
  let includedFocal: string | null = null;
  const selected: RecommendationItem[] = [];
  const includedTypes = new Set<string>(); // contents of every recommended item, including lens/rig kits
  const requestedCamera = equipmentModelTokens(b.note || "").filter(model => /^(?:fx|fs|a7|bmpcc|pxw|gh|eos|c\d|r\d|z\d)/.test(model)).join(" ");
  let cameraChoiceMissing = false;
  for (const k of keys.slice(0, 9)) {
    const meta = design?.stages?.find((s: any) => s.key === k);
    let options: any[];
    try {
      options = await optionsForStage(c, k, start, end, { lensPref, camMounts, camCoverage, camBattery, includedFocal, small, selected, pickupTime, returnTime, compatibilityKits, refreshStock }, getTypeListings);
    } catch (error) {
      if (stockRefreshFailed) return NextResponse.json({ error: "Live Rental Manager stock could not be refreshed. Please try again.", stages: [] }, { status: 503 });
      throw error;
    }
    if (!options.length) continue;
    // ONE recommended id per stage — camera uses the LLM hint / top body; everything else leads
    // with the top COMPATIBLE option. (Camera's recCam below must match this so the note agrees.)
    const recId: string = k === "camera"
      ? (requestedCamera ? pickRecommended(options, requestedCamera) ?? "" : pickRecommended(options, meta?.recommend) ?? options[0].listingId)
      : cameraChoiceMissing ? "" : (options.find((o: any) => o.compat !== "incompatible" && o.automaticEligible)?.listingId ?? "");
    if (k === "camera" && requestedCamera && !recId) cameraChoiceMissing = true;
    if (k === "camera" && recId) {
      const recCam = options.find((o: any) => o.listingId === recId) ?? options[0];
      camMounts = parseMounts(recCam?.mount);
      camCoverage = recCam?.specs?.coverage ?? null;
      camBattery = recCam?.specs?.batteryType ?? null;
      includedFocal = recCam?.specs?.includesLens ? (recCam?.specs?.lensFocal ?? null) : null;
      selected.push(recCam);
      includedFocal = includedLensFocals(recCam).join(", ") || null;
      for (const it of documentedIncludedTypes(recCam)) includedTypes.add(it);
    }
    // a non-lens item the chosen set ALREADY includes → don't pre-recommend it (its unit is
    // already booked inside the bundle); the customer can still add a spare if they want.
    const stype = STAGE_ITEMTYPE[k];
    const includedInKit = k !== "camera" && !!stype && stype !== "lens" && includedTypes.has(stype);
    // Model prose cannot attest contents or describe the engine's actual pick.
    // Keep equipment claims grounded in the selected catalogue records.
    let note = "Compare the available options for your selected dates and times.";
    if (k === "camera" && requestedCamera && !recId)
      note = "The requested camera model is not available in these options. Choose an alternative before building the rest of your kit.";
    if (includedInKit)
      note = `An earlier kit choice already includes this equipment. Only add another if you need a spare.`;
    if (k === "lens") {
      note = "Choose the focal coverage you need. Equipment already supplied by your selected kit is not recommended again.";
      note += (note ? " " : "") + (lensPref === "cine"
        ? "Cinema glass first for a larger crew (manual focus, focus puller recommended)."
        : "Autofocus glass first for fast, small-crew shooting.");
    }
    if (k !== "camera" && !includedInKit && recId) {
      const recommended = options.find((option: any) => option.listingId === recId);
      if (recommended) {
        selected.push(recommended);
        for (const type of documentedIncludedTypes(recommended)) includedTypes.add(type);
      }
    }
    stages.push({
      key: k,
      label: DEFAULT_LABEL[k] || k,
      note,
      multi: MULTI.has(k),
      upsell: !!meta?.upsell,
      recommendedId: includedInKit ? "" : recId,
      includedInKit,
      options,
    });
  }

  return NextResponse.json({
    reply: "Let's build your kit step by step. The options use your rental dates and times; recommendations update as you choose equipment.",
    // compatibility checklist is computed by the shared engine on the client (kitWarnings over the
    // SELECTED kit) — never the LLM, which hallucinated items/brands that don't exist.
    compatibility: [],
    stages,
    compatibilityKits,
  });
}
