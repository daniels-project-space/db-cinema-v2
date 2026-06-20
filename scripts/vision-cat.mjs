// Vision categorisation pass: show each item's IMAGE + title to a vision model and compare its
// verdict to the stored itemType. Reports mismatches (does NOT write). Run with apply=1 env to
// write high-confidence corrections via sync:setItemTypes.
import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
const vault = new ConvexHttpClient("https://fantastic-roadrunner-485.convex.cloud");
const ork = await vault.query("secrets:getOne", { service: "openrouter", keyName: "OPENROUTER_API_KEY" });
const KEY = ork.value || ork.secret || ork.key;
const c = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);

const CATS = ["camera-body", "lens", "nd-filter", "gimbal", "tripod", "slider", "monitor", "light", "battery", "wireless-mic", "boom-mic", "recorder", "headphones", "drone", "speaker", "mixer", "dj-deck", "accessory"];
const all = [];
for (const t of CATS) {
  const r = await c.query("catalog:byItemType", { types: [t] }).catch(() => []);
  r.forEach((x) => all.push({ id: x._id, title: x.title, itemType: x.itemType, image: x.heroImage }));
}
const withImg = all.filter((x) => x.image);
console.log(`items: ${all.length} | with image: ${withImg.length}`);

async function classify(it) {
  const prompt = `You categorise camera-rental gear. Look at the IMAGE and the title, and pick the ONE category for the PRIMARY/hero product (a bundle is named by its main item — e.g. a camera kit with a tripod is "camera-body"). Title: "${it.title}". Categories: ${CATS.join(", ")}. Reply with ONLY the exact category word.`;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: "Bearer " + KEY, "content-type": "application/json" },
      body: JSON.stringify({ model: "openai/gpt-4o-mini", max_tokens: 8, temperature: 0,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: it.image } }] }] }),
    });
    const j = await r.json();
    const cat = (j.choices?.[0]?.message?.content || "").trim().toLowerCase().replace(/[^a-z-]/g, "");
    return CATS.includes(cat) ? cat : null;
  } catch { return null; }
}

// concurrency 6
const mism = [];
let done = 0;
const queue = [...withImg];
async function worker() {
  while (queue.length) {
    const it = queue.shift();
    const v = await classify(it);
    done++;
    if (v && v !== it.itemType) mism.push({ ...it, vision: v });
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`classified ${done}, mismatches: ${mism.length}\n`);
mism.sort((a, b) => a.itemType.localeCompare(b.itemType)).forEach((m) => console.log(`  [${m.itemType} -> ${m.vision}] ${m.title.slice(0, 56)}`));

if (process.env.apply === "1" && mism.length) {
  // only apply clear, safe flips (not into the vague 'accessory', and not bundles the vision likely misread)
  const safe = mism.filter((m) => m.vision !== "accessory" && !/\+|\bset\b|\bkit\b|bundle/i.test(m.title));
  console.log(`\napplying ${safe.length} safe corrections...`);
  const r = await c.mutation("sync:setItemTypes", { updates: safe.map((m) => ({ id: m.id, itemType: m.vision })) });
  console.log("applied:", JSON.stringify(r));
}
