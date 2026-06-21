/**
 * compat.ts — the single cross-item compatibility engine.
 *
 * mount.ts answers "does this lens mount on this body". This module answers the
 * BROADER question the cart actually asks: given a kit of items, which pairs are
 * incompatible, need an adapter, or merely redundant — across EVERY dimension we
 * can ground in the catalogue's derived specs:
 *
 *   1. mount        lens ↔ camera        (delegates to mount.ts — the matrix)
 *   2. coverage     lens ↔ camera        Super-35 glass vignettes on a FF body
 *   3. filterThread ND   ↔ lens          82mm VND won't sit on a 67mm lens
 *   4. battery      battery ↔ camera     V-mount won't power an NP-FZ100 body
 *   5. redundant    lens ↔ kit-camera    body already ships a lens
 *   6. fixed-lens   lens ↔ action cam    nothing attaches to a GoPro
 *
 * The cart route, the bot and the truth harness ALL import kitWarnings() so the
 * "what works with what" rule can never fork into divergent hand-rolled tables
 * again (which is exactly how the old mount bug crept in).
 */
import { bestCompat, parseMounts, type BestCompat } from "./mount";
import { bundleIncludes } from "../../convex/lib/taxonomy";

export type WarnLevel = "info" | "warn" | "error";
export type Warning = { level: WarnLevel; dimension: string; text: string };

/** Minimal shape every surface already has: a catalogue card + its derived specs. */
export type KitSpecs = {
  mount?: string | null;
  filterThreadMm?: number | null;
  batteryType?: string | null;
  includesLens?: boolean | null;
  lensFocal?: string | null;
  tier?: string | null;
  coverage?: string | null; // "ff" | "s35" | "mft"
};
export type KitItem = {
  itemType?: string | null;
  title?: string | null;
  specs?: KitSpecs | null;
};

/** Kit-lens focal → front filter thread (mm), for bodies sold WITH a lens. */
export const FOCAL_THREAD: Record<string, number> = {
  "28-70": 67, "24-70": 82, "16-35": 72, "24-105": 77, "70-200": 77, "24-240": 67, "18-105": 72, "18-135": 67,
};

// Sensor / image-circle size ordered small→large. A lens whose circle ≥ the
// sensor covers it; smaller vignettes.
const COVERAGE_RANK: Record<string, number> = { mft: 1, s35: 2, ff: 3 };

/** Does a lens of `lensCov` cover a sensor of `camCov`? */
export function coverageCompat(lensCov?: string | null, camCov?: string | null): "full" | "vignette" | "unknown" {
  const l = lensCov ? COVERAGE_RANK[lensCov] : undefined;
  const c = camCov ? COVERAGE_RANK[camCov] : undefined;
  if (l == null || c == null) return "unknown"; // can't constrain
  return l >= c ? "full" : "vignette";
}

/**
 * Battery power compatibility. Compares CANONICAL families exactly — NOT substrings —
 * because "NP-FZ100" *contains* "NP-F" yet an NP-F970 cannot power an NP-FZ100 body.
 * Compound types ("NP-F/LP-E6") are split so either family can match.
 */
export function battOk(camBatt: string, batt: string): boolean {
  const fams = (s: string) => String(s).toLowerCase().split(/[\/,]/).map((x) => x.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  const cam = fams(camBatt), b = fams(batt);
  return cam.some((cb) => b.some((bb) => cb === bb));
}

/**
 * "Rig power" — V-mount / V-lock / gold-mount / B-mount / Anton Bauer / D-tap.
 * These don't match a body's small native battery family, but they POWER cinema
 * cameras (and monitors, wireless video, LED lights) through a battery plate +
 * D-tap / dummy battery. So they must never read as "won't power" — they're a
 * supplementary rig power source, not an incompatible battery.
 */
const RIG_POWER_RE = /v-?mount|v-?lock|gold-?mount|\bb-?mount\b|ab-?mount|anton|d-?tap/i;
export const isRigPower = (b?: string | null) => !!b && RIG_POWER_RE.test(String(b));

/** Bodies that genuinely take a V-mount plate / D-tap on a rig (cinema + large-sensor). */
const CINEMA_BODY_RE = /cine|cinema|fx ?6|fx ?9|c ?70|c ?100|c ?200|c ?300|c ?500|c ?400|alexa|amira|ursa|komodo|raptor|venice|burano|bmpcc|pocket cinema|\bred\b|varicam|fs7|fs5/i;
export const isCinemaBody = (specs: KitSpecs, title?: string | null) =>
  isRigPower(specs.batteryType) || CINEMA_BODY_RE.test(String(title ?? ""));

const cut = (s: unknown, n: number) => String(s ?? "").slice(0, n);

/**
 * Full pairwise compatibility scan of a kit. Pure — no IO. Returns ordered
 * warnings (errors first). `kit` items carry itemType + derived specs.
 */
export function kitWarnings(kit: KitItem[]): Warning[] {
  const cameras = kit.filter((x) => x.itemType === "camera-body");
  const lenses = kit.filter((x) => x.itemType === "lens");
  const nds = kit.filter((x) => x.itemType === "nd-filter");
  const batteries = kit.filter((x) => x.itemType === "battery");
  const out: Warning[] = [];

  const sp = (x: KitItem): KitSpecs => x.specs ?? {};

  // 1) redundant lens — camera bundle already includes a lens
  for (const cam of cameras)
    if (sp(cam).includesLens && lenses.length)
      out.push({
        level: "info", dimension: "redundant",
        text: `Your ${cut(cam.title, 34)} already includes a ${sp(cam).lensFocal || "kit"}mm lens — the ${cut(lenses[0].title, 28)} would be a second lens.`,
      });

  // 1b) redundant secondary gear — the chosen set already bundles this item type, so a
  // separately-added one is a spare/second (and its scarce unit is already booked in the set).
  const TYPE_LABEL: Record<string, string> = {
    battery: "battery", monitor: "monitor", gimbal: "gimbal", tripod: "tripod",
    "nd-filter": "ND filter", slider: "slider", light: "light", "wireless-mic": "wireless mic", recorder: "recorder",
  };
  for (const cam of cameras) {
    const inc = new Set(bundleIncludes(cam.title || ""));
    for (const x of kit) {
      if (x === cam || x.itemType === "camera-body" || !x.itemType || x.itemType === "lens") continue; // lens handled above
      if (inc.has(x.itemType as never) && TYPE_LABEL[x.itemType])
        out.push({
          level: "info", dimension: "redundant",
          text: `Your ${cut(cam.title, 30)} set already includes a ${TYPE_LABEL[x.itemType]} — the ${cut(x.title, 24)} would be a spare/second.`,
        });
    }
  }

  // 2) fixed-lens body — nothing attaches
  const fixedCams = cameras.filter((c) => sp(c).mount === "fixed");
  if (fixedCams.length && cameras.length === fixedCams.length && lenses.length)
    out.push({ level: "error", dimension: "fixed-lens", text: `Your action camera has a fixed lens — separate lenses won't attach.` });

  // 3) lens mount vs camera — single source of truth: mount.ts bestCompat
  const camMounts = [...new Set(cameras.map((c) => sp(c).mount).filter(Boolean).flatMap((m) => parseMounts(m!)))];
  const actionOnly = cameras.length > 0 && cameras.every((c) => sp(c).mount === "fixed");
  for (const l of lenses) {
    const lm = sp(l).mount;
    if (!lm || camMounts.length === 0 || actionOnly) continue;
    const verdict: BestCompat = bestCompat(parseMounts(lm), camMounts);
    if (verdict === "native" || verdict === "unknown") continue;
    if (verdict === "adapter")
      out.push({ level: "warn", dimension: "mount", text: `${cut(l.title, 30)} is ${lm} mount — needs a ${lm}→${camMounts[0]} adapter for your ${camMounts[0]}-mount camera.` });
    else
      out.push({ level: "error", dimension: "mount", text: `${cut(l.title, 30)} (${lm} mount) doesn't fit your ${camMounts[0]}-mount camera.` });
  }

  // 4) sensor coverage vs camera — a Super-35 lens vignettes on a full-frame body.
  // Only when the lens DOES mount (native/adapter), else the mount warning already covers it.
  const camCovs = [...new Set(cameras.map((c) => sp(c).coverage).filter(Boolean) as string[])];
  if (camCovs.length) {
    const biggestCam = camCovs.reduce((a, b) => (COVERAGE_RANK[b] > COVERAGE_RANK[a] ? b : a));
    for (const l of lenses) {
      const lm = sp(l).mount;
      const mounts = !lm || camMounts.length === 0 || bestCompat(parseMounts(lm), camMounts) !== "incompatible";
      if (!mounts) continue; // mount warning owns this pair
      if (coverageCompat(sp(l).coverage, biggestCam) === "vignette")
        out.push({
          level: "warn", dimension: "coverage",
          text: `${cut(l.title, 30)} is a ${sp(l).coverage!.toUpperCase()} lens — it will vignette / crop on your full-frame camera.`,
        });
    }
  }

  // 5) ND thread vs lens / kit-lens thread
  const lensThreads = lenses.map((l) => sp(l).filterThreadMm).filter(Boolean) as number[];
  for (const cam of cameras) {
    const f = sp(cam).lensFocal;
    if (sp(cam).includesLens && f && FOCAL_THREAD[f]) lensThreads.push(FOCAL_THREAD[f]);
  }
  for (const nd of nds) {
    const ndT = sp(nd).filterThreadMm;
    // a bigger ND (with a step-DOWN ring) fits a smaller lens, but never the reverse;
    // warn only when the ND is SMALLER than every known lens thread (genuinely won't seat).
    if (ndT && lensThreads.length && lensThreads.every((lt) => ndT < lt))
      out.push({
        level: "warn", dimension: "filter",
        text: `The ${ndT}mm ${cut(nd.title, 20)} is smaller than your lens (Ø${[...new Set(lensThreads)].join("/")}mm) — needs a step-up ring.`,
      });
  }

  // 6) battery vs camera. V-mount / broadcast power is "rig power" — it runs cinema
  // bodies (and monitors, wireless video, lights) through a plate + D-tap, so it is
  // never "incompatible"; it's surfaced as the supplementary rig power source.
  const camBatts = cameras.map((c) => sp(c).batteryType).filter(Boolean) as string[];
  const powerHungry = kit.filter((x) => x.itemType === "light" || x.itemType === "monitor");
  for (const bat of batteries) {
    const bt = sp(bat).batteryType;
    if (!bt) continue;
    if (isRigPower(bt)) {
      if (cameras.length || powerHungry.length) {
        const extra = powerHungry.length ? " — and your monitor/lights via D-tap" : "";
        out.push({ level: "info", dimension: "battery", text: `${cut(bat.title, 26)} (${bt}) powers your camera off a V-mount plate + D-tap${extra}.` });
      }
      continue;
    }
    if (camBatts.length && !camBatts.some((cb) => battOk(cb, bt)))
      out.push({ level: "error", dimension: "battery", text: `The ${cut(bat.title, 26)} (${bt}) won't power your camera (needs ${camBatts[0]}).` });
  }

  // errors first, then warns, then info
  const rank: Record<WarnLevel, number> = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
