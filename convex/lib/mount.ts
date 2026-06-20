/**
 * mount.ts — the single source of truth for camera/lens mount compatibility
 * AND lens ranking. Lives convex-side so BOTH the Convex functions
 * (recommendations.ts, sync.ts) and the Next layer (src/lib/mount.ts re-exports
 * this, used by gaffer.ts, the assemble API + page, the compat engine) funnel
 * through ONE matrix — the "what mounts on what" rule can never drift again.
 *
 * Compatibility is THREE-state — native / adapter / incompatible — not a
 * boolean gate. That distinction is what lets us rank a native Sony GM lens
 * above a Canon EF lens that merely *fits via adapter* on the same E body.
 */

/** Canonical mount tokens we reason about. Anything else normalises to null. */
export type Mount = "E" | "EF" | "RF" | "PL" | "MFT" | "L" | "X" | "fixed" | "any";
export type Compat = "native" | "adapter" | "incompatible";
export type BestCompat = Compat | "unknown";

/**
 * Normalise a single raw mount token to one of our canonical tokens.
 * Handles common aliases (FE/E-mount → E, EF-S → EF, micro-four-thirds → MFT…).
 * Returns null for anything unrecognised so callers can drop it cleanly.
 */
export function normalizeMount(token: string | null | undefined): Mount | null {
  if (token == null) return null;
  const t = String(token).trim().toUpperCase().replace(/[\s_]+/g, "-");
  if (!t) return null;
  // Sony E family — FE, GM, G and "G Master" glass are all E-mount.
  if (t === "E" || t === "FE" || t === "E-MOUNT" || t === "EMOUNT" || t === "SONY-E" || t === "GM" || t === "G-MASTER" || t === "GMASTER" || t === "G")
    return "E";
  // Canon EF / EF-S share the EF flange (EF-S is a strict subset for our purposes).
  if (t === "EF" || t === "EF-S" || t === "EFS" || t === "EF-MOUNT") return "EF";
  // Canon RF.
  if (t === "RF" || t === "RF-MOUNT" || t === "RF-S" || t === "RFS") return "RF";
  // Arri/cine PL.
  if (t === "PL" || t === "PL-MOUNT") return "PL";
  // Micro Four Thirds.
  if (t === "MFT" || t === "M43" || t === "M4/3" || t === "MICRO-FOUR-THIRDS" || t === "MICRO-4/3" || t === "MICRO43")
    return "MFT";
  // L-mount alliance (Leica/Panasonic/Sigma).
  if (t === "L" || t === "L-MOUNT" || t === "LEICA-L") return "L";
  // Fujifilm X.
  if (t === "X" || t === "X-MOUNT" || t === "FUJI-X" || t === "FX") return "X";
  // Fixed-lens bodies (action cams, pocket cams) — no interchangeable lens.
  if (t === "FIXED" || t === "NONE" || t === "BUILT-IN" || t === "BUILTIN") return "fixed";
  // Unknown-but-allow sentinel.
  if (t === "ANY" || t === "*" || t === "ALL") return "any";
  return null;
}

/**
 * Parse a raw mount string into normalised, de-duped canonical tokens.
 * Splits on `/ , |` so compound listings like "E/EF/PL" become
 * ["E","EF","PL"]. Empty / null / all-unknown → [].
 */
export function parseMounts(raw?: string | null): Mount[] {
  if (raw == null) return [];
  const out: Mount[] = [];
  for (const part of String(raw).split(/[\/,|]+/)) {
    const m = normalizeMount(part);
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * Real-world compatibility of one lens mount against one camera mount.
 * Matrix (the correctness standard):
 *  - Sony E body:   E = native; EF/PL = adapter; RF/MFT/L/X = incompatible.
 *  - Canon RF body: RF = native; EF = adapter (official, full AF); rest incompatible.
 *  - Canon EF body: EF = native; RF/E = incompatible.
 *  - MFT body:      MFT = native; EF/PL = adapter.
 *  - L body:        L = native; EF/PL = adapter.
 *  - PL cine body:  PL = native; everything smaller = incompatible.
 *  - fixed body:    no interchangeable lens → everything incompatible.
 *  - "any" on either side ⇒ native (unknown-but-allow).
 */
export function mountCompat(lensMount: string, camMount: string): Compat {
  const lens = normalizeMount(lensMount);
  const cam = normalizeMount(camMount);
  // Unknown-but-allow on either side: treat as native.
  if (lens === "any" || cam === "any") return "native";
  // Unrecognised tokens: cannot reason → behave as incompatible (caller may
  // still fall through to "unknown" at the bestCompat level when sides empty).
  if (!lens || !cam) return "incompatible";
  // Exact same mount is always native (covers E/E, RF/RF, PL/PL, MFT/MFT, …).
  if (lens === cam) return "native";

  switch (cam) {
    case "E": // Sony E (FX3, a7, FX6 …)
      if (lens === "EF" || lens === "PL") return "adapter";
      return "incompatible"; // RF, MFT, L, X
    case "RF": // Canon mirrorless
      if (lens === "EF") return "adapter"; // official EF→RF adapter, full AF
      return "incompatible";
    case "EF": // Canon DSLR / EF cine
      // EF-S already folded into EF by normalize; nothing else mounts natively.
      return "incompatible";
    case "MFT":
      if (lens === "EF" || lens === "PL") return "adapter";
      return "incompatible";
    case "L":
      if (lens === "EF" || lens === "PL") return "adapter";
      return "incompatible";
    case "PL": // PL cine body — only PL glass natively; smaller mounts can't reach flange.
      return "incompatible";
    case "fixed": // action/pocket cams — no interchangeable lens at all.
      return "incompatible";
    default:
      return "incompatible";
  }
}

/**
 * Best compatibility of a lens (which may list several mounts) against a set of
 * camera mounts, taken over the full cross product. native > adapter >
 * incompatible. If EITHER side is empty we have nothing to constrain on, so we
 * return "unknown" (callers score that as a mild positive, never a block).
 */
export function bestCompat(lensMounts: string[], camMounts: string[]): BestCompat {
  if (!lensMounts?.length || !camMounts?.length) return "unknown";
  let best: Compat = "incompatible";
  for (const lm of lensMounts) {
    for (const cm of camMounts) {
      const c = mountCompat(lm, cm);
      if (c === "native") return "native"; // can't beat native
      if (c === "adapter" && best === "incompatible") best = "adapter";
    }
  }
  return best;
}

/**
 * Score a lens for a given set of camera mounts. Higher = better.
 * INCOMPATIBLE ⇒ -Infinity so the caller excludes it outright.
 * Base: native 100, adapter 40, unknown 20.
 * +30 for premium / GM glass, +5 for autofocus (af) glass.
 * So native+premium (135) ≫ native (100) ≫ adapter (40) ≫ unknown (20).
 *
 * `mount` may be a compound raw string ("E/EF/PL") or already-parsed — we
 * parse defensively. `camMounts` are raw or canonical tokens (parsed too).
 */
export function lensScore(
  lens: { mount?: string | null; tier?: string | null; lensClass?: string | null },
  camMounts: string[],
): number {
  const lensMounts = parseMounts(lens.mount);
  // camMounts may arrive as canonical tokens or raw compound strings — flatten.
  const cams: string[] = [];
  for (const cm of camMounts || []) for (const p of parseMounts(cm)) if (!cams.includes(p)) cams.push(p);

  const compat = bestCompat(lensMounts, cams);
  if (compat === "incompatible") return -Infinity; // caller excludes

  let score = compat === "native" ? 100 : compat === "adapter" ? 40 : 20; // unknown → 20
  const tier = String(lens.tier ?? "").toLowerCase();
  if (tier === "premium" || tier === "gm") score += 30; // premium / GM boost
  if (String(lens.lensClass ?? "").toLowerCase() === "af") score += 5; // autofocus convenience
  return score;
}

/**
 * Backward-compatible boolean gate (legacy callers). A lens "fits" a camera set
 * unless the best compatibility is strictly incompatible.
 * NOTE: empty camMounts ⇒ bestCompat = "unknown" ⇒ NOT incompatible ⇒ true,
 * which preserves the old "allow when no camera known" behaviour for the
 * boolean path. Scoring paths must NOT lean on this — they rank instead.
 */
export function lensFits(lensMount: string | null | undefined, camMounts: string[]): boolean {
  return bestCompat(parseMounts(lensMount), camMounts ?? []) !== "incompatible";
}
