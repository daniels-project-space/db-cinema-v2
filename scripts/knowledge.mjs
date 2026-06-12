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

const BATCH = 16;
let total = 0, fails = 0;
for (let b = 0; b < items.length; b += BATCH) {
  const chunk = items.slice(b, b + BATCH);
  const list = chunk.map((it, i) => `${i}: ${it.title}`).join("\n");
  const prompt = `You are a senior cinema-rental gear expert. For EACH listing, give a concise, ACCURATE professional knowledge profile (real product knowledge — for bundles describe the kit). Reply ONLY JSON {"items":[{...}]}, one object per index.
Fields per item: i (index), summary (one tight sentence: what it is + its standout strength), features (3-5 concrete capabilities/specs, e.g. "4K 120fps","dual base ISO 800/12800","S-Cinetone"), limits (2-4 REAL limitations/gotchas a renter must know, e.g. "no internal ND","records to CFexpress Type A only","rolling shutter","3.2kg gimbal payload","manual focus only"), bestFor (2-3 use cases), tips (1-2 practical shooting/rental tips), pairsWith (2-4 complementary gear it genuinely needs, specific where possible e.g. "NP-FZ100 spares","82mm ND filter","E-mount lenses","C-stand").
Be truthful to the actual product; if unsure of an exact spec, give the well-known one or omit it rather than invent. Keep each string short.
Listings:
${list}`;
  let parsed = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "deepseek/deepseek-chat", messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0.2 }),
      });
      const j = await r.json();
      parsed = JSON.parse(j.choices[0].message.content);
    } catch (e) { /* retry */ }
  }
  if (!parsed) { fails += chunk.length; console.log(`batch ${b}: FAILED`); continue; }
  const out = (parsed.items || []).map((o) => {
    const it = chunk[o.i]; if (!it) return null;
    return { id: it._id, knowledge: { summary: o.summary || "", features: o.features || [], limits: o.limits || [], bestFor: o.bestFor || [], tips: o.tips || [], pairsWith: o.pairsWith || [] } };
  }).filter(Boolean);
  const res = await cm("sync:applyKnowledge", { token: ADMIN, items: out });
  total += out.length;
  console.log(`batch ${b}-${b + chunk.length}: ${out.length} -> ${res.status}`);
}
console.log("DONE knowledge:", total, "failed:", fails);
