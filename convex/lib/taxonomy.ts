/**
 * Item taxonomy + the "frequently rented together" complement net.
 * Pure module shared by sync (classification), recommendations and offers.
 */

export type ItemType =
  | "camera-body"
  | "lens"
  | "nd-filter"
  | "gimbal"
  | "tripod"
  | "slider"
  | "wireless-mic"
  | "boom-mic"
  | "recorder"
  | "speaker"
  | "dj-deck"
  | "mixer"
  | "headphones"
  | "light"
  | "monitor"
  | "drone"
  | "battery"
  | "accessory";

// A real camera BODY is named by a model token (fx3, a7, bmpcc, venice, red,
// komodo, alexa, c70, …) — NOT merely the word "camera". This lets us catch
// accessories/grip/service listings that only *mention* "camera" (tripods,
// teleprompters, mount adapters, memory cards, support vests, "operator DP"
// service listings, transmitters, flashes) BEFORE the greedy camera rule,
// without stealing genuine camera PACKAGES (which always name a body model).
const CAMERA_MODEL =
  /\b(bmpcc|pyxis|fx3|fx ?3|fx6|fx ?6|fx30|fx ?30|fx9|fx ?9|a7|a7s|a7s ?iii|a7r|a7c|a7iii|a73|a7iv|a7v|a6\d00|a1\b|a9\b|venice|burano|alexa|amira|\bred\b|gemini|ursa|c70|c-?70|c300|c200|c500|c400|komodo|raptor|gh5|gh6|gh7|s1h|pocket cinema|z ?cam|zv-?e|x-?t\d|x100|eos ?r|\br5\b|\br6\b|\br3\b|\br8\b|gopro|go ?pro|osmo|insta ?360|hero ?\d)\b/i;

// For the camera-model GUARD only: strip SEO "(like …)" comparisons and "for <compat list>"
// clauses, so a TRIPOD/accessory that merely lists "for … Sony FX3, Canon C70" isn't read
// as a camera. Not used for the main rules — only to decide if a body model is genuinely the hero.
function modelGuardName(name: string): string {
  return String(name || "")
    .replace(/\((?:like|such as|similar to|comparable to)[^)]*\)/gi, " ")
    .replace(/\bfor\b[^|()]*/gi, " ");
}

// Accessory / grip / service heroes that the GREEDY `\bcamera\b` rule wrongly
// swallows into camera-body. These ONLY apply as a correction when the normal
// RULES fallthrough would otherwise be "camera-body" (see deriveItemType) — so
// audio/light/battery kits that merely *contain* an sd-card or transmitter are
// untouched (they classify correctly via RULES and never reach this guard).
const ACCESSORY_FIRST: [ItemType, RegExp][] = [
  ["tripod", /\b(tripod|monopod|fluid head|\blegs\b|sticks|support vest|easy ?rig|flowline|stabili[sz]ation vest)\b/i],
  ["slider", /\b(slider|dolly|\btrack\b|motorised slider|motorized slider)\b/i],
  ["light", /\b(camera flash|speedlite|speedlight|\bflash\b)\b/i],
  ["monitor", /\b(video transmitter|video transmission|image transmission|wireless transmitter|teradek|hollyland (?:mars|pyro))\b/i],
  ["accessory", /\b(teleprompter|prompter|cfexpress|cf-?express|memory card|card reader|mount adapter|lens adapter|mount converter|speed ?booster|follow ?focus|nucleus|\bfiz\b|cage rig|gaffer|focus puller|operator ?dp|\bdop\b|for hire|matte ?box|mattebox)\b/i],
];

// A small set of accessory heroes so strong they override even a named camera
// model — a "CFexpress card for Sony FX3" or "PL→EF adapter for Canon EF camera"
// names a body only for compatibility and is not a camera. Deliberately tiny:
// only nouns that are NEVER the hero of a real body/package listing. (sd-card /
// transmitter / receiver / batteries are NOT here — they appear inside genuine
// audio & GoPro kits as secondary components.)
const STRONG_ACCESSORY: [ItemType, RegExp][] = [
  // hardware-only accessories that override even a camera model (a card/adapter "for FX3" is not a camera).
  // NOTE: "operator dp / dop / for hire" is handled separately+gated in deriveItemType so a real
  // camera kit that merely INCLUDES an operator ("BMPCC 6K Pro Kit + Operator DP") stays a camera.
  ["accessory", /\b(teleprompter|prompter|cfexpress|cf-?express|card reader|mount adapter|lens adapter|mount converter)\b/i],
  ["tripod", /\b(support vest|easy ?rig|flowline)\b/i],
];
// gimbal HERO (title leads with the gimbal) so a "DJI RS4 + 24-70 lens" bundle is a gimbal, not a lens.
const GIMBAL_HERO = /^(?:\d+\s*[x×]\s*)?(?:dji |tilta |zhiyun |moza )*(?:ronin|rs ?[234]\b|rsc|crane|gimbal)\b/i;

// A battery/charger whose HERO noun is the battery (e.g. "Gimbal Battery DJI Ronin",
// "V-mount charger") — the "gimbal"/"camera" here is the COMPATIBILITY target, not the
// product, so it must beat the greedy gimbal/light rules. Anchored at the title start so
// genuine gimbal/light PACKAGES that merely include a battery ("DJI RS4 + battery") are untouched.
const BATTERY_HERO = /^(?:\d+\s*[x×]\s*)?(?:spare |extra |gimbal |camera |v-?mount |v-?lock |dji |sony |canon |godox |np-?f\d* )*(?:batter(?:y|ies)|charger)\b/i;

// Ordered, first match wins. Drone is matched FIRST so a "Mavic + ND filters"
// bundle classifies as a drone (not an ND filter). Camera bodies next so camera
// kits that also mention an accessory classify as the camera (the hero).
const RULES: [ItemType, RegExp][] = [
  ["drone", /\b(drone|mavic|\bfpv\b|avata|air ?[23]|mini ?[34]|inspire|neo)\b/i],
  ["camera-body", /\b(camera|bmpcc|pyxis|fx3|fx6|fx30|fx9|a7|a7s|a7s ?iii|a7r|a7c|a7iii|a73|a7iv|a6\d00|a1\b|a9\b|burano|venice|alexa|\bred\b|ursa|c70|c300|c200|c500|c400|komodo|raptor|gh5|gh6|gh7|s1h|s5|pocket cinema|z ?cam|zv-?e|lumix|eos ?r|\br5\b|\br6\b|\br3\b|\br8\b)\b/i],
  ["lens", /\b(lens|lenses|\d{2}-\d{2,3}mm|\d{2,3}-\d{2,3}|50mm|35mm|85mm|24mm|28mm|14mm|16mm|135mm|gm\b|g ?master|ultra ?wide|wide ?angle|telephoto|sigma|samyang|tamron|rokinon|\bfe\b|prime|zoom lens|cine lens|anamorphic|blazar|dzo|laowa|cooke|f1\.[248]|f2\.8|t1\.5|t2\.\d)\b/i],
  // matte boxes + atmosphere machines are accessories, not ND/monitor/light
  ["accessory", /\b(matte ?box|mattebox|french flag|follow ?focus|cage rig|haze|hazer|smoke machine|fog machine)\b/i],
  ["nd-filter", /\b(nd[\s-]?filter|variable nd|vnd|cpl|polari[sz]|filter kit|nd ?kit|nd ?set)\b/i],
  ["gimbal", /\b(gimbal|ronin|rs ?\d|rsc|crane|zhiyun|moza|stabili[sz]er)\b/i],
  ["slider", /\b(slider|dolly|track)\b/i],
  ["tripod", /\b(tripod|fluid head|monopod|\blegs\b|sticks|\bc-?stand\b|century stand)\b/i],
  // AUDIO is matched BEFORE dj-deck/mixer/speaker so a "JBL wireless microphone" or "Zoom field
  // recorder" isn't grabbed by the speaker(jbl)/mixer rules. boom/shotgun before generic wireless.
  ["recorder", /\b(recorder|zoom h\d|zoom f\d|tascam|mixpre|field recorder)\b/i],
  ["boom-mic", /\b(boom ?mic|boom ?pole|shotgun|\bntg\b|\bmkh\b|hypercardioid|deity|sennheiser mke|sm7b|podcast mic)\b/i],
  // NOTE: no trailing \b — it would break plurals ("microphones", "dji mics").
  ["wireless-mic", /(wireless ?mic|wireless ?go|dji ?mic|rode ?wireless|rode ?mic|lavalier|\blav\b|sennheiser ?(ew|g[34])|\bg[34]\b|handheld ?mic|radio ?mic|wireless ?microphone|microphone.{0,15}wireless)/i],
  ["dj-deck", /\b(\bdj\b|cdj|ddj|xdj|pioneer|turntable|rekordbox|serato)\b/i],
  ["mixer", /\b(mixer|mixing desk|djm)\b/i],
  ["speaker", /\b(speaker|partybox|\bjbl\b|\bpa\b|sub ?woofer|sound ?system)\b/i],
  ["headphones", /\b(headphone|headphones)\b/i],
  ["monitor", /\b(monitor|atomos|ninja v|shinobi|smallhd|feelworld|field monitor|on-?camera monitor)\b/i],
  ["light", /\b(light|aputure|godox|nanlite|amaran|forza|led|softbox|hmi|fresnel|lantern|pavotube|tube light|rgb|astera|titan tube|key ?light|panel|sky ?panel|cob|300d|600d|1200d|montura)\b/i],
  ["battery", /\b(battery|batteries|v-?mount|v-?lock|charger|np-?f|d-?tap|power station|anker)\b/i],
];

export function deriveItemType(name: string): ItemType {
  // Drones win outright (a "Mavic + ND" bundle is a drone).
  if (RULES[0][1].test(name)) return "drone";

  // "Operator DP / DOP / for hire" is a SERVICE (accessory) only when no real camera model is
  // named. "BMPCC 6K Pro Kit + Operator DP" names a camera → it's a camera rental, not a service.
  if (/\b(operator ?dp|\bdop\b|for hire)\b/i.test(name) && !CAMERA_MODEL.test(name)) return "accessory";

  // Gimbal HERO bundle ("DJI RS4 + 24-70 lens", no camera) → gimbal, before the lens rule grabs it.
  // BUT "Gimbal Battery …" is a battery, not a gimbal — exclude battery/charger heroes.
  if (GIMBAL_HERO.test(name.trim()) && !CAMERA_MODEL.test(name) && !/\b(batter(?:y|ies)|charger)\b/i.test(name)) return "gimbal";

  // Strong accessory heroes override a named camera model (a card/adapter "for Sony FX3" is
  // not a camera) — BUT a real camera BUNDLE that merely includes a card/adapter ("BMPCC 6K
  // + CFexpress + cage") stays a camera. So skip the accessory override when a camera model is present.
  for (const [t, re] of STRONG_ACCESSORY) if (re.test(name)) {
    if (t === "accessory" && CAMERA_MODEL.test(name)) continue;
    return t;
  }

  // Battery/charger hero beats the greedy gimbal/light rules ("Gimbal Battery …").
  if (BATTERY_HERO.test(name.trim()) && !CAMERA_MODEL.test(name)) return "battery";

  // A battery ADDON named by its battery MODEL ("Sony NP-FZ100 … batteries 2x set addon",
  // "Sony NP-970 batteries", "fz100 alpha camera batteries") is a battery even though it
  // says "camera" — the camera is the compatibility target, not the product. Gate on no
  // real camera MODEL so "FX3 + spare battery" stays a camera bundle.
  if (
    /\b(fz100|np-?fz100|np-?970|np ?970|lp-?e6|d-?tap|v[-\s]?mount|v[-\s]?lock)\b/i.test(name) &&
    /\b(batter(?:y|ies)|charger|power ?station|pack|add-?on)\b/i.test(name) &&
    !CAMERA_MODEL.test(name) &&
    !/\b(gimbal|ronin|rs ?[234]\b|rsc|crane|zhiyun|moza)\b/i.test(name) // a gimbal kit w/ a battery is a gimbal
  )
    return "battery";

  // Action-cam BODIES are real rentable cameras (GoPro / DJI Osmo Action+Pocket /
  // Insta360). The camera-body RULE can't list bare "osmo" (would swallow Osmo *Mobile*
  // gimbals), so match them here. EXCLUDE only when the accessory is the HERO — i.e. the
  // title STARTS with the accessory noun ("GoPro battery", "2x batteries for GoPro") — so a
  // genuine kit like "2x GoPro Hero 12 set + 4x batteries" stays a camera, not a battery.
  if (
    /\b(gopro|go ?pro|osmo ?(?:action|pocket)|dji ?pocket|insta ?360|action ?cam(?:era)?)\b/i.test(name) &&
    !/^(?:\d+\s*[x×]\s*)?(?:spare |extra )?(?:gopro |go ?pro |osmo |dji )?(?:batter(?:y|ies)|charger|sd ?card|memory ?card|mount|case|housing|strap|filter|\bnd\b|dome|float|grip|selfie|chest|handlebar|suction|adapter|cable|protector|lens ?cap|accessor)/i.test(name.trim())
  )
    return "camera-body";

  // Normal classification. RULES are first-match-wins; the camera-body rule is
  // greedy on the bare word "camera".
  let fallthrough: ItemType = "accessory";
  for (const [t, re] of RULES) {
    if (re.test(name)) {
      fallthrough = t;
      break;
    }
  }

  // Surgical correction: ONLY when the greedy rule decided "camera-body" do we
  // re-test the accessory/grip/service guards — and only if no real body model
  // is named. This protects genuine packages ("BMPCC 6k + tripod + follow
  // focus" has a model → stays camera-body) AND leaves correctly-typed
  // audio/light/battery kits alone (they never fall through to camera-body).
  // Also rescue a LENS fallthrough (e.g. a follow-focus whose blurb says "Lens Control"),
  // and use the model-guard name so a tripod "for … Sony FX3" isn't read as a camera.
  if ((fallthrough === "camera-body" || fallthrough === "lens") && !CAMERA_MODEL.test(modelGuardName(name))) {
    for (const [t, re] of ACCESSORY_FIRST) if (re.test(name)) return t;
  }
  return fallthrough;
}

// ── storefront category (the MAIN item of a set drives its category) ──────────
/** itemType → clean storefront category. The hero item decides the tab. */
export const CATEGORY_OF: Record<ItemType, string> = {
  "camera-body": "Cameras",
  lens: "Lenses",
  "nd-filter": "Lenses",
  light: "Lighting",
  gimbal: "Stabilizers",
  slider: "Grip",
  tripod: "Grip",
  monitor: "Monitors",
  drone: "Drones",
  battery: "Power",
  "wireless-mic": "Audio",
  "boom-mic": "Audio",
  recorder: "Audio",
  headphones: "Audio",
  speaker: "Sound & DJ",
  "dj-deck": "Sound & DJ",
  mixer: "Sound & DJ",
  accessory: "Accessories",
};

/**
 * A GENUINE bundle (→ "Packages") is a curated, CROSS-DEPARTMENT package — not
 * just a camera kit with its natural accessories (lens / ND / battery / cage /
 * gimbal / monitor). It either announces itself ("package" / "production kit") or
 * a camera kit that also crosses into a separate department (lighting AND audio).
 * A plain "set" / "kit" / "+ lens" is NOT a genuine bundle — it's categorised by
 * its main item (a camera kit lives in Cameras, a lens set in Lenses).
 */
export function isGenuineBundle(title: string): boolean {
  // strip SEO "(like … Bundle)" / "(such as …)" comparisons first so a gimbal rig
  // described as '(like "RS2 Pro Ring Grip Bundle")' isn't read as a genuine bundle.
  const t = String(title || "")
    .toLowerCase()
    .replace(/\bcannon\b/g, "canon")
    .replace(/\((?:like|such as|similar to|comparable to)[^)]*\)/g, " ");
  if (/\b(package|bundle|production kit|full (?:film|video|production|studio) kit|complete (?:kit|set ?up|package)|all[-\s]?in[-\s]?one|everything you need|filmmaker kit|content(?: creator)? kit)\b/.test(t)) return true;
  // a camera kit that ALSO spans lighting AND audio = a multi-department production bundle
  if (deriveItemType(title) === "camera-body") {
    const hasLight = /\b(aputure|godox|nanlite|amaran|forza|softbox|hmi|key ?light|rgb ?tube|pavotube|led (?:panel|light)|\blighting\b)\b/.test(t);
    const hasAudio = /\b(mic|microphone|wireless ?go|dji ?mic|\blav\b|lavalier|sennheiser|rode|røde|field recorder|zoom h\d)\b/.test(t);
    if (hasLight && hasAudio) return true;
  }
  return false;
}

/** Storefront category for a listing — hero-driven, genuine bundles → Packages. */
export function categoryFor(title: string): string {
  if (isGenuineBundle(title)) return "Packages";
  return CATEGORY_OF[deriveItemType(title)] ?? "Accessories";
}

// ── hard spec inference (mount, filter thread, battery, bundle) ────
export type Specs = {
  mount: string | null; // E | RF | EF | PL | MFT | fixed | null
  filterThreadMm: number | null;
  batteryType: string | null; // NP-FZ100 | LP-E6 | V-mount | NP-F | action
  includesLens: boolean;
  lensFocal: string | null; // "28-70"
  tier: string | null; // premium | standard (lenses)
  lensClass: string | null; // "af" (autofocus) | "cine" (manual cinema glass)
  hasAutofocus: boolean | null; // cameras: AF-centric body (Sony/Canon mirrorless) vs cine
  coverage: string | null; // "ff" | "s35" | "mft" — sensor/image-circle size, both bodies & lenses
};

// Sensor / image-circle size. For a camera it's the sensor; for a lens it's the
// image circle it projects. A bigger-or-equal lens circle covers the sensor; a
// SMALLER lens circle vignettes (e.g. a Super-35 lens on a full-frame body).
// Only emitted when we can tell with confidence — otherwise null (no constraint).
export function coverageOf(title: string, itemType: ItemType): string | null {
  const t = title.toLowerCase().replace(/\bcannon\b/g, "canon");
  const has = (re: RegExp) => re.test(t);
  if (itemType === "camera-body") {
    // micro four thirds bodies
    if (has(/\bmft\b|m4\/3|micro four|gh5|gh6|gh7|bmpcc ?4k|pocket ?4k/)) return "mft";
    // unambiguous full-frame bodies
    if (has(/fx3\b|fx6\b|fx9\b|a7|a1\b|a9\b|burano|venice|\br5\b|\br6\b|\br3\b|\br8\b|raptor|alexa ?(?:lf|mini ?lf|265)/))
      return "ff";
    // unambiguous super-35 / aps-c bodies
    if (has(/fx30|a6\d00|zv-?e10|fs5|fs7|\bc70\b|c100|c200|c300|komodo|ursa|amira|alexa(?! ?(?:lf|mini ?lf))|6k ?pro|6k ?g2|bmpcc ?6k|\br7\b|\br10\b|red ?(?:helium|gemini)/))
      return "s35";
    return null;
  }
  if (itemType === "lens") {
    // explicit super-35 / aps-c image circle (vignettes on a full-frame body)
    if (has(/super[-\s]?35|\bs35\b|aps-?c|\be-?pz\b|dx\b/)) return "s35";
    // explicit OR strongly-implied full-frame: Sony GM/FE, Canon RF L, "full frame"
    if (has(/full[-\s]?frame|\bff\b|\bgm\b|g[-\s]?master|\bfe\b|\brf\b ?\d|\bvv\b|large ?format/)) return "ff";
    return null;
  }
  return null;
}

// Canonical mount tokens, ordered. Used to extract an EXPLICIT compound mount
// string like "pl/ef/e/l/rf" → "E/EF/PL/L/RF". src/lib/mount.ts parseMounts
// splits on `/ , |`, so we store the raw compound string (NOT a single primary)
// to preserve every native+adapter path the lens-ranking engine relies on.
// Returning only the "primary" would discard adapter compatibility and silently
// down-rank glass the matrix should treat as native on a second mount.
// Canonical order for emitting a compound mount string (E first → matches how
// the snapshot's hand-corrected "E/EF/PL" values read, deterministic output).
const MOUNT_ORDER = ["E", "EF", "RF", "PL", "L", "MFT", "X"] as const;

// Pull an explicit, author-written multi-mount string, e.g.
//   "DZOFILM PL mount (e,l,x,rf)"  → "E/PL/L/X/RF"
//   "for pl, ef, e, x, l, rf mount" → "E/EF/RF/PL/L/X"
//   "e-ef-pl"                       → "E/EF/PL"
// Guard rails so brand/spec noise never becomes a mount:
//  - the title MUST contain the word "mount" (so a bare brand list like
//    "arri, Zeiss, cannon, Meike" is ignored — none of those are mount tokens
//    AND there's no "mount" cue),
//  - anamorphic squeeze factors ("1.5x", "2x") are stripped first so the "x" is
//    never read as Fuji X-mount,
//  - we union ALL standalone canonical mount tokens (not just the first run) so
//    a leading "PL mount" plus a parenthetical "(e,l,x,rf)" yields the full set.
function explicitCompoundMount(raw: string): string | null {
  if (!/\bmount\b/.test(raw)) return null;
  // strip squeeze factors / T-stops / digits, and Canon "L series" + "USM L"
  // designations (the luxury-lens "L" is NOT L-mount) before tokenising.
  const t = raw
    .replace(/\d+(?:\.\d+)?\s*x\b/g, " ") // 1.5x / 2x squeeze
    .replace(/\bt\d(?:\.\d+)?\b/g, " ") // T1.4 / T2.8
    .replace(/\busm\s*l\b/g, " usm ") // Canon "USM L"
    .replace(/\bl[-\s]?series\b/g, " ") // Canon "L series"
    .replace(/\bl\s*(?:i{1,3}|ii)\b/g, " ") // "L II" mark designation
    .replace(/\d/g, " ");
  // explicit, unambiguous mount tokens
  const set = new Set<string>();
  const add = (tok: string) => set.add(tok);
  if (/\b(?:e[-\s]?mount|emount|sony[-\s]?e|\bfe\b)\b/.test(t)) add("E");
  if (/\b(?:ef[-\s]?mount|canon[-\s]?ef|\bef\b)\b/.test(t)) add("EF");
  if (/\b(?:rf[-\s]?mount|canon[-\s]?rf|\brf\b)\b/.test(t)) add("RF");
  if (/\b(?:pl[-\s]?mount|arri[-\s]?pl|\bpl\b)\b/.test(t)) add("PL");
  if (/\b(?:l[-\s]?mount|leica[-\s]?l)\b/.test(t)) add("L");
  if (/\b(?:mft|m4\/3|micro[-\s]?four)\b/.test(t)) add("MFT");
  if (/\b(?:x[-\s]?mount|fuji[-\s]?x|\bxf\b)\b/.test(t)) add("X");
  // bare single-letter tokens "e"/"l"/"x"/"pl"/"ef"/"rf" ONLY when they sit
  // inside a clearly-delimited mount list (joined by / , | ), so prose words
  // and Canon "L series" cannot leak in.
  for (const frag of t.match(/(?:\b(?:pl|ef|rf|e|l|x)\b[ ]*[\/,|][ ]*){1,}\b(?:pl|ef|rf|e|l|x)\b/g) || []) {
    for (const p of frag.split(/[\/,|]+/).map((s) => s.trim())) {
      if (p === "e") add("E");
      else if (p === "ef") add("EF");
      else if (p === "rf") add("RF");
      else if (p === "pl") add("PL");
      else if (p === "l") add("L");
      else if (p === "x") add("X");
    }
  }
  if (set.size < 2) return null;
  return MOUNT_ORDER.filter((x) => set.has(x)).join("/");
}

export function mountOf(title: string): string | null {
  // "Cannon" is a ubiquitous misspelling of Canon — alias it before matching.
  const t = title.toLowerCase().replace(/\bcannon\b/g, "canon");
  const any = (...k: string[]) => k.some((x) => t.includes(x));
  // Explicit compound mount string wins (cine glass listing several mounts).
  const compound = explicitCompoundMount(t);
  if (compound) return compound;
  if (any("gopro", "go pro", "hero 1", "hero 9", "hero 8", "osmo action", "osmo pocket", "dji pocket", "insta360", "insta 360", "action 4", "action 5", "action4", "action5", "pocket 3")) return "fixed";
  if (any("mft", "m4/3", "micro four", "gh5", "gh6", "gh7", "bmpcc 4k", "pocket 4k")) return "MFT";
  // NOTE: do NOT blanket-assume a mount for cine/anamorphic brands (DZO Vespid, Blazar,
  // Great Joy, Meike…). They are PL-native unless their title explicitly lists other mounts
  // — an earlier "interchangeable E/EF/PL/L/RF" guess wrongly made native-PL display glass
  // read as native-E on a Sony body. Truth comes from the title: an explicit compound
  // ("pl/ef/e/l mount") is parsed above by explicitCompoundMount; an "(arri…)" / "PL" cue
  // falls to the PL rule below; anything with NO mount cue stays null (unknown), never guessed.
  if (any("komodo", "raptor")) return "RF";
  // Canon RF-mount cinema bodies (C70 / C400 / R5C) — must precede the EF C-series check.
  if (any("c70", "c-70", "c 70", "c400", "c-400", "r5c", "r5 c")) return "RF";
  if (any(" rf", "rf ", "r5", "r6", "r3", "r8", "canon r")) return "RF";
  if (any("pl mount", " pl ", "arri", "alexa", "amira")) return "PL";
  if (any("bmpcc", "pocket cinema", "6k pro", "6k g2")) return "EF";
  // Canon EF-mount cinema bodies (C100/C200/C300/C500 ship EF).
  if (any("c100", "c200", "c300", "c500")) return "EF";
  if (any(" ef", "ef ", "ef-", "canon ef")) return "EF";
  // Sony E family — note "venice" (Sony Venice is E-mount via the LPL/E adapter
  // ecosystem; treated as E for ranking) was previously missing → null mounts.
  if (any("sony", "fx3", "fx6", "fx9", "fx30", "a7", "a1", "a9", "burano", "venice", " fe ", "gm", "g master", "e-mount", "emount", "sigma e", "tamron e")) return "E";
  // Canon-branded glass with no explicit mount cue → EF (the rental workhorse). Placed
  // AFTER the E/Sony cue so a "Sony E-Mount" lens that merely *mentions* Canon isn't stolen;
  // a genuine "Canon 24-70" (no Sony/EF token) lands here → NATIVE on EF bodies (BMPCC 6K, C-series).
  if (any("canon")) return "EF";
  // Third-party cine / anamorphic glass with NO explicit mount cue defaults to PL — its
  // native cinema mount (confirmed by the shop: these are native-PL lenses). This is a
  // last-resort default AFTER every explicit cue (compound, arri, E/EF/RF) above, so a
  // lens that names its real mount is never overridden. PL → adapter on E bodies (correct),
  // never a false "native E". Genuinely interchangeable sets list their mounts → caught above.
  if (any("anamorphic", "cine lens", "cinema lens", "dzo", "dzofilm", "vespid", "blazar", "great joy", "greatjoy", "catta", "arles", "sirui", "cooke", "laowa")) return "PL";
  return null;
}

export function deriveSpecs(title: string, itemType: ItemType): Specs {
  const t = title.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  const mount = itemType === "camera-body" || itemType === "lens" ? mountOf(title) : null;

  let filterThreadMm: number | null = null;
  if (itemType === "nd-filter") {
    const m = t.match(/(\d{2})\s?(?:mm|and|\/)/);
    if (m) filterThreadMm = +m[1];
  } else if (itemType === "lens") {
    const ex = t.match(/(\d{2,3})\s?mm\s?(?:filter|thread|front)/);
    if (ex) filterThreadMm = +ex[1];
    else if (has(/g master|gm\b|24-70.*2\.8|16-35.*2\.8/)) filterThreadMm = 82;
    else if (has(/24-105/)) filterThreadMm = 77;
    else if (has(/70-200/)) filterThreadMm = 77;
    else if (has(/28-70/)) filterThreadMm = 67;
    else if (has(/16-35(?!.*(gm|g master))/)) filterThreadMm = 72;
    else if (has(/85mm|50mm|35mm/)) filterThreadMm = 67;
  }

  let batteryType: string | null = null;
  if (itemType === "camera-body") {
    // NOTE: tolerate a SPACE ("fx 6") — without it an FX6 fell through to NP-FZ100 and V-mount
    // batteries (which DO power it) looked incompatible. Cine/large-sensor bodies are V-mount.
    if (has(/fx ?6|fx ?9|c ?300|c ?500|alexa|amira|ursa|komodo|raptor|burano|venice/)) batteryType = "V-mount";
    else if (has(/gopro|go ?pro|osmo ?action|insta ?360/)) batteryType = "action";
    else if (has(/sony|fx ?3|fx ?30|\ba7|\ba1\b|\ba9\b|zv-?e/)) batteryType = "NP-FZ100";
    else if (has(/canon r|\br5\b|\br6\b|\br3\b|\br8\b|c ?70/)) batteryType = "LP-E6";
    else if (has(/bmpcc|pocket cinema/)) batteryType = "NP-F/LP-E6";
    else if (has(/gh5|gh6|gh7|s1h|s5|lumix/)) batteryType = "DMW-BLK22";
  } else if (itemType === "battery") {
    // NOTE: tokens must tolerate a SPACE ("v mount", "np 970") — the old `v-?mount` /
    // `np-?970` only matched the hyphen/no-gap forms, so most batteries derived as null.
    if (has(/np[-\s]?fz100|fz100/)) batteryType = "NP-FZ100";
    else if (has(/lp[-\s]?e6|lpe6/)) batteryType = "LP-E6";
    else if (has(/v[-\s]?mount|v[-\s]?lock|gold[-\s]?mount|ab[-\s]?mount|b[-\s]?mount|anton ?bauer/)) batteryType = "V-mount";
    else if (has(/np[-\s]?f\b|npf|np[-\s]?970|np[-\s]?750/)) batteryType = "NP-F";
    // pure power stations (no V-mount/D-tap cue) stay null = universal/unknown — they feed any
    // rig via AC/dummy battery, so never flag them incompatible with a specific camera.
  }

  const includesLens = itemType === "camera-body" && has(/\d{2}-\d{2,3}\s?mm|\bmm lens|with lens|\+\s?[a-z0-9 ]*lens/);
  const lensFocal = (t.match(/(\d{2}-\d{2,3})\s?mm/) || [])[1] || null;
  // tier is ALWAYS persisted for lenses (premium | standard) — never null — so
  // the ranking engine's premium boost is consistent. Premium now also covers
  // real cinema glass brands previously missed (DZO/Vespid/Arles/Catta, Blazar,
  // Atlas, Sirui, Great Joy, Laowa, Sigma cine T-stop primes/zooms).
  const tier =
    itemType === "lens"
      ? has(
          /gm\b|g ?master|\bmaster\b|\bcine\b|cinema lens|cooke|anamorphic|dzo|vespid|arles|catta|blazar|atlas|sirui|great ?joy|laowa|\bt1\.\d|\bt2\.\d/,
        )
        ? "premium"
        : "standard"
      : null;

  // lens class: manual cinema glass vs autofocus stills/native glass
  let lensClass: string | null = null;
  if (itemType === "lens") {
    const cine = has(/\bcine\b|cinema lens|anamorphic|blazar|dzo|great joy|laowa|samyang|rokinon|\bpl\b|cooke|t1\.5|t2\.\d|manual focus/);
    lensClass = cine ? "cine" : "af";
  }
  // camera autofocus: mirrorless stills/hybrid bodies have strong AF; cine cameras don't
  let hasAutofocus: boolean | null = null;
  if (itemType === "camera-body") {
    if (has(/alexa|amira|\bred\b|komodo|raptor|ursa|bmpcc|pocket cinema|varicam/)) hasAutofocus = false;
    else if (has(/sony|fx3|fx30|fx6|a7|a1\b|a9\b|canon r|r5|r6|r3|r8|gh5|gh6|gh7|s5|lumix|zv-?e|gopro|osmo/)) hasAutofocus = true;
  }

  const coverage = coverageOf(title, itemType);

  return { mount, filterThreadMm, batteryType, includesLens, lensFocal, tier, lensClass, hasAutofocus, coverage };
}

// Delivery size/weight per itemType — grounded in v1 delivery-specs size_score
// system (1 XS … 5 XL). Used to pick courier vehicle + quote.
export const DELIVERY_BY_TYPE: Record<ItemType, { sizeScore: number; weightKg: number }> = {
  "nd-filter": { sizeScore: 1, weightKg: 0.1 },
  accessory: { sizeScore: 1, weightKg: 0.3 },
  headphones: { sizeScore: 1, weightKg: 0.4 },
  "wireless-mic": { sizeScore: 1, weightKg: 0.5 },
  recorder: { sizeScore: 2, weightKg: 0.6 },
  "boom-mic": { sizeScore: 2, weightKg: 1.0 },
  lens: { sizeScore: 2, weightKg: 1.0 },
  monitor: { sizeScore: 2, weightKg: 1.0 },
  drone: { sizeScore: 2, weightKg: 1.5 },
  battery: { sizeScore: 2, weightKg: 1.5 },
  "camera-body": { sizeScore: 3, weightKg: 2.0 },
  gimbal: { sizeScore: 3, weightKg: 1.5 },
  mixer: { sizeScore: 3, weightKg: 3.0 },
  tripod: { sizeScore: 3, weightKg: 3.0 },
  light: { sizeScore: 3, weightKg: 3.0 },
  slider: { sizeScore: 3, weightKg: 4.0 },
  "dj-deck": { sizeScore: 4, weightKg: 6.0 },
  speaker: { sizeScore: 4, weightKg: 8.0 },
};

// itemType -> complementary itemTypes that are commonly rented together.
export const COMPLEMENTS: Record<ItemType, ItemType[]> = {
  "camera-body": ["lens", "nd-filter", "battery", "monitor", "gimbal", "tripod", "wireless-mic"],
  lens: ["nd-filter", "camera-body", "lens"],
  "nd-filter": ["lens", "camera-body"],
  gimbal: ["camera-body", "lens", "battery"],
  tripod: ["camera-body", "lens", "monitor"],
  slider: ["camera-body", "tripod"],
  "wireless-mic": ["recorder", "camera-body", "boom-mic"],
  "boom-mic": ["wireless-mic", "recorder"],
  recorder: ["wireless-mic", "boom-mic", "headphones"],
  speaker: ["wireless-mic", "dj-deck", "mixer"],
  "dj-deck": ["speaker", "mixer", "headphones"],
  mixer: ["dj-deck", "speaker", "headphones"],
  headphones: ["recorder", "dj-deck"],
  light: ["light", "battery", "tripod"],
  monitor: ["camera-body", "battery"],
  drone: ["battery", "nd-filter"],
  battery: ["camera-body", "light"],
  accessory: ["camera-body", "lens", "light"],
};
