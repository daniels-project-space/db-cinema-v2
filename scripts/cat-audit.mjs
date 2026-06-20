// Independent second-opinion categorisation check: flag active items whose title STRONGLY
// implies a different category than the one assigned (deriveItemType's blind spots), plus dump
// the "accessory" catch-all bucket for review.
import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const c = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);

const types = ["camera-body", "lens", "nd-filter", "gimbal", "tripod", "slider", "monitor", "light", "battery", "wireless-mic", "boom-mic", "recorder", "drone", "speaker", "mixer", "dj-deck", "accessory"];
const all = [];
for (const t of types) { const r = await c.query("catalog:byItemType", { types: [t] }).catch(() => []); r.forEach((x) => all.push(x)); }

// strong, high-precision signals (independent of deriveItemType ordering)
const STRONG = [
  ["gimbal", /\b(ronin|\brs ?[234]\b|rsc|crane|zhiyun|moza|gimbal|stabili[sz]er)\b/i],
  ["drone", /\b(drone|mavic|\bfpv\b|avata|inspire|mini ?[34]|air ?[23])\b/i],
  ["lens", /\b(\d{2,3}-\d{2,3} ?mm|\d{2,3} ?mm f\d|prime lens|zoom lens|anamorphic|g master|gmaster|\bgm\b lens)\b/i],
  ["light", /\b(aputure|nanlite|godox|amaran|forza|pavotube|astera|titan tube|led panel|softbox|hmi|fresnel|sky ?panel|600d|300d|300x|600x)\b/i],
  ["monitor", /\b(atomos|ninja v|shinobi|smallhd|feelworld|field monitor|shogun)\b/i],
  ["battery", /\b(v-?mount|v-?lock|np-?f\b|np-?fz100|npf|lp-?e6|d-?tap|power station|ecoflow)\b/i],
  ["wireless-mic", /\b(wireless go|dji mic|rode wireless|lavalier|\blav\b)\b/i],
  ["boom-mic", /\b(shotgun|boom mic|ntg|mkh|sennheiser mke|deity)\b/i],
  ["tripod", /\b(tripod|fluid head|monopod|c-?stand|light stand)\b/i],
  ["camera-body", /\b(fx3|fx6|a7s|a7 ?iii|komodo|bmpcc|cinema camera|mirrorless camera)\b/i],
];
const camModelish = /\b(camera|fx|a7|komodo|bmpcc|gopro|osmo)\b/i;

const flags = [];
for (const x of all) {
  const t = x.title || "";
  for (const [cat, re] of STRONG) {
    if (x.itemType !== cat && re.test(t)) {
      // avoid false flags: a camera BUNDLE legitimately contains a lens/light keyword
      if (x.itemType === "camera-body" && cat !== "camera-body") continue;
      // a bundle with a camera shouldn't be reclassified to an accessory part
      if (cat !== "camera-body" && camModelish.test(t) && /\+|\bset\b|kit|bundle/i.test(t)) continue;
      flags.push(`[${x.itemType} -> ${cat}?] ${t.slice(0, 60)}`);
      break;
    }
  }
}
console.log("active items:", all.length);
console.log("\n=== likely MISCATEGORISED (" + flags.length + ") ===");
flags.slice(0, 50).forEach((f) => console.log("  " + f));

const acc = all.filter((x) => x.itemType === "accessory");
console.log("\n=== 'accessory' catch-all bucket (" + acc.length + ") ===");
acc.forEach((x) => console.log("  " + (x.title || "").slice(0, 64)));
