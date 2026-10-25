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
 *   4. battery      battery ↔ camera     native family vs regulated external rig power
 *   5. redundant    lens ↔ kit-camera    body already ships a lens
 *   6. fixed-lens   lens ↔ action cam    nothing attaches to a GoPro
 *
 * The cart route, the bot and the truth harness ALL import kitWarnings() so the
 * "what works with what" rule can never fork into divergent hand-rolled tables
 * again (which is exactly how the old mount bug crept in).
 */
import { effectiveLensSpecs, filterThreadsFor } from "../../shared/opticalFacts";
import { bestCompat, parseMounts, type BestCompat } from "./mount";
import { documentedIncludedTypes, includedLensFocals, lensFocals, lensFit, verifiedGimbalPair, type RecommendationItem } from "../../shared/recommendationPolicy";

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
export type KitItem = RecommendationItem & {
  itemType?: string | null;
  title?: string | null;
  specs?: KitSpecs | null;
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
export function kitWarnings(kit: KitItem[], evidence: RecommendationItem[] = []): Warning[] {
  const cameras = kit.filter((x) => x.itemType === "camera-body");
  const lenses = kit.filter((x) => x.itemType === "lens");
  const nds = kit.filter((x) => x.itemType === "nd-filter");
  const batteries = kit.filter((x) => x.itemType === "battery");
  const out: Warning[] = [];

  const sp = (x: KitItem): KitSpecs => effectiveLensSpecs(x) ?? {};

  // A different focal length is a useful addition, not a duplicate upgrade.
  for (const cam of cameras) {
    const supplied = includedLensFocals(cam);
    for (const lens of lenses) if (lensFocals(lens).some(f => supplied.includes(f)))
      out.push({ level: "info", dimension: "redundant",
        text: `Your ${cut(cam.title, 34)} already includes glass covering ${supplied.join(" / ")}mm — ${cut(lens.title, 28)} overlaps it and would be an extra lens, not a replacement.` });
  }

  // 1b) redundant secondary gear — the chosen set already bundles this item type, so a
  // separately-added one is a spare/second (and its scarce unit is already booked in the set).
  const TYPE_LABEL: Record<string, string> = {
    battery: "battery", monitor: "monitor", gimbal: "gimbal", tripod: "tripod",
    "nd-filter": "ND filter", slider: "slider", light: "light", "wireless-mic": "wireless mic", recorder: "recorder",
  };
  for (const cam of cameras) {
    const inc = new Set(documentedIncludedTypes(cam));
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

  // Coverage belongs to a camera/lens pair. The largest sensor elsewhere
  // in a mixed-mount kit must not create a false crop warning for this pair.
  for (const lens of lenses) for (const camera of cameras) {
    const lm = parseMounts(sp(lens).mount), cm = parseMounts(sp(camera).mount);
    if (!lm.length || !cm.length || bestCompat(lm, cm) === "incompatible") continue;
    if (coverageCompat(sp(lens).coverage, sp(camera).coverage) === "vignette")
      out.push({ level: "warn", dimension: "coverage",
        text: `${cut(lens.title, 30)} has ${String(sp(lens).coverage).toUpperCase()} coverage — expect crop/vignetting on ${cut(camera.title, 30)}.` });
  }

  for (const lens of lenses) if (cameras.length && lensFit(lens, cameras) === "unknown")
    out.push({ level: "warn", dimension: "unknown", text: `Exact mount or sensor coverage is unconfirmed for ${cut(lens.title, 30)}. Confirm the lens and body pairing before booking.` });

  // 5) ND thread vs lens / kit-lens thread
  const lensThreads = [...lenses, ...cameras].flatMap(filterThreadsFor);
  for (const nd of nds) {
    const thread = sp(nd).filterThreadMm;
    if (!thread || !lensThreads.length) {
      if (cameras.length || lenses.length) out.push({ level: "warn", dimension: "filter",
        text: `Confirm the front filter diameter for ${cut(nd.title, 26)} and your exact lens before adding it.` });
      continue;
    }
    const otherThreads = [...new Set(lensThreads.filter(t => t !== thread))];
    if (otherThreads.length) out.push({ level: "warn", dimension: "filter",
      text: `The Ø${thread}mm ${cut(nd.title, 20)} needs a suitable step ring for your Ø${otherThreads.join("/Ø")}mm lens. Confirm the ring and check for vignetting.` });
  }

  // 6) battery vs camera. V-mount / broadcast power is "rig power" — it runs cinema
  // bodies (and monitors, wireless video, lights) through a plate + D-tap, so it is
  // never "incompatible"; it's surfaced as the supplementary rig power source.
  const camBatts = cameras.map((c) => sp(c).batteryType).filter(Boolean) as string[];
  for (const bat of batteries) {
    const bt = sp(bat).batteryType;
    if (!bt) continue;
    if (isRigPower(bt)) {
      if (camBatts.length && !camBatts.some(cb => battOk(cb, bt)))
        out.push({ level: "warn", dimension: "battery", text: `${cut(bat.title, 26)} (${bt}) is external rig power. Confirm a suitable plate, regulated cable and camera input voltage; it is not a native camera battery.` });
      continue;
    }
    if (camBatts.length && !camBatts.some((cb) => battOk(cb, bt)))
      out.push({ level: "error", dimension: "battery", text: `The ${cut(bat.title, 26)} (${bt}) won't power your camera (needs ${camBatts[0]}).` });
  }

  for (const gimbal of kit.filter(item => item.itemType === "gimbal")) {
    if (cameras.length && !verifiedGimbalPair(gimbal, kit.filter(item => item !== gimbal), evidence))
      out.push({ level: "warn", dimension: "gimbal", text: `Confirm payload, lens clearance, mounting and balance for ${cut(gimbal.title, 30)} with your selected camera rig. This exact combination is not documented in our verified kits.` });
  }

  // errors first, then warns, then info
  const rank: Record<WarnLevel, number> = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
