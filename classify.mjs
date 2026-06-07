const CONVEX = "https://veracious-wombat-196.convex.cloud";
const VAULT = "https://fantastic-roadrunner-485.convex.cloud";
const ADMIN = process.argv[2];

async function cq(base, path, args) {
  const r = await fetch(base + "/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, args, format: "json" }) });
  return (await r.json()).value;
}
async function cm(path, args) {
  const r = await fetch(CONVEX + "/api/mutation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, args, format: "json" }) });
  return await r.json();
}
const KEY = (await cq(VAULT, "secrets:getOne", { service: "openrouter", keyName: "OPENROUTER_API_KEY" })).value;
const items = await cq(CONVEX, "catalog:allBasic", {});
console.log("listings:", items.length);

const TYPES = "camera-body, lens, light, nd-filter, gimbal, tripod, slider, wireless-mic, boom-mic, recorder, monitor, speaker, dj-deck, mixer, headphones, drone, battery, projector, teleprompter, accessory";
const CATS = "Cameras, Lenses, Lighting, Audio, Monitors, Stabilizers, Grip, Power, Drones, Projectors, Teleprompters, Packages, Accessories";
const KEEP = ["mount", "filterThreadMm", "batteryType", "includesLens", "lensFocal", "tier", "lensClass", "hasAutofocus"];
const specsFrom = (o) => { const s = {}; for (const k of KEEP) if (o[k] !== undefined && o[k] !== null) s[k] = o[k]; return s; };

const BATCH = 25;
let total = 0, fails = 0;
for (let b = 0; b < items.length; b += BATCH) {
  const chunk = items.slice(b, b + BATCH);
  const list = chunk.map((it, i) => `${i}: ${it.title}`).join("\n");
  const prompt = `You classify cinema-gear rental listings. Reply ONLY with JSON {"items":[...]}, one object per listing index.
Fields: i (index), itemType (one of: ${TYPES}), category (one of: ${CATS}), isPackage (true ONLY if the listing bundles MULTIPLE DISTINCT gear types e.g. "camera + lens + batteries"; FALSE for a single item or a multipack of the same thing like "2x light"), mount (E|RF|EF|PL|MFT|fixed|null — cameras & lenses), lensClass (af|cine|null — lenses), batteryType (NP-FZ100|LP-E6|V-mount|NP-F|action|null — cameras & batteries), filterThreadMm (number|null — lenses & nd filters), includesLens (bool — does a camera bundle include a lens), tier (premium|standard|null — lenses), hasAutofocus (bool|null — cameras).
Hard rules: GoPro / DJI Osmo Action / Insta360 = itemType camera-body, mount "fixed" (NOT audio). Teleprompter = itemType teleprompter, category Teleprompters, isPackage false. Projector = itemType projector, category Projectors (NOT battery/power). Lav / wireless mics = itemType wireless-mic; shotgun / boom mics = itemType boom-mic; both category Audio. Sony GM / G / FE / E-mount lenses = mount E, lensClass af, tier premium. Canon RF = RF. Lenses with EF = EF. Anamorphic / cine primes / PL = lensClass cine. ALL cameras use itemType "camera-body" (never "camera"). A camera body sold WITH a lens or extras (title has "+ NN-NNmm", "+ lens", "set", "kit", "bundle") => isPackage true, includesLens true, AND category "Packages" (not Cameras). A standalone camera body => category Cameras.
Listings:
${list}`;
  let parsed = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "deepseek/deepseek-chat", messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0 }),
      });
      const j = await r.json();
      parsed = JSON.parse(j.choices[0].message.content);
    } catch (e) { /* retry */ }
  }
  if (!parsed) { fails += chunk.length; console.log(`batch ${b}: FAILED`); continue; }
  const out = (parsed.items || []).map((o) => {
    const it = chunk[o.i]; if (!it) return null;
    return { id: it._id, itemType: o.itemType || "accessory", category: o.category || "Accessories", isPackage: !!o.isPackage, specs: specsFrom(o) };
  }).filter(Boolean);
  const res = await cm("sync:applyClassification", { token: ADMIN, items: out });
  total += out.length;
  console.log(`batch ${b}-${b + chunk.length}: ${out.length} -> ${res.status}`);
}
console.log("DONE classified:", total, "failed:", fails);
