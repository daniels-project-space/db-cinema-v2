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

// Safety net: strip any price/taste/hype language that slips past the prompt, so a
// catalogue card can never say "expensive" (or similar). Facts only.
const BANNED = /\b(expensive|inexpensive|cheap(?:er|ly)?|pricey|priced|premium|high[-\s]?end|low[-\s]?end|top[-\s]?of[-\s]?the[-\s]?line|budget|affordable|luxur(?:y|ious)|stunning|gorgeous|beautiful|buttery|flawless|best[-\s]?in[-\s]?class|game[-\s]?changer|bargain|cost[-\s]?effective)\b/gi;
const PHRASES = [/\breads as\b/gi, /\bpunches above[^.,;]*/gi, /\bvalue for money\b/gi, /\bfor the price\b/gi, /\bbang for[^.,;]*/gi, /\bworth (?:every|the)[^.,;]*/gi];
function clean(s) {
  if (typeof s !== "string") return s;
  let x = s;
  for (const p of PHRASES) x = x.replace(p, " ");
  x = x.replace(BANNED, " ");
  return x.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").replace(/^[\s,;.:-]+/, "").trim();
}
const cleanArr = (a) => (Array.isArray(a) ? a.map(clean).filter(Boolean) : []);

const KEY = (await cq(VAULT, "secrets:getOne", { service: "openrouter", keyName: "OPENROUTER_API_KEY" })).value;
const items = await cq(CONVEX, "catalog:allBasic", {});
console.log("listings:", items.length);

const BATCH = 16;
let total = 0, fails = 0;
for (let b = 0; b < items.length; b += BATCH) {
  const chunk = items.slice(b, b + BATCH);
  const list = chunk.map((it, i) => `${i}: ${it.title}`).join("\n");
  const prompt = `You are a senior cinema-rental gear expert writing FACTUAL catalogue copy. For EACH listing give a concise, ACCURATE, NEUTRAL professional knowledge profile (real product knowledge — for bundles describe the kit). Reply ONLY JSON {"items":[{...}]}, one object per index.
TONE RULES (strict): write like a working DP describing specs and real use — facts, not opinions. NO marketing, hype or taste words. NEVER use: expensive, cheap, pricey, premium, high-end, low-end, budget, affordable, luxury, stunning, gorgeous, beautiful, buttery, flawless, "cinematic look", "reads as", "punches above", "value for money", "for the price", "best-in-class", "game-changer". Do NOT mention or imply price, cost or value. State what it IS and what it DOES.
Fields per item: i (index), summary (one tight FACTUAL sentence: what it is + its key technical capability, e.g. "Full-frame 6K cinema camera with dual-gain output and an EF lens mount"), features (3-5 concrete specs, e.g. "6K open gate","dual native ISO 800/3200","13 stops DR","internal ND"), limits (2-4 REAL limitations a renter must know, e.g. "no internal ND","CFexpress Type B only","rolling shutter","2.5kg gimbal payload","manual focus only"), bestFor (2-3 use cases, e.g. "documentary","music video","studio interview"), tips (1-2 practical shooting/rental tips), pairsWith (2-4 complementary gear it genuinely needs, specific where possible e.g. "V-mount battery + plate","82mm variable ND","EF cine primes","C-stand").
Be truthful to the actual product; if unsure of an exact spec, give the well-known one or omit it rather than invent. Keep each string short. No adjectives of taste or price.
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
    return { id: it._id, knowledge: { summary: clean(o.summary || ""), features: cleanArr(o.features), limits: cleanArr(o.limits), bestFor: cleanArr(o.bestFor), tips: cleanArr(o.tips), pairsWith: Array.isArray(o.pairsWith) ? o.pairsWith : [] } };
  }).filter(Boolean);
  const res = await cm("sync:applyKnowledge", { token: ADMIN, items: out });
  total += out.length;
  console.log(`batch ${b}-${b + chunk.length}: ${out.length} -> ${res.status}`);
}
console.log("DONE knowledge:", total, "failed:", fails);
