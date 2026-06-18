#!/usr/bin/env node
/**
 * Offline taxonomy re-derive assertions for the data-repair wave
 * (branch fix/data-repair). Verifies the improved convex/lib/taxonomy.ts
 * logic produces the correct type / mount / tier for the known-bad slugs from
 * the prod audit — WITHOUT touching prod.
 *
 * Usage (from repo root):
 *   1. Transpile the two PURE modules to plain JS (no convex/server deps):
 *        npx tsc convex/lib/taxonomy.ts src/lib/mount.ts \
 *          --outDir /tmp/dbc-verify --module esnext --target es2020 \
 *          --moduleResolution bundler --skipLibCheck
 *   2. node convex/migrations/taxonomy.assert.mjs /tmp/dbc-verify
 *
 * Exit code 0 = all pass, 1 = at least one failure.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

const outDir = process.argv[2] || "/tmp/dbc-verify";
const taxUrl = pathToFileURL(path.join(outDir, "convex/lib/taxonomy.js")).href;
const { deriveItemType, deriveSpecs, mountOf } = await import(taxUrl);

const A = [];
const ok = (name, got, want) => A.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

// ── itemType: flagship + non-cameras-misclassified ────────────────────────
ok("GM 24-70 -> lens", deriveItemType("Sony 24-70mm f2.8 zoom gmaster g master gm e-mount"), "lens");
ok("Venice -> camera-body", deriveItemType("Sony venice 6k full frame cinema camera"), "camera-body");
ok("Teleprompter -> accessory (not camera)", deriveItemType("16-Inch Teleprompter Kit Large Professional Camera Teleprompter"), "accessory");
ok("CFexpress card -> accessory", deriveItemType("Lexar CFexpress Type A 320GB Memory Card + Card Reader for Sony FX3 FX6"), "accessory");
ok("PL->EF adapter -> accessory", deriveItemType("PL to EF Mount Adapter PL Lens to Canon EF Camera Mount Converter"), "accessory");
ok("Pure tripod -> tripod", deriveItemType("3x Tripod stand heavy duty camera stable fluid head cinema"), "tripod");
ok("Support vest -> tripod", deriveItemType("Flycam Flowline Pro 5-12 kg Camera Support Vest Easyrig"), "tripod");
ok("Camera slider -> slider", deriveItemType("Camera slider 100cm motorised Neewer automatic App control"), "slider");
ok("Camera flash -> light", deriveItemType("Camera flash compatible with Sony cannon Nikon Leica Fuji"), "light");
ok("Operator DP service -> accessory", deriveItemType("Sony Venice 6k Cinema camera + Operator DP"), "accessory");
ok("Video transmitter -> monitor", deriveItemType("Hollyland Pyro S Wireless Video Transmitter Receiver Kit Image Transmission Camera Monitoring"), "monitor");

// ── must NOT regress: real packages stay camera-body, audio kits untouched ─
ok("BMPCC package keeps camera-body", deriveItemType("BMPCC 6k PRO Cinema Kit + tripod + follow focus tilta nucleus"), "camera-body");
ok("Vespid+BMPCC package keeps camera-body", deriveItemType("DZO Vespid Prime Cinema lens set + Bmpcc 6k pro camera"), "camera-body");
ok("Sennheiser mic set keeps wireless-mic", deriveItemType("Senheiser g3 Wireless lav lapel mic microphone radio mic set 1x transmitter 1x reciever"), "wireless-mic");
ok("Zoom H5 recorder keeps recorder", deriveItemType("Zoom H5 Audio Recorder 2x XLR + 6m cable + 32gb sd card"), "recorder");
ok("Boom mic set keeps boom-mic", deriveItemType("2x Boom mic set shotgun Senheiser rode mics mke 600 + audio recorder, sd card, xlr cable"), "boom-mic");

// ── mount: venice, cannon alias, compound, L-series guard ──────────────────
ok("Venice -> E mount", mountOf("Sony venice 6k full frame cinema camera"), "E");
ok("Cannon R5 -> RF", mountOf("cannon r5 24-105mm f4 mirrorless camera full frame 4k"), "RF");
// Canon C70 mount is intentionally NOT inferred by mountOf (the C-series isn't a
// targeted defect and "C70" is RF in reality but stored "EF" in prod). mountOf
// returns null → the additive repair leaves the stored value untouched. We
// assert the null so this stays documented and the repair never guesses here.
ok("Cannon C70 mount not inferred (null, left to stored)", mountOf("cannon c-70 cinema camera 1tb sd card"), null);
ok("Catta compound mount", mountOf("DZOfilm Cinema Zoom Lens Full frame Catta Ace Set pl/ef/e/l/rf mount"), "E/EF/RF/PL/L");
ok("Atlas Mercury compound", mountOf("Atlas Mercury Anamorphic cinema lens set 1.5x 36,45,72mm Orion flare pl,ef,x,l,e mount"), "E/EF/PL/L/X");
ok("Cannon EF L-series stays EF (not EF/L)", mountOf("Cannon 16-35mm f2.8 usm L II lens ef mount"), "EF");
ok("Brand-noise (no 'mount' word) does NOT compound", mountOf("DZO film Vespid Prime Cinema lens 50mm T2.1 Full Frame ( arri, Zeiss, cannon, Meike)"), "PL");

// ── tier: always set for lenses; premium covers cine brands ────────────────
ok("DZO Vespid -> premium", deriveSpecs("DZO film Vespid Prime Cinema lens 50mm T2.1", "lens").tier, "premium");
ok("Blazar -> premium", deriveSpecs("Anamorphic Blazar Remus Full frame Lens", "lens").tier, "premium");
ok("Atlas -> premium", deriveSpecs("atlas mercury anamorphic cinema lens set", "lens").tier, "premium");
ok("Sony 28-70 kit -> standard", deriveSpecs("Sony full frame 28-70mm zoom lens", "lens").tier, "standard");
ok("tier never null on lens", deriveSpecs("some random lens 50mm", "lens").tier !== null, true);

let fails = 0;
for (const a of A) {
  if (!a.pass) fails++;
  console.log(`${a.pass ? "PASS" : "FAIL"}  ${a.name}  got=${JSON.stringify(a.got)} want=${JSON.stringify(a.want)}`);
}
console.log(`\n${A.length - fails}/${A.length} pass`);
process.exit(fails === 0 ? 1 - 1 : 1);
