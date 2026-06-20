// Quantify: of the RMv2 products (incl. isMarketingOnly), how many reference gear the shop
// ACTUALLY OWNS (items:listForReconcile) vs phantom cameras it doesn't.
const Q = async (p, a) => {
  const r = await fetch("https://hearty-oyster-600.convex.cloud/api/query", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: p, args: a, format: "json" }),
  });
  return (await r.json()).value;
};

// recognise a camera MODEL token (owned + known-phantom), disambiguating look-alikes
const camModel = (s) => {
  let t = " " + String(s || "").toLowerCase().replace(/cannon/g, "canon") + " ";
  t = t.replace(/[^a-z0-9]+/g, " ");
  if (/\bvenice\b/.test(t)) return "venice";
  if (/\balexa\b|\bamira\b/.test(t)) return "alexa";
  if (/\bfx ?30\b/.test(t)) return "fx30";
  if (/\bfx ?3\b/.test(t)) return "fx3";
  if (/\bfx ?6\b/.test(t)) return "fx6";
  if (/\bfx ?9\b/.test(t)) return "fx9";
  if (/\ba7s ?(iii|3)\b/.test(t)) return "a7siii";
  if (/\ba7s ?(ii|2)\b/.test(t)) return "a7sii";
  if (/\ba7r\b|\ba7 ?r\b/.test(t)) return "a7r";
  if (/\ba7 ?(iv|4)\b/.test(t)) return "a7iv";
  if (/\ba7 ?(iii|3)\b/.test(t)) return "a7iii";
  if (/\ba7 ?(v|5)\b/.test(t)) return "a7v";
  if (/\ba7 ?(ii|2)\b/.test(t)) return "a7ii";
  if (/\ba6\d00\b/.test(t)) return "a6x00";
  if (/\ba1\b/.test(t)) return "a1";
  if (/\bbmpcc ?4k\b|pocket ?4k|6k ?(?!pro|g2)/.test(t) && /4k/.test(t)) return "bmpcc4k";
  if (/\bbmpcc\b|pocket cinema|6k ?pro|6k ?g2/.test(t)) return "bmpcc";
  if (/\bc ?70\b/.test(t)) return "c70";
  if (/\bc ?(100|200|300|500)\b/.test(t)) return "c-cine";
  if (/\br5c\b/.test(t)) return "r5c";
  if (/\br ?5\b/.test(t)) return "r5";
  if (/\br ?6\b/.test(t)) return "r6";
  if (/komodo/.test(t)) return "komodo";
  if (/raptor|\bred ?(helium|gemini|monstro|raven)/.test(t)) return "red-other";
  if (/\bs5\b|s1h|\bgh ?[567]\b|lumix/.test(t)) return "panasonic";
  if (/x100|\bx-?t\d|fuji/.test(t)) return "fuji";
  if (/ronin 4d/.test(t)) return "ronin4d";
  if (/osmo|gopro|hero|insta ?360|action/.test(t)) return "actioncam";
  if (/mavic ?4|air ?4/.test(t)) return "drone-new";
  if (/inspire|mavic|air ?3|mini ?4|avata|\bfpv\b|\bneo\b/.test(t)) return "drone";
  return null; // not a camera (lens/light/battery/etc.) — treated as real
};

const items = await Q("items:listForReconcile", {});
const owned = new Set();
for (const i of items) { const m = camModel(i.name); if (m) owned.add(m); }
console.log("OWNED camera models:", [...owned].sort().join(", "));

const src = await Q("hygglo_products:list", { accountSlug: "dbcinema" });
const hasPrice = (p) => { const pr = p.prices; return pr && Array.isArray(pr) && pr.some((x) => (x.pricePerDay ?? x.price ?? 0) > 0); };
const candidates = src.filter((p) => p.name && hasPrice(p)); // ignore the mkt flag

let realCam = 0, phantomCam = 0, nonCam = 0;
const phantoms = {};
for (const p of candidates) {
  const m = camModel(p.name);
  if (!m) { nonCam++; continue; }
  if (owned.has(m)) realCam++;
  else { phantomCam++; phantoms[m] = (phantoms[m] || 0) + 1; }
}
console.log("\ncandidates (named+priced):", candidates.length);
console.log("  real-camera products:", realCam, "| phantom-camera products:", phantomCam, "| non-camera (real):", nonCam);
console.log("  => would SHOW (real cam + non-cam):", realCam + nonCam, "| HIDE (phantom):", phantomCam);
console.log("phantom breakdown:", JSON.stringify(phantoms));
const curMkt = src.filter((p) => p.isMarketingOnly).length;
console.log("\nvs current: site shows ~205 (filter drops all", curMkt, "isMarketingOnly). New approach reclaims the real ones.");
