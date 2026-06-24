// ── Unified kit-builder ranking engine ──────────────────────────────────────
// ONE scoring formula shared by /api/assemble (server build) and the assemble page
// (live re-rank), so the recommendation can never drift between them. Pure module.
import { parseMounts, mountCompat } from "@/lib/mount";
import { battOk, isRigPower, coverageCompat } from "@/lib/compat";

export type RankCtx = {
  key: string; // stage key
  camMounts?: string[];
  camCoverage?: string | null;
  camBatts?: string[]; // selected cameras' battery types
  cinemaRig?: boolean;
  hasGimbal?: boolean;
  includedFocal?: string | null; // focal the chosen body's kit lens already covers
  small?: boolean; // solo / small crew
  lensPref?: string; // "af" | "cine"
  prefer?: RegExp; // stage's prefer hint
};

/** Real rental-history demand boost — recommend what's actually rented. */
export function demandBoost(d: any): number {
  const n = Number(d) || 0;
  return n <= 0 ? 0 : Math.min(40, Math.round(Math.sqrt(n) * 1.3));
}

/** Mount compatibility verdict of an option vs the kit's camera mounts. */
export function compatVerdict(
  optionMount: string | null | undefined,
  camMounts: string[] = [],
): "native" | "adapter" | "unknown" | "incompatible" {
  const lensMounts = parseMounts(optionMount);
  if (!lensMounts.length || !camMounts.length) return "unknown";
  let best: "adapter" | "incompatible" = "incompatible";
  for (const lm of lensMounts)
    for (const cm of camMounts) {
      const r = mountCompat(lm, cm);
      if (r === "native") return "native";
      if (r === "adapter") best = "adapter";
    }
  return best;
}

/** Power compatibility of a battery option vs the kit camera's battery type. */
export function batteryVerdict(
  optBatt: string | null | undefined,
  camBatt: string | null | undefined,
): "native" | "incompatible" | "unknown" {
  if (isRigPower(optBatt)) return "native";
  if (!optBatt || !camBatt) return "unknown";
  return battOk(camBatt, optBatt) ? "native" : "incompatible";
}

export const isAnamorphic = (t: string) => /\banamorphic\b/i.test(t || "");
/** A multi-lens bundle ("ultimate set", 3+ focal ranges) — we lead with individual glass. */
export const isLensSet = (t: string) =>
  /\bultimate\b|\blens (?:set|kit|bundle)\b|\d-?lens/i.test(t || "") ||
  ((t || "").match(/\d{2,3}\s*-\s*\d{2,3}/g) || []).length >= 3;

/** A camera SET/bundle (vs a standalone body) — bodies lead, sets follow as an upsell. */
export const isCameraSet = (t: string) =>
  /\+|\bset\b|\bkit\b|\bbundle\b|\bultimate\b|production set|full (?:set|kit|production)|operator|\bdp\b|\d\s*[x\u00d7]\s/i.test(t || "");

/** Native-flagship lens preference for the chosen body's mount.
 *  Sony-E → Sony G Master; EF/PL/RF (BMPCC / cinema) → anamorphic + Canon glass. */
export function lensPriority(title: string, camMounts: string[] = []): number {
  const t = (title || "").toLowerCase();
  let b = 0;
  const sony = camMounts.includes("E");
  const efpl = camMounts.includes("EF") || camMounts.includes("PL") || camMounts.includes("RF");
  if (sony && /\bg ?master\b|gmaster|\bgm\b/.test(t) && /\bsony\b/.test(t)) b += 18;
  if (sony && /\b(sigma|tamron|samyang|rokinon|viltrox)\b/.test(t)) b -= 4;
  if (efpl && isAnamorphic(t)) b += 22; // anamorphic first for BMPCC / cinema bodies
  if (efpl && /\bcanon\b|\bef\b/.test(t) && /\bl\b|usm|f2\.8 l|f4 l|l series/.test(t)) b += 16;
  else if (efpl && (/\bcanon\b/.test(t) || /\bef\b/.test(t))) b += 8;
  if (/24-?70/.test(t)) b += 4; // workhorse zoom
  if (isLensSet(t)) b -= 18; // individual lenses lead, multi-lens kits demoted
  return b;
}

/** Battery scoring vs the chosen kit (gimbal pack / V-mount / native spare). */
export function batteryScore(o: any, ctx: RankCtx): number {
  let n = 0;
  const bt = o.specs?.batteryType;
  const isGimbalBatt = /gimbal/i.test(o.title || "");
  const rig = isRigPower(bt) || /v-?mount|v-?lock|d-?tap|gold-?mount|b-?mount|anton/i.test(o.title || "");
  if (ctx.hasGimbal && isGimbalBatt) n += 150;
  else if (isGimbalBatt) n -= 60;
  if (rig) n += ctx.cinemaRig ? 150 : 25;
  else if (bt && ctx.camBatts?.length && ctx.camBatts.some((cb) => battOk(cb, bt))) n += 120;
  return n;
}

/** THE single option score — higher is better. Server build + client live re-rank both call this. */
export function scoreOption(o: any, ctx: RankCtx): number {
  let s = demandBoost(o.demandScore);
  const key = ctx.key;
  const camMounts = ctx.camMounts ?? [];
  if (key === "lens" && camMounts.length) {
    const v = compatVerdict(o.mount, camMounts);
    s += v === "native" ? 1000 : v === "adapter" ? 400 : v === "incompatible" ? -10000 : 0;
    s += lensPriority(o.title, camMounts);
    if (coverageCompat(o.specs?.coverage, ctx.camCoverage ?? null) === "vignette") s -= 60;
    if (ctx.includedFocal && new RegExp(ctx.includedFocal.replace(/[^0-9-]/g, "")).test(String(o.title).replace(/[^0-9-]/g, " "))) s -= 80;
    if (ctx.lensPref && o.specs?.lensClass === ctx.lensPref) s += 6;
  } else if (key === "battery") {
    s += batteryScore(o, ctx);
  } else if (key === "camera") {
    s += isCameraSet(o.title) ? 0 : 90; // standalone body leads; full sets still listed below as an upsell
    const action = o.mount === "fixed" || /gopro|go ?pro|osmo|insta ?360|action ?\d|pocket ?\d|max/i.test(o.title || "");
    if (action) s -= 80; // action cams are niche — keep them below proper cinema/mirrorless bodies
  }
  const qty = o.qty ?? 1;
  if (ctx.small && qty >= 3) s -= 50;
  else if (ctx.small && qty >= 2 && key !== "lens") s -= 15;
  if (ctx.prefer && ctx.prefer.test(o.title || "")) s += 3;
  return s;
}

/** Comparator: best score first, cheapest as tiebreak. */
export function compareOptions(a: any, b: any, ctx: RankCtx): number {
  const d = scoreOption(b, ctx) - scoreOption(a, ctx);
  if (d !== 0) return d;
  return (a.total ?? 0) - (b.total ?? 0);
}
