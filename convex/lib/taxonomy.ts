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

// Ordered specific-first; first match wins.
const RULES: [ItemType, RegExp][] = [
  ["nd-filter", /\b(nd[\s-]?filter|variable nd|vnd|cpl|polari[sz]|filter kit|nd ?kit)\b/i],
  ["gimbal", /\b(gimbal|ronin|rs ?\d|rsc|crane|zhiyun|moza|stabili[sz]er)\b/i],
  ["slider", /\b(slider|dolly|track)\b/i],
  ["tripod", /\b(tripod|fluid head|monopod|legs|sticks)\b/i],
  ["dj-deck", /\b(\bdj\b|cdj|ddj|xdj|pioneer|turntable|controller|rekordbox|serato)\b/i],
  ["mixer", /\b(mixer|mixing desk|djm)\b/i],
  ["speaker", /\b(speaker|partybox|\bjbl\b|\bpa\b|sub ?woofer|sound ?system|monitor speaker)\b/i],
  ["wireless-mic", /\b(wireless mic|wireless go|dji mic|rode wireless|lav|lavalier|sennheiser ew|handheld mic|radio mic)\b/i],
  ["boom-mic", /\b(boom|shotgun|ntg|mkh|boom pole|hypercardioid)\b/i],
  ["recorder", /\b(recorder|zoom h\d|tascam|mixpre|field recorder)\b/i],
  ["headphones", /\b(headphone|headphones|cans|monitoring)\b/i],
  ["drone", /\b(drone|mavic|mini ?\d|fpv|avata|air ?\d)\b/i],
  ["monitor", /\b(monitor|atomos|ninja|shinobi|smallhd|director|feelworld)\b/i],
  ["light", /\b(light|aputure|godox|nanlite|amaran|led|softbox|hmi|fresnel|forza|lantern|rgb)\b/i],
  ["battery", /\b(battery|batteries|v-?mount|v-?lock|charger|np-?f|d-?tap|power station|anker)\b/i],
  ["camera-body", /\b(camera|bmpcc|fx3|fx6|fx30|a7|a7s|a7iv|alexa|\bred\b|ursa|c70|c300|c200|komodo|gh5|gh6|gh7|pocket cinema|z ?cam|s1h|zv-?e|a6\d00)\b/i],
  ["lens", /\b(lens|lenses|24-70|70-200|16-35|24-105|50mm|35mm|85mm|24mm|sigma|samyang|prime|zoom lens|cine lens|dzo|laowa|f1\.[248]|f2\.8)\b/i],
];

export function deriveItemType(name: string): ItemType {
  for (const [t, re] of RULES) if (re.test(name)) return t;
  return "accessory";
}

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
