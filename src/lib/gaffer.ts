import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { generateObject } from "ai";
import { z } from "zod";
import { botModel } from "@/lib/ai";
import { quote } from "@/lib/pricing";
import { tierByKey } from "@/lib/membership";
import { dayMs } from "@/lib/dates";
import { lensScore, bestCompat, parseMounts } from "@/lib/mount";
import { coverageCompat } from "@/lib/compat";
import { mountOf, coverageOf, deriveItemType } from "../../convex/lib/taxonomy";

/**
 * Gaffer v2 — "engine decides, LLM narrates".
 *
 * The OLD bot let the LLM free-text answers (and it hallucinated owned inventory,
 * recommended cross-category nonsense, and its prose never matched the cards). This
 * inverts that: a deterministic engine is the SINGLE SOURCE OF TRUTH for what we
 * stock, what's compatible, and what to recommend. The LLM only (1) parses the user's
 * intent into structured form and (2) writes prose FROM the engine's facts + chosen
 * cards. It is structurally impossible for Gaffer to deny inventory we own or to show
 * a card that contradicts the prose.
 */

// ── tokenisation / matching (validated against real catalogue data) ─────────────
function toks(s: string): string[] {
  return (String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length >= 2);
}
/** Strip SEO comparison clauses ("(like Sony FX6 / A7SIII)") — advertising, not the product. */
function stripCompare(s: string): string {
  return String(s || "").replace(/\((?:like|such as|similar to|comparable to|vs\.?|alternative to)[^)]*\)/gi, " ");
}
/** Spacing variants so "FX6" finds a listing titled "Sony fx 6" (search is substring). */
function searchVariants(term: string): string[] {
  const t = term.toLowerCase().trim();
  const spaced = t.replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2");
  const despaced = t.replace(/([a-z])\s+(\d)/g, "$1$2").replace(/(\d)\s+([a-z])/g, "$1$2");
  return [...new Set([t, spaced, despaced].filter(Boolean))];
}
// generic camera-jargon words that don't identify a specific product (so they're not
// "required" — the focal numbers, model designators, and brand words are what identify it).
const GENERIC = new Set([
  "camera", "cinema", "lens", "lenses", "mount", "frame", "full", "zoom", "prime", "primes",
  "video", "mirrorless", "master", "gmaster", "professional", "digital", "ultra", "wide",
  "angle", "with", "for", "the", "and", "set", "kit", "bundle", "package", "cards", "batteries",
  "lights", "light", "autofocus", "manual", "aperture", "stop", "stabili", "body", "alpha",
]);
/** Identity components of a query, RANGE-AWARE: focal ranges ("24-70" → "2470", which must
 * appear contiguously so a 70-200+24mm bundle can't match), model designators (fx6/a7iv),
 * standalone numbers (85), and distinctive brand/product words (sigma, raptor) — never generic. */
function queryIdentity(text: string): { ranges: string[]; models: string[]; nums: string[]; words: string[] } {
  const lower = String(text || "").toLowerCase();
  const rangesRaw = lower.match(/\d+\s*-\s*\d+/g) || [];
  const ranges = rangesRaw.map((r) => r.replace(/[^0-9]/g, ""));
  const rangeNums = new Set(rangesRaw.flatMap((r) => r.match(/\d+/g) || []));
  const ts = toks(text);
  const models = ts.filter((t) => /[a-z]\d|\d[a-z]/.test(t));
  const nums = ts.filter((t) => /^\d{2,}$/.test(t) && !rangeNums.has(t));
  const words = ts.filter((t) => t.length >= 5 && !GENERIC.has(t));
  return { ranges, models, nums, words };
}
/** Genuine name match. Focal ranges must appear contiguously; model designators / standalone
 * numbers / distinctive words must all appear (checked against the despaced title so "24-70"
 * matches "24-70mm" and "fx 6" matches "fx6"). No identity tokens ⇒ majority word overlap.
 * Fixes BOTH wrong matches and the false denials from full-phrase substring search. */
function titleMatchesQuery(queryText: string, title: string): boolean {
  const qt = toks(queryText);
  if (!qt.length) return false;
  const cleanTitle = stripCompare(title);
  const tt = new Set(toks(cleanTitle));
  const tj = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
  const has = (t: string) => tt.has(t) || tj.includes(t);
  const id = queryIdentity(queryText);
  if (id.ranges.length || id.models.length || id.nums.length || id.words.length) {
    if (!id.ranges.every((r) => tj.includes(r))) return false;
    return [...id.models, ...id.nums, ...id.words].every(has);
  }
  const words = qt.filter((t) => t.length >= 4);
  const pool = words.length ? words : qt;
  const hasW = (t: string) => tt.has(t) || (t.length >= 3 && tj.includes(t));
  const hits = pool.filter(hasW).length;
  return hits >= 1 && hits / pool.length >= 0.5;
}
/** Distinctive single-token search terms for a subject — searched individually because
 * listListings substring-matches the WHOLE phrase, so "sigma 24-70" never matches the
 * title "Sigma art 24-70mm" (word between). Union of single-token hits is then gated. */
function searchTermsFor(text: string): string[] {
  const ts = toks(text);
  const hyphen = (String(text || "").toLowerCase().match(/\d+-\d+/g) || []);
  const models = ts.filter((t) => /[a-z]\d|\d[a-z]/.test(t));
  const words = ts.filter((t) => t.length >= 5 && !GENERIC.has(t));
  const nums = ts.filter((t) => /^\d{2,}$/.test(t));
  return [...new Set([...hyphen, ...models, ...words, ...nums])].slice(0, 6);
}
/** Quality score for non-lens picks: a real cinema body beats an action cam. */
function nonLensQuality(l: any, slot: string): number {
  const t = String(l.title || "").toLowerCase();
  let s = 0;
  if (/\b(kit|set|bundle|package)\b/.test(t)) s += 2;
  if (/fx3|fx6|fx9|a7s|a7 ?iii|a7iv|a7r|burano|venice|komodo|raptor|alexa|amira|ursa|c70|c300|c500|ronin|fs7|fs5/.test(t)) s += 3;
  if (slot === "camera" || slot === "camera-body") {
    if (/osmo|action ?cam|go ?pro|hero ?\d|\bpocket\b|insta ?360|webcam|360 ?degree|\baction\b/.test(t)) s -= 6;
    if (/\btripod\b|\bmonitor\b|teleprompter|cfexpress|card reader|\badapter\b|\bflash\b|\bcharger\b/.test(t)) s -= 9; // mis-typed non-camera that slipped into camera-body
  }
  s += Math.min(3, Math.floor((l.pricing?.daily ?? 0) / 50));
  return s;
}
/** Native-flagship lens boost: on a Sony E body, prefer Sony's G Master glass (the
 * canonical workhorse a DP expects) over third-party premium — and a 24-70 workhorse
 * zoom over a niche focal. So "a lens for my FX3" leads with the Sony 24-70 GM, not the
 * cheapest premium (which the bare day-rate tiebreak picks). Standalone lenses only. */
function lensHeroBoost(l: any, camMounts: string[], camCoverage: string | null = null): number {
  if (l.itemType !== "lens") return 0;
  const t = String(l.title || "").toLowerCase();
  if (/camera|\bfx ?3\b|\bfx ?6\b|a7|a73|komodo|\bred\b|bmpcc|\bset \+|\+ .*camera/.test(t)) return 0; // skip bundles
  let b = 0;
  const sonyBody = camMounts.includes("E");
  if (sonyBody && /\bg ?master\b|gmaster|\bgm\b/.test(t) && /\bsony\b/.test(t)) b += 14; // native flagship
  if (sonyBody && /\b(sigma|tamron|samyang|rokinon|viltrox|7artisans)\b/.test(t)) b -= 4; // third-party
  if (/24-?70/.test(t)) b += 4; // the everyday workhorse range
  // a crop (S35/MFT) lens vignettes on a full-frame body — rank full-frame glass first
  if (coverageCompat(l.specs?.coverage, camCoverage) === "vignette") b -= 12;
  return b;
}
/** Real-demand boost from the rental history (listing.demandScore, set by sync.applyDemand).
 * Sub-linear + capped so a hugely-rented item lifts but doesn't swamp compatibility. This is
 * the data-driven "what's actually in demand" signal — e.g. the Sony 24-70 GM (rented 234x)
 * leads, the Sigma (never rented) doesn't. */
function demandBoost(l: any): number {
  const d = Number(l?.demandScore) || 0;
  if (d <= 0) return 0;
  return Math.min(22, Math.round(Math.sqrt(d) * 1.3));
}
/** For a SINGLE-item slot, prefer one item over a multi-item "ultimate"/3-lens kit (those
 * win on summed demand but aren't what "a lens" asks for). */
function setPenalty(l: any): number {
  const t = String(l?.title || "").toLowerCase();
  if (/\bultimate\b/.test(t)) return 14;
  if (l?.itemType === "lens" && (t.match(/\d{2,3}\s*-\s*\d{2,3}/g) || []).length >= 3) return 14; // 3-lens kit
  return 0;
}
/** Focal/aperture tokens for lens-similarity ranking ("24-70mm f2.8" → 24,70,28). */
function specTokens(s: string): string[] {
  return (String(s || "").toLowerCase().match(/\d{1,3}(?:mm)?|f?\d\.\d|t\d\.\d/g) || []).map((x) => x.replace(/mm$/, ""));
}
/** Mounts implied by the SUBJECT (its resolved listing mount, else a mount word in the
 * text) — so an alternative to a Sony-E lens is constrained to E even when the customer
 * named no camera. Prevents offering an RF lens as a substitute for an E-mount lens. */
function subjectMounts(subjectText: string, subj: any): string[] {
  if (subj?.specs?.mount) { const m = parseMounts(subj.specs.mount); if (m.length) return m; }
  const tok = (String(subjectText || "").toLowerCase().match(/\b(ef|rf|pl|mft|e|l|x)[\s-]?mount\b/) || [])[1];
  return tok ? parseMounts(tok.toUpperCase()) : [];
}
/** Comparator for ranking candidates. "cheaper" sorts by day-rate ascending first (then
 * quality); otherwise by quality first (then cheaper as a tiebreak). */
function rankCmp(pref: "cheaper" | "premium" | "any") {
  const price = (o: any) => o.x.pricing?.daily ?? 0;
  return (a: any, b: any) =>
    pref === "cheaper"
      ? (price(a) || 1e9) - (price(b) || 1e9) || b.score - a.score
      : b.score - a.score || price(a) - price(b);
}

const TERM: Record<string, string> = {
  "camera-body": "camera", camera: "camera", lens: "lens", lenses: "lens",
  gimbal: "gimbal", light: "light", lighting: "light", "nd-filter": "filter",
  filter: "filter", battery: "battery", monitor: "monitor", "wireless-mic": "mic",
  mic: "mic", audio: "mic", tripod: "tripod", drone: "drone", speaker: "speaker",
};
const EXPECTED_ITEMTYPES: Record<string, string[]> = {
  camera: ["camera-body"], "camera-body": ["camera-body"],
  lens: ["lens"], lenses: ["lens"],
  gimbal: ["gimbal"], light: ["light"], lighting: ["light"],
  "nd-filter": ["nd-filter"], filter: ["nd-filter"],
  battery: ["battery"], monitor: ["monitor"],
  "wireless-mic": ["wireless-mic", "boom-mic"], mic: ["wireless-mic", "boom-mic"], audio: ["wireless-mic", "boom-mic"],
  tripod: ["tripod"], drone: ["drone"], speaker: ["speaker"],
};
function itemTypeMatches(slot: string, itemType: string | null | undefined): boolean {
  const expected = EXPECTED_ITEMTYPES[slot];
  if (!expected) return true;
  return !!itemType && expected.includes(itemType);
}

// ── date safety: NEVER book the past ────────────────────────────────────────────
const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
function safeDates(start: string | undefined, end: string | undefined, today: string): { start: string; end: string; estimated: boolean } {
  const todayMs = dayMs(today);
  let s = start && dayMs(start) >= todayMs ? start : undefined;
  let e = end && dayMs(end) >= todayMs ? end : undefined;
  if (s && !e) e = s;
  if (e && !s) s = e;
  if (s && e) return { start: s, end: e, estimated: false };
  // no usable dates → a clearly-future placeholder, flagged estimated (never the past)
  return { start: iso(todayMs + 3 * DAY), end: iso(todayMs + 5 * DAY), estimated: true };
}
/** Deterministic backstop for relative dates the LLM sometimes leaves unresolved. */
function resolveRelativeDates(text: string, today: string): { start?: string; end?: string } {
  const t = String(text || "").toLowerCase();
  const base = dayMs(today);
  const dow = new Date(base).getUTCDay(); // 0 Sun .. 6 Sat
  const d = (n: number) => iso(base + n * DAY);
  if (/\bnext weekend\b/.test(t)) { const s = ((6 - dow + 7) % 7) + 7; return { start: d(s), end: d(s + 1) }; }
  if (/\bthis weekend\b|\bweekend\b/.test(t)) { const s = (6 - dow + 7) % 7; return { start: d(s), end: d(s + 1) }; }
  if (/\bnext week\b/.test(t)) { const s = ((1 - dow + 7) % 7) || 7; return { start: d(s), end: d(s + 4) }; }
  if (/\btomorrow\b/.test(t)) return { start: d(1), end: d(1) };
  if (/\b(today|tonight)\b/.test(t)) return { start: d(0), end: d(0) };
  return {};
}

// ── card builder ────────────────────────────────────────────────────────────────
function quoteDays(start: string, end: string) {
  return Math.max(1, Math.round((dayMs(end) - dayMs(start)) / DAY) + 1);
}
async function buildCard(
  c: ConvexHttpClient,
  l: any,
  start: string,
  end: string,
  ctx: Ctx,
  reason: string,
  checkAvail = true,
) {
  const days = quoteDays(start, end);
  let available = true;
  // only check availability against REAL dates — a placeholder/estimated window must
  // not surface a misleading "not free" on gear the customer hasn't actually scheduled.
  if (checkAvail && !ctx.estimated) {
    const av: any = await c.query(api.availability.forListing, { listingId: l._id, start: dayMs(start), end: dayMs(end) });
    available = (av?.available ?? 0) > 0;
  }
  const q: any = quote(l.pricing, days);
  const item: any = {
    listingId: l._id, slug: l.slug, title: l.title, image: l.heroImage ?? null,
    start, end, days, perDay: q.perDay, total: q.total, deposit: l.depositAmount ?? 0, available,
    itemType: l.itemType ?? null, mount: l.specs?.mount ?? null, lensClass: l.specs?.lensClass ?? null,
    tier: l.specs?.tier ?? null, pricing: l.pricing,
  };
  if (ctx.estimated) item.estimated = true;
  if (ctx.memberPct > 0) { item.memberPct = ctx.memberPct; item.memberTotal = Math.round(item.total * (1 - ctx.memberPct / 100)); }
  if (ctx.favorites.includes(String(l._id))) item.favorite = true;
  if (ctx.activeBooking && item.pricing) {
    const bd = quoteDays(iso(ctx.activeBooking.start), iso(ctx.activeBooking.end));
    const aq: any = quote(item.pricing, bd);
    item.addonBookingId = ctx.activeBooking.id; item.addonStart = ctx.activeBooking.start;
    item.addonEnd = ctx.activeBooking.end; item.addonTotal = aq.total; item.addonLabel = ctx.activeBooking.label;
  }
  return { kind: "add", reason, item };
}

// ── catalogue resolution (the authoritative "do we have it") ─────────────────────
/** Resolve a free-text item name to the single best real listing, or null. Variant
 * search + genuine-name gate; for a lens, the best by compat with the camera. */
async function resolveSubjectListing(
  c: ConvexHttpClient,
  text: string,
  opts: { camMounts?: string[]; itemType?: string } = {},
): Promise<any | null> {
  const q = String(text || "").replace(/^\d+\s*[x×]\s*/i, "").trim();
  if (q.length < 3) return null;
  const slugHit: any = await c.query(api.catalog.getListingBySlug, { slug: q.toLowerCase().replace(/[^a-z0-9]+/g, "-") });
  if (slugHit) return slugHit;
  const byId = new Map<string, any>();
  for (const v of [...searchVariants(q), ...searchTermsFor(q)]) {
    const r: any[] = await c.query(api.catalog.listListings, { search: v });
    for (const x of r || []) byId.set(String(x._id), x);
  }
  let pool = [...byId.values()].filter((x) => titleMatchesQuery(q, x.title));
  if (opts.itemType) pool = pool.filter((x) => itemTypeMatches(opts.itemType!, x.itemType));
  if (!pool.length) return null;
  // prefer a lens scored by camera compat; else cheapest credible match
  const lensPool = pool.filter((x) => x.itemType === "lens");
  if (lensPool.length && (opts.itemType === "lens" || opts.itemType === "lenses" || !opts.itemType)) {
    const cam = opts.camMounts ?? [];
    let best: any = null, bs = -Infinity;
    for (const x of lensPool) {
      const s = lensScore({ mount: x.specs?.mount, tier: x.specs?.tier, lensClass: x.specs?.lensClass }, cam);
      if (s === -Infinity) continue;
      if (s > bs) { bs = s; best = x; }
    }
    if (best) return best;
  }
  return pool[0];
}

/** Find real in-stock alternatives of the same type, ranked by compat + spec similarity
 * + favourites, excluding the subject itself. */
async function findAlternatives(
  c: ConvexHttpClient,
  subjectText: string,
  itemType: string,
  ctx: Ctx,
  n: number,
  excludeId?: string,
  mountHint: string[] = [],
): Promise<any[]> {
  const term = TERM[itemType] || itemType || "lens";
  const r: any[] = await c.query(api.catalog.listListings, { search: term });
  const wantSpecs = specTokens(subjectText);
  const cam = ctx.camMounts;
  const scored = (r || [])
    .filter((x) => itemTypeMatches(itemType, x.itemType) && String(x._id) !== excludeId && !ctx.cartIds.includes(String(x._id)))
    .map((x) => {
      let score = 0;
      if (itemType === "lens" || itemType === "lenses") {
        const ls = lensScore({ mount: x.specs?.mount, tier: x.specs?.tier, lensClass: x.specs?.lensClass }, cam);
        if (ls === -Infinity) return null; // incompatible — never offer
        score += ls + lensHeroBoost(x, cam, ctx.camCoverage);
      } else {
        score += nonLensQuality(x, itemType);
        if ((itemType === "camera" || itemType === "camera-body") && cam.length && parseMounts(x.specs?.mount).some((m) => cam.includes(m))) score += 6; // match desired body mount
      }
      const xs = specTokens(x.title);
      score += wantSpecs.filter((t) => xs.includes(t)).length * 4; // focal/aperture overlap
      score += demandBoost(x) - setPenalty(x); // real demand, minus a single-item preference
      if (ctx.favorites.includes(String(x._id))) score += 8;
      return { x, score };
    })
    .filter(Boolean) as { x: any; score: number }[];
  // drop actively-poor fits (action cams / mis-typed items) so "cheaper" can't surface them;
  // fall back to the full set only if the floor leaves nothing.
  let pool = scored.filter((s) => s.score >= 0);
  if (!pool.length) pool = scored;
  pool.sort(rankCmp(ctx.pricePref));
  // DETERMINISTIC mount homogenisation: with no camera known, a lens request must not
  // mix mounts (an E-lens alternative can't be an RF lens). Use the explicit hint (the
  // subject's mount); else infer from the top spec-match. Independent of LLM variance.
  if ((itemType === "lens" || itemType === "lenses") && !cam.length && pool.length) {
    const target = (mountHint[0] || parseMounts(pool[0].x.specs?.mount)[0] || "").toUpperCase();
    if (target) pool = pool.filter((s) => { const ms = parseMounts(s.x.specs?.mount) as string[]; return !ms.length || ms.includes(target); });
  }
  // CALENDAR-AWARE: with real dates, only recommend gear that's actually FREE — scan ranked
  // candidates, keep the first n that are available (fall back to top if nothing in range is free).
  if (!ctx.estimated && ctx.start && ctx.end && pool.length) {
    const free: any[] = [];
    for (const { x } of pool.slice(0, 24)) {
      if (free.length >= n) break;
      try {
        const av: any = await c.query(api.availability.forListing, { listingId: x._id, start: dayMs(ctx.start), end: dayMs(ctx.end) });
        if ((av?.available ?? 0) > 0) free.push(x);
      } catch {}
    }
    if (free.length) return free;
  }
  return pool.slice(0, n).map((s) => s.x);
}

/** Best in-stock pick for a single slot (recommend / kit-fill), favourites-boosted. */
async function bestForType(c: ConvexHttpClient, itemType: string, ctx: Ctx, seen: Set<string>): Promise<any | null> {
  const term = TERM[itemType] || itemType;
  const r: any[] = await c.query(api.catalog.listListings, { search: term });
  const cam = ctx.camMounts;
  const cands = (r || [])
    .filter((x) => !seen.has(String(x._id)) && !ctx.cartIds.includes(String(x._id)) && itemTypeMatches(itemType, x.itemType))
    .map((x) => {
      let score: number;
      if (itemType === "lens" || itemType === "lenses") {
        score = lensScore({ mount: x.specs?.mount, tier: x.specs?.tier, lensClass: x.specs?.lensClass }, cam);
        if (score === -Infinity) return null;
        score += lensHeroBoost(x, cam, ctx.camCoverage);
      } else {
        score = nonLensQuality(x, itemType);
        if ((itemType === "camera" || itemType === "camera-body") && cam.length && parseMounts(x.specs?.mount).some((m) => cam.includes(m))) score += 6; // match desired body mount
      }
      score += demandBoost(x) - setPenalty(x); // real demand, minus a single-item preference
      if (ctx.favorites.includes(String(x._id))) score += 8;
      return { x, score };
    })
    .filter(Boolean) as { x: any; score: number }[];
  let pool = cands.filter((s) => s.score >= 0);
  if (!pool.length) pool = cands;
  pool.sort(rankCmp(ctx.pricePref));
  if (!pool.length) return null;
  // CALENDAR-AWARE: when the dates are real, return the highest-ranked item that's actually
  // FREE for them (not booked out); fall back to the top pick if none of the top set is free.
  if (!ctx.estimated && ctx.start && ctx.end) {
    for (const { x } of pool.slice(0, 10)) {
      try {
        const av: any = await c.query(api.availability.forListing, { listingId: x._id, start: dayMs(ctx.start), end: dayMs(ctx.end) });
        if ((av?.available ?? 0) > 0) return x;
      } catch {}
    }
  }
  return pool[0].x;
}

// ── context ──────────────────────────────────────────────────────────────────────
type Ctx = {
  c: ConvexHttpClient;
  memberPct: number;
  memberName: string | null;
  favorites: string[];
  favTitles: string[];
  activeBooking: any;
  camMounts: string[];
  camCoverage: string | null;
  customerName: string;
  email: string | null;
  pastTitles: string[];
  cartTitles: string[];
  cartIds: string[];
  today: string;
  estimated: boolean;
  start: string;
  end: string;
  pricePref: "cheaper" | "premium" | "any";
};

/** Camera mounts named anywhere in the conversation (e.g. "FX3" ⇒ E). */
// Larger sensor wins (ff > s35 > mft) so a full-frame body in the conversation
// triggers the crop-lens vignette penalty.
const COVERAGE_RANK: Record<string, number> = { mft: 1, s35: 2, ff: 3 };
function biggerCoverage(a: string | null, b: string | null): string | null {
  if (!a) return b; if (!b) return a;
  return (COVERAGE_RANK[b] ?? 0) > (COVERAGE_RANK[a] ?? 0) ? b : a;
}

async function camMountsFromText(c: ConvexHttpClient, text: string): Promise<{ mounts: string[]; coverage: string | null }> {
  if (!text || !text.trim()) return { mounts: [], coverage: null };
  const explicit = (text.toLowerCase().match(/\b(e|ef|rf|pl|mft|l|x)[\s-]?mount\b/g) || []).map((m) => m.replace(/[\s-]?mount/, "").toUpperCase());
  const toksList = (text.toLowerCase().match(/[a-z][a-z0-9]{1,}[a-z0-9]/g) || []).filter((t) => /\d/.test(t) || /(komodo|raptor|alexa|amira|burano|venice|ursa)/.test(t));
  const queries = Array.from(new Set([...toksList, text.trim()])).slice(0, 6);
  const mounts = new Set<string>(explicit);
  let coverage: string | null = null;
  // DETERMINISTIC model resolution FIRST — catches bodies whose catalogue title
  // spacing differs from the query (e.g. "canon c70" vs the listing "Cannon c 70")
  // so the engine ALWAYS constrains recs to the real body mount instead of leaving
  // it unknown and letting the narrator invent an (impossible) adapter.
  if (deriveItemType(text) === "camera-body") {
    for (const m of parseMounts(mountOf(text))) mounts.add(m);
    coverage = biggerCoverage(coverage, coverageOf(text, "camera-body"));
  }
  for (const q of queries) {
    try {
      const r: any[] = await c.query(api.catalog.listListings, { search: q });
      for (const l of (r || []).slice(0, 4)) {
        if (l.itemType !== "camera-body") continue;
        if (!toksList.some((t) => String(l.title || "").toLowerCase().includes(t))) continue;
        for (const m of parseMounts(l.specs?.mount)) mounts.add(m);
        coverage = biggerCoverage(coverage, l.specs?.coverage ?? null);
      }
    } catch {}
  }
  return { mounts: [...mounts], coverage };
}

async function loadContext(body: any): Promise<Ctx> {
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const ctx: Ctx = {
    c, memberPct: 0, memberName: null, favorites: [], favTitles: [], activeBooking: null,
    camMounts: [], camCoverage: null, customerName: "there", email: null, pastTitles: [], cartTitles: [], cartIds: [],
    today, estimated: false, start: "", end: "", pricePref: "any",
  };
  const camSet = new Set<string>();
  // account: name, membership, favourites, bookings
  if (body?.token) {
    try {
      const me: any = await c.query(api.accounts.me, { token: body.token });
      if (me) {
        ctx.email = me.email ?? null;
        ctx.customerName = me.name || (me.email ? me.email.split("@")[0] : "there");
        const tier = me.membershipActive ? tierByKey(me.membershipTier) : null;
        ctx.memberPct = tier?.pct ?? 0;
        ctx.memberName = tier?.name ?? null;
        ctx.favorites = (me.favorites ?? []).map((x: any) => String(x));
        if (ctx.favorites.length) {
          try {
            const favs: any[] = await c.query(api.catalog.listingsByIds, { ids: ctx.favorites as any });
            ctx.favTitles = (favs || []).map((f) => f.title);
          } catch {}
        }
        const bk: any = await c.query(api.accounts.myBookings, { token: body.token });
        const past: any[] = Array.isArray(bk) ? bk : [];
        ctx.pastTitles = (past[0]?.lineItems ?? []).map((li: any) => li.title).slice(0, 4);
        const openB = past.find((b: any) => ["confirmed", "pending", "reserved", "active", "paid"].includes(String(b.status).toLowerCase()));
        if (openB && openB.lineItems?.[0]) {
          ctx.activeBooking = { id: openB._id, start: openB.lineItems[0].start, end: openB.lineItems[0].end, label: openB.lineItems[0].title };
        }
      }
    } catch {}
  }
  // cart: contents (so Gaffer knows what's already in their kit) + camera mounts
  if (Array.isArray(body?.cart) && body.cart.length) {
    try {
      const ids = body.cart.map((x: any) => x.listingId).filter(Boolean);
      if (ids.length) {
        const cds: any[] = await c.query(api.catalog.listingsByIds, { ids });
        ctx.cartIds = cds.map((cd) => String(cd._id));
        ctx.cartTitles = cds.map((cd) => cd.title);
        for (const cd of cds) if (cd.itemType === "camera-body") {
          for (const m of parseMounts(cd.specs?.mount)) camSet.add(m);
          ctx.camCoverage = biggerCoverage(ctx.camCoverage, cd.specs?.coverage ?? null);
        }
      }
    } catch {}
  }
  ctx.camMounts = [...camSet];
  return ctx;
}

// ── stage 1: understand ───────────────────────────────────────────────────────────
const IntentSchema = z.object({
  intent: z.enum(["availability", "alternative", "recommend", "build_kit", "spec", "price", "compatibility", "support", "other"])
    .describe("availability=do you have X; alternative=suggest a substitute for X; recommend=suggest gear of a type; build_kit=assemble a full kit; spec=specs/limits of X; price=cost of X; compatibility=will/can X work with/fit/mount on Y; support=complaint/damage/refund/cancellation/dispute; other=greeting/policy/chitchat"),
  subject: z.string().describe("the SPECIFIC item the customer named (the LENS/gear for a compatibility question), verbatim-ish, or empty string"),
  itemTypes: z.array(z.string()).describe("gear types from [camera,lens,light,gimbal,mic,monitor,tripod,nd-filter,battery,drone,speaker]"),
  cameraModel: z.string().describe("the camera model OR mount in play (e.g. 'FX3', 'Sony E mount') — for a compatibility question this is the BODY they want to fit the subject onto; else empty"),
  pricePref: z.enum(["cheaper", "premium", "any"]).describe("cheaper=they want budget/cheaper/affordable; premium=best/top-end; any=no preference"),
  start: z.string().optional().describe("rental start YYYY-MM-DD if stated/derivable, else omit"),
  end: z.string().optional().describe("rental end YYYY-MM-DD if stated/derivable, else omit"),
});

async function understand(model: any, history: any[], today: string): Promise<z.infer<typeof IntentSchema>> {
  const convo = history.map((m: any) => `${m.role === "user" ? "CUSTOMER" : "GAFFER"}: ${String(m.content || "")}`).join("\n");
  const { object } = await generateObject({
    model,
    schema: IntentSchema,
    prompt:
      `You parse a camera-rental chat into a structured intent for a downstream engine. ` +
      `Today is ${today} (Europe/London). RESOLVE relative dates to concrete YYYY-MM-DD and NEVER output a past date: ` +
      `"today"=today; "tomorrow"=+1; "this weekend"=the coming Saturday→Sunday; "next week"=the coming Mon→Fri; "for N days from <date>" → start..start+N-1. If only a single day is given, set start=end. ` +
      `Focus on the customer's LATEST message, using earlier turns only for context (e.g. a camera named earlier). ` +
      `"subject" = the exact gear they referenced (copy their words). For "alternative to X"/"do you have X"/"can I use X on Y", subject is X.\n\nCONVERSATION:\n${convo}\n\nReturn the intent.`,
  });
  return object;
}

// ── stage 2: execute (deterministic — the source of truth) ──────────────────────
type ExecResult = { cards: any[]; facts: string[]; askDates: boolean };

async function execute(intent: z.infer<typeof IntentSchema>, ctx: Ctx): Promise<ExecResult> {
  const c = ctx.c;
  // camera mounts: cart + the model's cameraModel + the subject text
  const camSet = new Set<string>(ctx.camMounts);
  for (const t of [intent.cameraModel, intent.subject].filter(Boolean)) {
    const res = await camMountsFromText(c, String(t));
    for (const m of res.mounts) camSet.add(m);
    ctx.camCoverage = biggerCoverage(ctx.camCoverage, res.coverage);
  }
  ctx.camMounts = [...camSet];

  ctx.pricePref = (intent.pricePref as any) || "any";
  const { start, end, estimated } = safeDates(intent.start, intent.end, ctx.today);
  ctx.estimated = estimated;
  ctx.start = start;
  ctx.end = end;
  const facts: string[] = [];
  const cards: any[] = [];
  const primaryType = intent.itemTypes?.[0] || "";
  if (ctx.cartTitles.length) facts.push(`Already in the customer's cart (don't re-recommend these): ${ctx.cartTitles.join("; ")}.`);

  const pushCard = async (l: any, reason: string, checkAvail = true) => {
    if (cards.some((cd) => cd.item?.listingId === l._id)) return;
    cards.push(await buildCard(c, l, start, end, ctx, reason, checkAvail));
  };
  const titlePrice = (l: any) => `"${l.title}" (£${l.pricing?.daily}/day)`;

  switch (intent.intent) {
    case "availability": {
      const lst = await resolveSubjectListing(c, intent.subject, { camMounts: ctx.camMounts, itemType: primaryType || undefined });
      if (lst) {
        await pushCard(lst, "In stock for your dates");
        const card = cards[cards.length - 1];
        const availTxt = estimated
          ? `Tell me your dates and I'll confirm.`
          : card?.item?.available ? `Available ${start} to ${end}.` : `Not free ${start} to ${end} — I can suggest a close alternative.`;
        facts.push(`IN STOCK: we DO carry ${titlePrice(lst)}. ${availTxt}`);
        if (!estimated && card && !card.item.available) {
          const alts = await findAlternatives(c, intent.subject, lst.itemType || primaryType || "lens", ctx, 2, String(lst._id), subjectMounts(intent.subject, lst));
          for (const a of alts) await pushCard(a, "Available alternative");
          if (alts.length) facts.push(`Free for those dates instead: ${alts.map(titlePrice).join("; ")}.`);
        }
      } else {
        facts.push(`NOT STOCKED: we do not carry "${intent.subject}".`);
        const alts = await findAlternatives(c, intent.subject, primaryType || "lens", ctx, 3, undefined, subjectMounts(intent.subject, null));
        for (const a of alts) await pushCard(a, "Closest we stock");
        if (alts.length) facts.push(`Closest we DO stock: ${alts.map(titlePrice).join("; ")}.`);
      }
      break;
    }
    case "alternative": {
      const subj = await resolveSubjectListing(c, intent.subject, { camMounts: ctx.camMounts, itemType: primaryType || undefined });
      const type = subj?.itemType || primaryType || "lens";
      // an alternative must share the subject's mount when no camera is named (E-lens → E-lens).
      // findAlternatives homogenises by mountHint (or infers from the top match) deterministically.
      const alts = await findAlternatives(c, intent.subject, type, ctx, 4, subj ? String(subj._id) : undefined, subjectMounts(intent.subject, subj));
      for (const a of alts) await pushCard(a, "Alternative we stock");
      if (subj) facts.push(`We also stock the original ${titlePrice(subj)} if you'd prefer it.`);
      if (alts.length) facts.push(`Alternatives we stock for "${intent.subject}": ${alts.map(titlePrice).join("; ")}.`);
      else facts.push(`We have no in-stock alternative matching "${intent.subject}" for that camera.`);
      break;
    }
    case "spec": {
      const subj = await resolveSubjectListing(c, intent.subject, { camMounts: ctx.camMounts, itemType: primaryType || undefined });
      if (subj) {
        const full: any = await c.query(api.catalog.getListingBySlug, { slug: subj.slug });
        const k = full?.knowledge || {};
        await pushCard(subj, "The item you asked about");
        facts.push(
          `ITEM ${titlePrice(subj)}${subj.specs?.mount ? ` — ${subj.specs.mount} mount` : ""}. ` +
          `${k.summary ? `Summary: ${k.summary}. ` : ""}${(k.features || []).length ? `Features: ${(k.features || []).join(", ")}. ` : ""}` +
          `${(k.limits || []).length ? `Real limits: ${(k.limits || []).join(", ")}. ` : ""}${(k.pairsWith || []).length ? `Pairs with: ${(k.pairsWith || []).join(", ")}.` : ""}`,
        );
        facts.push(`Only state the specs/limits listed above — do not add others.`);
      } else {
        facts.push(`NOT STOCKED: we do not carry "${intent.subject}", so no spec sheet to share.`);
      }
      break;
    }
    case "price": {
      const subj = await resolveSubjectListing(c, intent.subject, { camMounts: ctx.camMounts, itemType: primaryType || undefined });
      if (subj) {
        await pushCard(subj, estimated ? "Priced for an example window" : "Priced for your dates");
        const card = cards[cards.length - 1];
        facts.push(`PRICE: ${titlePrice(subj)} is £${card.item.perDay}/day, £${card.item.total} total for ${card.item.days} day(s)${estimated ? " (example dates — give me yours to confirm)" : ` (${start}→${end})`}.`);
      } else {
        facts.push(`NOT STOCKED: we do not carry "${intent.subject}".`);
      }
      break;
    }
    case "recommend": {
      const types = intent.itemTypes?.length ? intent.itemTypes : ["lens"];
      const seen = new Set<string>(ctx.cartIds);
      for (const t of types) {
        const best = await bestForType(c, t, ctx, seen);
        if (best) { seen.add(String(best._id)); await pushCard(best, `Recommended ${t}`); }
      }
      // a couple more of the primary type for choice
      if (types.length === 1) {
        const term = TERM[types[0]] || types[0];
        const r: any[] = await c.query(api.catalog.listListings, { search: term });
        const more = (r || []).filter((x) => !seen.has(String(x._id)) && itemTypeMatches(types[0], x.itemType));
        for (const x of more.slice(0, 0)) void x; // placeholder; primary pick above is enough
        const extra = await findAlternatives(c, intent.subject || types[0], types[0], ctx, 2);
        for (const a of extra) { if (!seen.has(String(a._id))) { seen.add(String(a._id)); await pushCard(a, `Another ${types[0]} option`); } }
      }
      const names = cards.map((cd) => titlePrice(cd.item)).join("; ");
      if (names) facts.push(`RECOMMENDED (in stock${ctx.camMounts.length ? `, compatible with ${ctx.camMounts.join("/")} mount` : ""}): ${names}.`);
      else facts.push(`No matching in-stock gear found for ${types.join(", ")}.`);
      break;
    }
    case "build_kit": {
      const types = intent.itemTypes?.length ? intent.itemTypes : ["camera", "lens", "light", "mic"];
      const seen = new Set<string>(ctx.cartIds);
      for (const t of types) {
        if (cards.length >= 6) break;
        const best = await bestForType(c, t, ctx, seen);
        if (best) { seen.add(String(best._id)); await pushCard(best, `Kit ${t}`); }
      }
      const names = cards.map((cd) => titlePrice(cd.item)).join("; ");
      facts.push(names ? `KIT (in stock): ${names}.` : `Could not assemble a kit from stock.`);
      break;
    }
    case "compatibility": {
      // subject = the lens/gear; ctx.camMounts = the body to fit it on
      const subj = await resolveSubjectListing(c, intent.subject, { camMounts: ctx.camMounts, itemType: "lens" });
      const cam = ctx.camMounts;
      if (subj && subj.itemType === "lens") {
        const verdict = cam.length ? bestCompat(parseMounts(subj.specs?.mount), cam) : "unknown";
        if (verdict === "incompatible") {
          facts.push(`COMPATIBILITY: ${titlePrice(subj)} is ${subj.specs?.mount} mount and will NOT fit a ${cam.join("/")}-mount body, even with an adapter.`);
          const alts = await findAlternatives(c, intent.subject, "lens", ctx, 3, String(subj._id));
          for (const a of alts) await pushCard(a, "Compatible alternative");
          if (alts.length) facts.push(`Compatible instead: ${alts.map(titlePrice).join("; ")}.`);
        } else if (verdict === "adapter") {
          await pushCard(subj, "Fits via adapter");
          const adapter = await resolveSubjectListing(c, `${subj.specs?.mount} to ${cam[0]} adapter`, {});
          if (adapter) await pushCard(adapter, "The adapter you'd need");
          facts.push(`COMPATIBILITY: ${titlePrice(subj)} (${subj.specs?.mount}) fits a ${cam.join("/")}-mount body VIA AN ADAPTER${adapter ? ` — we stock the ${adapter.title} (£${adapter.pricing?.daily}/day)` : ` (a ${subj.specs?.mount}→${cam[0]} adapter is required)`}; autofocus/electronics may be limited.`);
        } else {
          await pushCard(subj, "Compatible with your camera");
          facts.push(`COMPATIBILITY: ${titlePrice(subj)} ${cam.length ? `is NATIVE ${cam.join("/")} mount — fits directly, no adapter needed` : "is in stock"}.`);
        }
      } else {
        facts.push(`NOT STOCKED: we don't carry "${intent.subject}".`);
        if (cam.length) facts.push(`Mount rule for a ${cam.join("/")}-mount body: native ${cam[0]} glass fits directly; EF/PL glass needs an adapter; RF/MFT won't fit. Answer the can-it-be-used question with this rule.`);
        const alts = await findAlternatives(c, intent.subject, "lens", ctx, 3);
        for (const a of alts) await pushCard(a, "Compatible option we stock");
        if (alts.length) facts.push(`Compatible options we stock: ${alts.map(titlePrice).join("; ")}.`);
      }
      break;
    }
    case "support": {
      facts.push(`SUPPORT / OUT-OF-SCOPE (damage, refund, cancellation, complaint or dispute): do NOT try to resolve it, admit fault, or promise a refund. Be warm and apologetic, and tell them our team handles these directly — they can reach the team via the Contact page (dbcinemarentals.com/contact).`);
      break;
    }
    default: {
      // greeting / policy / chitchat — no cards, but make favourites known
      if (ctx.favTitles.length) facts.push(`This customer's saved favourites: ${ctx.favTitles.join(", ")}.`);
      facts.push(`No specific gear was requested; answer helpfully and invite them to name a camera, gear type, or dates.`);
      break;
    }
  }

  // single-type discipline: a one-type ask shows only that type
  if (intent.itemTypes?.length === 1 && intent.intent !== "build_kit") {
    const want = intent.itemTypes[0];
    const filtered = cards.filter((cd) => itemTypeMatches(want, cd.item?.itemType));
    if (filtered.length) return { cards: filtered, facts, askDates: estimated };
  }
  return { cards, facts, askDates: estimated };
}

// ── stage 3: narrate (grounded — only states facts, only names the chosen cards) ──
const NarrateSchema = z.object({
  reply: z.string().describe("the conversational reply to the customer, 1-3 sentences"),
  suggestions: z.array(z.string()).describe("exactly 2-3 short next actions in the customer's voice, max 5 words each"),
});

async function narrate(model: any, history: any[], result: ExecResult, ctx: Ctx): Promise<{ reply: string; suggestions: string[] }> {
  const cardLines = result.cards.map((cd) => `- ${cd.item.title} — £${cd.item.perDay}/day${cd.item.favorite ? " (their saved favourite)" : ""}${cd.item.available === false ? " (NOT free for the requested dates)" : ""}`).join("\n") || "(no cards)";
  const who = `Customer: ${ctx.customerName}.${ctx.memberName ? ` ${ctx.memberName} member — apply their ${ctx.memberPct}% discount and mention the saving.` : ""}${ctx.favTitles.length ? ` Saved favourites: ${ctx.favTitles.join(", ")}.` : ""}${ctx.cartTitles.length ? ` Currently in their cart: ${ctx.cartTitles.join(", ")}.` : ""}${ctx.pastTitles.length ? ` Previously rented: ${ctx.pastTitles.join(", ")}.` : ""}`;
  const convo = history.slice(-6).map((m: any) => `${m.role === "user" ? "CUSTOMER" : "GAFFER"}: ${String(m.content || "")}`).join("\n");
  const { object } = await generateObject({
    model,
    schema: NarrateSchema,
    prompt:
`You are Gaffer, Db Cinema Rentals' kit assistant — warm, confident, plain English, lightly playful, concise (1-3 sentences). London cinema-gear rental shop.

ABSOLUTE GROUNDING RULES (never break):
- State ONLY what the FACTS below say. Do NOT claim we have, lack, or recommend any gear not in FACTS/CARDS.
- The CARDS listed below are the EXACT bookable tiles the customer sees. Reference only those items by name (you may **bold** them). Never name gear that isn't in CARDS or FACTS.
- If a FACT says NOT STOCKED for a specific item, say we don't have THAT specific item — never generalise to a whole brand or category (we may stock other gear from it) — then point them to the alternative CARDS shown.
- Never invent specs, prices, availability, or model names. Never say "let me check" or promise a later message — everything is already decided here.
- If ${result.askDates ? "TRUE" : "FALSE"} is TRUE, ask for their shoot dates in ONE short question (the card prices shown are for example dates).
${ctx.favTitles.length ? "- If relevant, acknowledge their saved favourites naturally." : ""}

${who}

FACTS (the only truth you may use):
${result.facts.map((f) => "- " + f).join("\n")}

CARDS shown to the customer:
${cardLines}

CONVERSATION:
${convo}

Write Gaffer's reply now, plus 2-3 suggestion chips in the customer's voice.`,
  });
  return { reply: object.reply?.trim() || "How can I help with your shoot?", suggestions: (object.suggestions || []).filter((s) => s && s.length <= 56).slice(0, 3) };
}

// ── orchestrator ──────────────────────────────────────────────────────────────────
export async function handleChat(body: any): Promise<{ reply: string; cards: any[]; suggestions: string[]; booking: any }> {
  if (!process.env.OPENROUTER_API_KEY) return { reply: "The assistant isn't configured yet.", cards: [], suggestions: [], booking: null };
  const history = Array.isArray(body?.messages) ? body.messages.slice(-12) : [];
  const model = botModel();
  const ctx = await loadContext(body);
  // camera mounts from the whole conversation
  const allUserText = history.filter((m: any) => m.role === "user").map((m: any) => String(m.content || "")).join("  \n  ");
  try {
    const res = await camMountsFromText(ctx.c, allUserText);
    for (const m of res.mounts) if (!ctx.camMounts.includes(m)) ctx.camMounts.push(m);
    ctx.camCoverage = biggerCoverage(ctx.camCoverage, res.coverage);
  } catch {}

  const intent = await understand(model, history, ctx.today);
  // deterministic relative-date backstop: if the LLM left dates unresolved, derive them
  // from the latest user message ("this weekend", "tomorrow", "next week").
  if (!intent.start || !intent.end) {
    const lastUser = [...history].reverse().find((m: any) => m.role === "user")?.content || "";
    const rel = resolveRelativeDates(String(lastUser), ctx.today);
    if (rel.start) { intent.start = intent.start || rel.start; intent.end = intent.end || rel.end; }
  }
  const result = await execute(intent, ctx);
  const { reply, suggestions } = await narrate(model, history, result, ctx);
  return { reply, cards: result.cards, suggestions, booking: ctx.activeBooking };
}
