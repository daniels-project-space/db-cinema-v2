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

// Ordered. Camera bodies are matched FIRST so camera kits that also mention an
// accessory ("BMPCC + tripod") classify as the camera (the hero), not the
// accessory. Standalone accessories (no camera token) fall through to their type.
const RULES: [ItemType, RegExp][] = [
  ["camera-body", /\b(camera|bmpcc|fx3|fx6|fx30|fx9|a7|a7s|a7r|a7c|a7iii|a73|a7iv|a6\d00|alexa|\bred\b|ursa|c70|c300|c200|c500|komodo|raptor|gh5|gh6|gh7|s1h|s5|pocket cinema|z ?cam|zv-?e|lumix|eos ?r|\br5\b|\br6\b)\b/i],
  ["lens", /\b(lens|lenses|24-70|70-200|16-35|24-105|50mm|35mm|85mm|24mm|sigma|samyang|prime|zoom lens|cine lens|anamorphic|dzo|laowa|f1\.[248]|f2\.8)\b/i],
  ["nd-filter", /\b(nd[\s-]?filter|variable nd|vnd|cpl|polari[sz]|filter kit|nd ?kit)\b/i],
  ["gimbal", /\b(gimbal|ronin|rs ?\d|rsc|crane|zhiyun|moza|stabili[sz]er)\b/i],
  ["slider", /\b(slider|dolly|track)\b/i],
  ["tripod", /\b(tripod|fluid head|monopod|\blegs\b|sticks)\b/i],
  ["dj-deck", /\b(\bdj\b|cdj|ddj|xdj|pioneer|turntable|rekordbox|serato)\b/i],
  ["mixer", /\b(mixer|mixing desk|djm)\b/i],
  ["speaker", /\b(speaker|partybox|\bjbl\b|\bpa\b|sub ?woofer|sound ?system)\b/i],
  ["wireless-mic", /\b(wireless mic|wireless go|dji mic|rode wireless|lav|lavalier|sennheiser ew|handheld mic|radio mic)\b/i],
  ["boom-mic", /\b(boom|shotgun|ntg|mkh|boom pole|hypercardioid)\b/i],
  ["recorder", /\b(recorder|zoom h\d|tascam|mixpre|field recorder)\b/i],
  ["headphones", /\b(headphone|headphones)\b/i],
  ["drone", /\b(drone|mavic|fpv|avata)\b/i],
  ["monitor", /\b(monitor|atomos|ninja|shinobi|smallhd|feelworld)\b/i],
  ["light", /\b(light|aputure|godox|nanlite|amaran|led|softbox|hmi|fresnel|forza|lantern)\b/i],
  ["battery", /\b(battery|batteries|v-?mount|v-?lock|charger|np-?f|d-?tap|power station|anker)\b/i],
];

export function deriveItemType(name: string): ItemType {
  for (const [t, re] of RULES) if (re.test(name)) return t;
  return "accessory";
}

// Delivery size/weight per itemType — grounded in v1 delivery-specs size_score
// system (1 XS … 5 XL). Used to pick courier vehicle + quote. Covers every
// listing since each has an itemType.
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
