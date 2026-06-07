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

// Ordered, first match wins. Drone is matched FIRST so a "Mavic + ND filters"
// bundle classifies as a drone (not an ND filter). Camera bodies next so camera
// kits that also mention an accessory classify as the camera (the hero).
const RULES: [ItemType, RegExp][] = [
  ["drone", /\b(drone|mavic|\bfpv\b|avata|air ?[23]|mini ?[34]|inspire|neo)\b/i],
  ["camera-body", /\b(camera|bmpcc|fx3|fx6|fx30|fx9|a7|a7s|a7r|a7c|a7iii|a73|a7iv|a6\d00|a1\b|a9\b|burano|alexa|\bred\b|ursa|c70|c300|c200|c500|c400|komodo|raptor|gh5|gh6|gh7|s1h|s5|pocket cinema|z ?cam|zv-?e|lumix|eos ?r|\br5\b|\br6\b|\br3\b|\br8\b)\b/i],
  ["lens", /\b(lens|lenses|\d{2}-\d{2,3}mm|\d{2,3}-\d{2,3}|50mm|35mm|85mm|24mm|28mm|14mm|16mm|135mm|gm\b|g ?master|ultra ?wide|wide ?angle|telephoto|sigma|samyang|tamron|rokinon|\bfe\b|prime|zoom lens|cine lens|anamorphic|blazar|dzo|laowa|cooke|f1\.[248]|f2\.8|t1\.5|t2\.\d)\b/i],
  // matte boxes + atmosphere machines are accessories, not ND/monitor/light
  ["accessory", /\b(matte ?box|mattebox|french flag|follow ?focus|cage rig|haze|hazer|smoke machine|fog machine)\b/i],
  ["nd-filter", /\b(nd[\s-]?filter|variable nd|vnd|cpl|polari[sz]|filter kit|nd ?kit|nd ?set)\b/i],
  ["gimbal", /\b(gimbal|ronin|rs ?\d|rsc|crane|zhiyun|moza|stabili[sz]er)\b/i],
  ["slider", /\b(slider|dolly|track)\b/i],
  ["tripod", /\b(tripod|fluid head|monopod|\blegs\b|sticks)\b/i],
  ["dj-deck", /\b(\bdj\b|cdj|ddj|xdj|pioneer|turntable|rekordbox|serato)\b/i],
  ["mixer", /\b(mixer|mixing desk|djm)\b/i],
  ["speaker", /\b(speaker|partybox|\bjbl\b|\bpa\b|sub ?woofer|sound ?system)\b/i],
  ["wireless-mic", /\b(wireless mic|wireless go|dji mic|rode wireless|lav|lavalier|sennheiser ew|handheld mic|radio mic)\b/i],
  ["boom-mic", /\b(boom|shotgun|ntg|mkh|boom pole|hypercardioid|deity)\b/i],
  ["recorder", /\b(recorder|zoom h\d|tascam|mixpre|field recorder)\b/i],
  ["headphones", /\b(headphone|headphones)\b/i],
  ["monitor", /\b(monitor|atomos|ninja v|shinobi|smallhd|feelworld|field monitor|on-?camera monitor)\b/i],
  ["light", /\b(light|aputure|godox|nanlite|amaran|forza|led|softbox|hmi|fresnel|lantern|pavotube|tube light|rgb|astera|titan tube|key ?light|panel|sky ?panel|cob|300d|600d|1200d|montura)\b/i],
  ["battery", /\b(battery|batteries|v-?mount|v-?lock|charger|np-?f|d-?tap|power station|anker)\b/i],
];

export function deriveItemType(name: string): ItemType {
  for (const [t, re] of RULES) if (re.test(name)) return t;
  return "accessory";
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
};

export function mountOf(title: string): string | null {
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
    if (has(/fx6|fx9|c300|c500|alexa|amira|ursa|komodo|raptor|burano/)) batteryType = "V-mount";
    else if (has(/gopro|osmo action|insta360/)) batteryType = "action";
    else if (has(/sony|fx3|fx30|a7|a1\b|a9\b|zv-?e/)) batteryType = "NP-FZ100";
    else if (has(/canon r|r5|r6|r3|r8|c70/)) batteryType = "LP-E6";
    else if (has(/bmpcc|pocket cinema/)) batteryType = "NP-F/LP-E6";
    else if (has(/gh5|gh6|gh7|s1h|s5|lumix/)) batteryType = "DMW-BLK22";
  } else if (itemType === "battery") {
    if (has(/np-?fz100|fz100/)) batteryType = "NP-FZ100";
    else if (has(/lp-?e6|lpe6/)) batteryType = "LP-E6";
    else if (has(/v-?mount|v-?lock/)) batteryType = "V-mount";
    else if (has(/np-?f\b|npf|np-?970|np-?750/)) batteryType = "NP-F";
  }

  const includesLens = itemType === "camera-body" && has(/\d{2}-\d{2,3}\s?mm|\bmm lens|with lens|\+\s?[a-z0-9 ]*lens/);
  const lensFocal = (t.match(/(\d{2}-\d{2,3})\s?mm/) || [])[1] || null;
  const tier = itemType === "lens" ? (has(/gm\b|g master|master|cine|cooke|anamorphic/) ? "premium" : "standard") : null;

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

  return { mount, filterThreadMm, batteryType, includesLens, lensFocal, tier, lensClass, hasAutofocus };
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
