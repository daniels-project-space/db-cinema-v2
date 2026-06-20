/**
 * compat-truth.ts — the compatibility TRUTH harness.
 *
 *   npx tsx scripts/compat-truth.ts
 *
 * Two layers:
 *  A) SYNTHETIC — ~80 hand-verified real-world assertions against the pure engine
 *     (mount.ts matrix, taxonomy coverage/mount derivation, compat.ts kitWarnings).
 *     These are the ground-truth contract; any change that breaks one is a regression.
 *  B) LIVE CATALOGUE — pulls every real camera / lens / battery / ND from Convex,
 *     derives specs, and audits them: nulls, suspicious same-brand incompatibilities,
 *     cameras with zero compatible glass — i.e. derivation bugs in the real data.
 */
import { ConvexHttpClient } from "convex/browser";
import { mountCompat, bestCompat, parseMounts, normalizeMount } from "../src/lib/mount";
import { kitWarnings, coverageCompat } from "../src/lib/compat";
import { deriveSpecs, coverageOf, mountOf, deriveItemType } from "../convex/lib/taxonomy";
import { api } from "../convex/_generated/api";

let pass = 0, fail = 0;
const fails: string[] = [];
function eq(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; fails.push(`  ✗ ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

// ── A) SYNTHETIC TRUTH ───────────────────────────────────────────────
// 1. mount matrix — every body × every lens mount, hand-checked vs reality
eq("E body  + E lens   = native",   mountCompat("E", "E"), "native");
eq("E body  + EF lens  = adapter",  mountCompat("EF", "E"), "adapter");   // Sigma MC-11 / Metabones
eq("E body  + PL lens  = adapter",  mountCompat("PL", "E"), "adapter");   // PL→E cine adapter
eq("E body  + RF lens  = incompat", mountCompat("RF", "E"), "incompatible");
eq("E body  + MFT lens = incompat", mountCompat("MFT", "E"), "incompatible");
eq("E body  + L lens   = incompat", mountCompat("L", "E"), "incompatible");
eq("E body  + X lens   = incompat", mountCompat("X", "E"), "incompatible");
eq("RF body + RF lens  = native",   mountCompat("RF", "RF"), "native");
eq("RF body + EF lens  = adapter",  mountCompat("EF", "RF"), "adapter");  // official EF-EOS R
eq("RF body + E lens   = incompat", mountCompat("E", "RF"), "incompatible");
eq("RF body + PL lens  = incompat", mountCompat("PL", "RF"), "incompatible");
eq("EF body + EF lens  = native",   mountCompat("EF", "EF"), "native");
eq("EF body + RF lens  = incompat", mountCompat("RF", "EF"), "incompatible"); // RF can't go on a DSLR
eq("EF body + E lens   = incompat", mountCompat("E", "EF"), "incompatible");
eq("MFT body+ MFT lens = native",   mountCompat("MFT", "MFT"), "native");
eq("MFT body+ EF lens  = adapter",  mountCompat("EF", "MFT"), "adapter");
eq("MFT body+ PL lens  = adapter",  mountCompat("PL", "MFT"), "adapter");
eq("MFT body+ E lens   = incompat", mountCompat("E", "MFT"), "incompatible");
eq("L body  + L lens   = native",   mountCompat("L", "L"), "native");
eq("L body  + EF lens  = adapter",  mountCompat("EF", "L"), "adapter");
eq("L body  + PL lens  = adapter",  mountCompat("PL", "L"), "adapter");
eq("PL body + PL lens  = native",   mountCompat("PL", "PL"), "native");
eq("PL body + E lens   = incompat", mountCompat("E", "PL"), "incompatible"); // can't reach the flange
eq("PL body + EF lens  = incompat", mountCompat("EF", "PL"), "incompatible");
eq("fixed   + E lens   = incompat", mountCompat("E", "fixed"), "incompatible");
eq("fixed   + any lens = incompat", mountCompat("PL", "fixed"), "incompatible");
eq("any lens+ E body   = native",   mountCompat("any", "E"), "native");
eq("E lens  + any body  = native",  mountCompat("E", "any"), "native");

// 2. compound bestCompat (cine glass listing several mounts)
eq("[E,EF,PL] on E = native",   bestCompat(["E", "EF", "PL"], ["E"]), "native");
eq("[EF] on E      = adapter",  bestCompat(["EF"], ["E"]), "adapter");
eq("[PL,L,X] on E  = adapter",  bestCompat(["PL", "L", "X"], ["E"]), "adapter");
eq("[RF] on E      = incompat", bestCompat(["RF"], ["E"]), "incompatible");
eq("[MFT] on E     = incompat", bestCompat(["MFT"], ["E"]), "incompatible");
eq("[] on E        = unknown",  bestCompat([], ["E"]), "unknown");
eq("[E] on []      = unknown",  bestCompat(["E"], []), "unknown");
eq("[E,EF] on [RF] = adapter",  bestCompat(["E", "EF"], ["RF"]), "adapter"); // EF→RF path wins

// 3. normalise aliases
eq("FE     → E",   normalizeMount("FE"), "E");
eq("GM     → E",   normalizeMount("GM"), "E");
eq("EF-S   → EF",  normalizeMount("EF-S"), "EF");
eq("m4/3   → MFT", normalizeMount("m4/3"), "MFT");
eq("parse E/EF/PL", parseMounts("E/EF/PL"), ["E", "EF", "PL"]);

// 4. sensor coverage compatibility
eq("ff lens on ff cam = full",     coverageCompat("ff", "ff"), "full");
eq("ff lens on s35 cam = full",    coverageCompat("ff", "s35"), "full");
eq("s35 lens on ff cam = vignette",coverageCompat("s35", "ff"), "vignette");
eq("s35 lens on s35 cam = full",   coverageCompat("s35", "s35"), "full");
eq("mft lens on ff cam = vignette",coverageCompat("mft", "ff"), "vignette");
eq("null lens = unknown",          coverageCompat(null, "ff"), "unknown");
eq("null cam  = unknown",          coverageCompat("ff", null), "unknown");

// 5. taxonomy derivation from real titles
eq("FX3 mount = E",            mountOf("Sony FX3 cinema camera"), "E");
eq("FX3 coverage = ff",        coverageOf("Sony FX3 cinema camera", "camera-body"), "ff");
eq("FX30 coverage = s35",      coverageOf("Sony FX30 cinema camera", "camera-body"), "s35");
eq("GH6 coverage = mft",       coverageOf("Panasonic Lumix GH6", "camera-body"), "mft");
eq("R5 mount = RF",            mountOf("Canon EOS R5"), "RF");
eq("R5 coverage = ff",         coverageOf("Canon EOS R5", "camera-body"), "ff");
eq("R7 coverage = s35",        coverageOf("Canon EOS R7", "camera-body"), "s35");
eq("24-70 GM mount = E",       mountOf("Sony 24-70mm f2.8 GM G Master"), "E");
eq("24-70 GM coverage = ff",   coverageOf("Sony 24-70mm f2.8 GM G Master", "lens"), "ff");
eq("E PZ 18-105 S35 = s35",    coverageOf("Sony E PZ 18-105mm Super 35", "lens"), "s35");
eq("GoPro mount = fixed",      mountOf("GoPro Hero 12 Black"), "fixed");
eq("itemType GoPro = camera",  deriveItemType("GoPro Hero 12 Black"), "camera-body");
// Canon cine bodies — the C70 spacing bug ("canon c70" query vs "Cannon c 70" listing)
eq("Canon C70 mount = RF",     mountOf("Canon C70 cinema camera"), "RF");
eq("canon c70 phrase = RF",    mountOf("i have a canon c70"), "RF");
eq("Canon C300 mount = EF",    mountOf("Canon C300 mark ii"), "EF");
eq("Canon R5C mount = RF",     mountOf("Canon R5C"), "RF");
eq("itemType canon c70 = cam", deriveItemType("canon c70"), "camera-body");
// E-mount glass is INCOMPATIBLE on an RF body (no adapter) — the bug the bot hit
eq("E lens on RF C70 = incompat", mountCompat("E", mountOf("Canon C70")!), "incompatible");
// cine/anamorphic display glass is NOT guessed as interchangeable-E — DZO Vespid is native PL
eq("DZO Vespid (arri) = PL",   mountOf("DZO film Vespid Prime Cinema lens 16mm T2.8 Full Frame ( arri alexa )"), "PL");
eq("PL Vespid on E body = adapter", mountCompat("PL", "E"), "adapter"); // needs PL->E adapter, NOT native
eq("cue-less cine lens = PL", mountOf("Great Joy 50mm Anamorphic Cine Lens Amber flare"), "PL"); // native cine mount, not false-E

// 6. END-TO-END kitWarnings against the engine (specs derived from titles)
const mk = (title: string) => { const it = deriveItemType(title); return { itemType: it, title, specs: deriveSpecs(title, it) }; };
const warnsFor = (titles: string[]) => kitWarnings(titles.map(mk));
const dims = (titles: string[]) => warnsFor(titles).map((w) => `${w.level}:${w.dimension}`).sort();

eq("FX3 + EF Sigma → adapter warn", dims(["Sony FX3", "Sigma 35mm f1.4 EF mount"]), ["warn:mount"]);
eq("FX3 + RF lens → mount error",   dims(["Sony FX3", "Canon RF 50mm f1.2"]).includes("error:mount"), true);
eq("FX3 + native GM → no warn",     dims(["Sony FX3", "Sony 24-70mm f2.8 GM"]), []);
eq("GoPro + lens → fixed error",    dims(["GoPro Hero 12", "Sony 24-70mm GM"]).includes("error:fixed-lens"), true);
eq("FX6 + V-mount batt → ok",       dims(["Sony FX6", "V-mount battery 150wh"]), []); // FX6 IS V-mount
eq("FX3 + V-mount batt → batt err", dims(["Sony FX3", "V-mount battery 150wh"]).includes("error:battery"), true);
eq("FF body + S35 lens → vignette", dims(["Sony FX3", "Sony E PZ 18-105mm Super 35 lens"]).includes("warn:coverage"), true);
eq("S35 body + FF lens → no cov",   dims(["Sony FX30", "Sony 24-70mm f2.8 GM"]).filter((d) => d.includes("coverage")), []);

console.log(`\n── A) SYNTHETIC TRUTH ──  ${pass} pass / ${fail} fail`);
if (fails.length) console.log(fails.join("\n"));

// ── B) LIVE CATALOGUE AUDIT ──────────────────────────────────────────
async function liveAudit() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) { console.log("\n── B) LIVE AUDIT ──  skipped (no NEXT_PUBLIC_CONVEX_URL)"); return; }
  const c = new ConvexHttpClient(url);
  const get = async (types: string[]) => { try { return (await c.query(api.catalog.byItemType, { types: types as any })) as any[]; } catch { return []; } };
  const cams = await get(["camera-body"]);
  const lenses = await get(["lens"]);
  const issues: string[] = [];

  // camera mount/coverage nulls
  for (const cam of cams) {
    const m = cam.specs?.mount ?? mountOf(cam.title);
    if (!m) issues.push(`camera has NO mount: ${cam.title.slice(0, 50)}`);
  }
  // lens mount nulls
  let lensNullMount = 0;
  for (const l of lenses) if (!(l.specs?.mount ?? mountOf(l.title))) lensNullMount++;

  // every camera: how many lenses are usable (native or adapter)?
  const camMounts = (cam: any) => [...new Set(parseMounts(cam.specs?.mount ?? mountOf(cam.title) ?? ""))];
  for (const cam of cams) {
    const cm = camMounts(cam);
    if (!cm.length || cm.includes("fixed")) continue;
    let usable = 0, native = 0;
    for (const l of lenses) {
      const lm = parseMounts(l.specs?.mount ?? mountOf(l.title) ?? "");
      if (!lm.length) continue;
      const v = bestCompat(lm, cm);
      if (v === "native") { native++; usable++; }
      else if (v === "adapter") usable++;
    }
    // flag only when NOTHING works (no native AND no adapter glass) — a real "this body can't
    // use any lens we stock" problem. Zero-native-but-has-adapter is fine: e.g. RF bodies in a
    // Sony-E + PL-cine catalogue legitimately have no RF-native separate lens, only EF-via-adapter.
    if (usable === 0) issues.push(`camera ${cam.title.slice(0, 40)} (${cm.join("/")}) has ZERO usable lenses (no native or adapter) — suspect`);
  }

  console.log(`\n── B) LIVE CATALOGUE AUDIT ──  ${cams.length} cameras, ${lenses.length} lenses`);
  console.log(`   lenses with null mount: ${lensNullMount}/${lenses.length}`);
  if (issues.length) { console.log(`   ${issues.length} issue(s):`); issues.slice(0, 30).forEach((i) => console.log("    • " + i)); }
  else console.log("   ✓ no structural mount issues in live data");

  // sensor-coverage population
  const ffCams = cams.filter((c) => (c.specs?.coverage ?? coverageOf(c.title, "camera-body")) === "ff").length;
  const s35Cams = cams.filter((c) => (c.specs?.coverage ?? coverageOf(c.title, "camera-body")) === "s35").length;
  console.log(`   camera coverage derived: ${ffCams} full-frame, ${s35Cams} super-35, ${cams.length - ffCams - s35Cams} unknown`);
}

liveAudit().then(() => {
  console.log(`\nRESULT: ${fail === 0 ? "✓ ALL SYNTHETIC TRUTH PASSES" : `✗ ${fail} SYNTHETIC FAILURE(S)`}`);
  process.exit(fail === 0 ? 0 : 1);
});
