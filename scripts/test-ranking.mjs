#!/usr/bin/env node
/**
 * test-ranking.mjs — offline (no-network) proof that the mount-ranking engine
 * in src/lib/mount.ts surfaces the RIGHT lens for an E-mount body (Sony FX3),
 * and ranks Canon EF (adapter) glass below native E glass.
 *
 * It loads real catalogue records from the audit snapshot, imports the LIVE
 * mount.ts logic (transpiled on the fly via esbuild — no tsx/ts-node needed),
 * prints the BEFORE (old first-available) vs AFTER (scored) top-10, then runs
 * four assertions. Exit code is non-zero if any assertion FAILS.
 *
 *   node scripts/test-ranking.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---- 1. import the LIVE mount.ts logic (single source of truth) -------------
async function loadMount() {
  const esbuild = await import(resolve(ROOT, "node_modules/esbuild/lib/main.js")).catch(() =>
    import("esbuild"),
  );
  const src = readFileSync(resolve(ROOT, "src/lib/mount.ts"), "utf8");
  const { code } = esbuild.transformSync(src, { loader: "ts", format: "esm", target: "es2020" });
  const url = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  return import(url);
}

// ---- 2. load catalogue records from the snapshot (or fallbacks) -------------
function loadDocs() {
  const candidates = [
    "/tmp/dbc-audit/listings/documents.jsonl",
    resolve(ROOT, "scripts/fixtures/listings.jsonl"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const docs = readFileSync(p, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      if (docs.length) return { docs, source: p };
    }
  }
  return { docs: null, source: null };
}

// ---- 3. the OLD behaviour, for contrast -------------------------------------
// Old gate (pre-fix gear.ts): boolean lensFits, EF compatible with E/RF, exact
// string compare (so compound "E/EF/PL" matched nothing). Old picker took the
// FIRST available AF lens in catalogue order.
function oldLensFits(lensMount, camMounts) {
  if (!lensMount || camMounts.length === 0) return true;
  if (camMounts.every((m) => m === "fixed")) return false;
  return camMounts.some(
    (m) => m === "any" || lensMount === "any" || m === lensMount || (lensMount === "EF" && (m === "E" || m === "RF")),
  );
}
function oldPick(lenses, camMounts) {
  // mimics firstAvailableByType: first AF lens that "fits", else first that fits
  let fallback = null;
  for (const l of lenses) {
    const mount = l.specs?.mount ?? null;
    if (!oldLensFits(mount, camMounts)) continue;
    if (l.specs?.lensClass === "af") return l;
    if (!fallback) fallback = l;
  }
  return fallback;
}

const C = { g: "\x1b[32m", r: "\x1b[31m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };
const fmt = (n) => (n === -Infinity ? "-inf" : String(n));

async function main() {
  const M = await loadMount();
  const { docs, source } = loadDocs();
  if (!docs) {
    console.error(
      "No snapshot found at /tmp/dbc-audit/listings/documents.jsonl and no scripts/fixtures/listings.jsonl fallback.\n" +
        "Run `npx convex export` or drop a JSONL fixture, then re-run.",
    );
    process.exit(2);
  }
  console.log(`${C.d}snapshot: ${source} (${docs.length} docs)${C.x}\n`);

  const lenses = docs.filter((d) => d.itemType === "lens");
  // FX3 = Sony E-mount body
  const camMounts = ["E"];
  console.log(`${C.b}Camera under test: Sony FX3 — camMounts = [${camMounts.join(",")}]${C.x}`);
  console.log(`${C.b}Lens pool: ${lenses.length} lenses${C.x}\n`);

  // ---- BEFORE -------------------------------------------------------------
  const before = oldPick(lenses, camMounts);
  console.log(`${C.b}BEFORE (old first-available AF, boolean EF↔E/RF gate):${C.x}`);
  console.log(
    `  → ${before ? `"${before.title.slice(0, 64)}"  mount=${before.specs?.mount} tier=${before.specs?.tier ?? "-"}` : "(none)"}`,
  );
  console.log(`  ${C.d}(picked purely by catalogue order — no mount ranking, no native/premium preference)${C.x}\n`);

  // ---- AFTER (scored) -----------------------------------------------------
  const scored = lenses
    .map((l) => {
      const score = M.lensScore(
        { mount: l.specs?.mount, tier: l.specs?.tier, lensClass: l.specs?.lensClass },
        camMounts,
      );
      const compat = M.bestCompat(M.parseMounts(l.specs?.mount), camMounts);
      return { l, score, compat };
    })
    .sort((a, b) => b.score - a.score || (a.l.pricing?.daily ?? 1e9) - (b.l.pricing?.daily ?? 1e9));

  console.log(`${C.b}AFTER (lensScore ranking) — top 10:${C.x}`);
  console.log(`  ${C.d}${"#".padStart(2)} ${"score".padStart(5)}  ${"compat".padEnd(12)} ${"mount".padEnd(8)} ${"tier".padEnd(9)} ${"class".padEnd(5)} title${C.x}`);
  for (let i = 0; i < Math.min(10, scored.length); i++) {
    const { l, score, compat } = scored[i];
    const col = compat === "native" ? C.g : compat === "incompatible" ? C.r : "";
    console.log(
      `  ${String(i + 1).padStart(2)} ${fmt(score).padStart(5)}  ${col}${compat.padEnd(12)}${C.x} ${(l.specs?.mount ?? "-").padEnd(8)} ${(l.specs?.tier ?? "-").padEnd(9)} ${(l.specs?.lensClass ?? "-").padEnd(5)} ${l.title.slice(0, 52)}`,
    );
  }
  console.log("");

  // ---- ASSERTIONS ---------------------------------------------------------
  const top = scored.filter((s) => s.score !== -Infinity);
  const top5 = top.slice(0, 5);
  const assertions = [];
  const A = (name, pass, detail) => assertions.push({ name, pass, detail });

  // (a) #1 is a native E-mount lens
  {
    const first = top[0];
    const nativeE = first && first.compat === "native" && M.parseMounts(first.l.specs?.mount).includes("E");
    A("(a) #1 is a native E-mount lens", !!nativeE, first ? `#1 = ${first.compat} ${first.l.specs?.mount} "${first.l.title.slice(0, 40)}"` : "no lens");
  }
  // (b) at least one GM/premium lens in top 5
  {
    const premInTop5 = top5.some((s) => (s.l.specs?.tier === "premium") || /\bgm\b|g master|g-master/i.test(s.l.title));
    A("(b) ≥1 GM/premium lens in top 5", premInTop5, `top5 tiers: [${top5.map((s) => s.l.specs?.tier ?? "-").join(",")}]`);
  }
  // (c) every Canon EF lens is compat="adapter" and ranks BELOW all native lenses
  {
    const efLenses = scored.filter((s) => {
      const ms = M.parseMounts(s.l.specs?.mount);
      return ms.includes("EF") && !ms.includes("E"); // EF but not also native E
    });
    const allAdapter = efLenses.every((s) => s.compat === "adapter");
    const lastNativeIdx = scored.reduce((acc, s, i) => (s.compat === "native" ? i : acc), -1);
    const everyEfBelowNative = efLenses.every((s) => scored.indexOf(s) > lastNativeIdx);
    A(
      "(c) Canon EF lenses are 'adapter' & rank below every native lens",
      efLenses.length > 0 && allAdapter && everyEfBelowNative,
      `${efLenses.length} EF lenses; allAdapter=${allAdapter}; everyBelowNative=${everyEfBelowNative} (lastNativeIdx=${lastNativeIdx})`,
    );
  }
  // (d) compound-mount lenses (e.g. "E/EF/PL") are NOT excluded for an E body
  {
    const compound = lenses.filter((l) => /[\/,|]/.test(l.specs?.mount ?? ""));
    const withE = compound.filter((l) => M.parseMounts(l.specs?.mount).includes("E"));
    const notExcluded = withE.every((l) => {
      const s = M.lensScore({ mount: l.specs?.mount, tier: l.specs?.tier, lensClass: l.specs?.lensClass }, camMounts);
      return s !== -Infinity;
    });
    A(
      "(d) compound-mount lenses w/ E (e.g. 'E/EF/PL') NOT excluded",
      withE.length === 0 ? true : notExcluded,
      `${compound.length} compound lenses, ${withE.length} include E; all kept=${withE.length ? notExcluded : "n/a"}`,
    );
  }
  // (e) a pure Canon RF lens (RF-only — no EF/E adapter path) is HARD-EXCLUDED
  //     for an E body: compat="incompatible", lensScore = -Infinity. This is the
  //     guard the bot route now enforces (incompatible ⇒ no card). Note an
  //     "EF/RF" compound is intentionally NOT here — its EF leg adapts onto E,
  //     so it is correctly an 'adapter' match, not excluded.
  {
    const rfOnly = scored.filter((s) => {
      const ms = M.parseMounts(s.l.specs?.mount);
      return ms.length > 0 && ms.every((m) => m === "RF"); // strictly RF
    });
    const allExcluded = rfOnly.every(
      (s) => s.compat === "incompatible" && s.score === -Infinity,
    );
    A(
      "(e) pure-RF lenses are HARD-EXCLUDED (incompatible, -inf) for an E body",
      rfOnly.length > 0 && allExcluded,
      `${rfOnly.length} RF-only lenses; allExcluded=${allExcluded} [${rfOnly.map((s) => `${s.l.specs?.mount}:${fmt(s.score)}`).join(", ")}]`,
    );
  }

  console.log(`${C.b}ASSERTIONS:${C.x}`);
  let allPass = true;
  for (const a of assertions) {
    allPass = allPass && a.pass;
    console.log(`  ${a.pass ? C.g + "PASS" : C.r + "FAIL"}${C.x}  ${a.name}\n        ${C.d}${a.detail}${C.x}`);
  }
  console.log("");
  console.log(allPass ? `${C.g}${C.b}ALL ASSERTIONS PASSED${C.x}` : `${C.r}${C.b}SOME ASSERTIONS FAILED${C.x}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("harness error:", e);
  process.exit(3);
});
