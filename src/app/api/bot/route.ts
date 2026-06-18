import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { mastra } from "@/mastra";
import { quote } from "@/lib/pricing";
import { tierByKey } from "@/lib/membership";
import { dayMs as msOf } from "@/lib/dates";
import { lensScore, bestCompat, parseMounts } from "@/lib/mount";
import { generateText } from "ai";
import { botModel } from "@/lib/ai";

// deterministic, grounded Q&A: retrieve item knowledge then answer with a plain LLM call
async function knowledgeAnswer(c: ConvexHttpClient, userMsg: string, memberPct: number): Promise<string | null> {
  try {
    const STOP = new Set(["what", "are", "the", "limitations", "limits", "of", "and", "or", "should", "i", "pair", "with", "it", "does", "do", "work", "for", "an", "my", "to", "is", "can", "you", "will", "how", "much", "price", "about", "tell", "me", "on", "use", "using", "need", "that", "this", "they", "them", "get", "have", "has", "which", "good", "best", "vs", "compatible", "compatibility", "lens", "camera"]);
    const allToks = (userMsg.toLowerCase().match(/[a-z0-9][a-z0-9-]+/g) || []).filter((t) => !STOP.has(t));
    const distinctive = allToks.filter((t) => /\d/.test(t) || t.length >= 4);
    const queries = [distinctive.join(" "), allToks.join(" "), ...distinctive].filter(Boolean);
    let top: any[] = [];
    for (const qy of queries) {
      const r: any[] = await c.query(api.catalog.listListings, { search: qy });
      if (r && r.length) { top = r.slice(0, 3); break; }
    }
    const facts: string[] = [];
    for (const r of top) {
      const l: any = await c.query(api.catalog.getListingBySlug, { slug: r.slug });
      const k = l?.knowledge;
      if (!k) continue;
      facts.push(
        `${l.title} [${l.category}${l.specs?.mount ? `, ${l.specs.mount} mount` : ""}]: ${k.summary}. Features: ${(k.features || []).join(", ")}. Limits: ${(k.limits || []).join(", ")}. Pairs with: ${(k.pairsWith || []).join(", ")}. From £${l.pricing?.daily}/day${memberPct ? ` (£${Math.round((l.pricing?.daily || 0) * (1 - memberPct / 100))}/day for you as a member)` : ""}.`,
      );
    }
    if (!facts.length) return null;
    const { text } = await generateText({
      model: botModel() as any,
      prompt: `You are the Db Cinema rental assistant. Answer the customer's question concisely (2-4 sentences, warm, plain language) using ONLY these facts. Be specific about limits and compatibility — lens mounts: Sony = E, Canon mirrorless = RF, Canon EF needs an EF→E/RF adapter, cine/PL is manual. IMPORTANT: only LENSES are mount-specific. Gimbals, tripods, monitors, lights, audio, ND filters and batteries are NOT mount-specific — judge a gimbal by payload weight (it holds any camera within its limit), a monitor/recorder by its inputs, an ND by filter-thread. Never say a gimbal/monitor/tripod is incompatible because of lens mount. Never invent specs.\n\nFACTS:\n${facts.join("\n")}\n\nCUSTOMER: ${userMsg}\n\nANSWER:`,
    });
    return text?.trim() || null;
  } catch {
    return null;
  }
}

export const maxDuration = 60;

const OUT = z.object({
  reply: z.string().describe("short conversational reply to the customer"),
  start: z.string().optional().describe("rental start YYYY-MM-DD if known"),
  end: z.string().optional().describe("rental end YYYY-MM-DD if known"),
  wantsKit: z.boolean().optional().describe("true if the customer wants gear recommended or a kit built"),
  itemTypes: z
    .array(z.string())
    .optional()
    .describe("gear types to include, e.g. ['camera','lens','gimbal','light','nd-filter','battery','monitor','mic','tripod']"),
  proposals: z.array(z.object({ slug: z.string(), reason: z.string() })).optional(),
  swaps: z.array(z.object({ removeSlug: z.string(), addSlug: z.string(), reason: z.string() })).optional(),
  suggestions: z
    .array(z.string())
    .max(3)
    .optional()
    .describe(
      "2-3 short follow-up actions the customer would plausibly tap next, phrased in THEIR voice (e.g. 'Add a tripod', 'What about low light?', 'Cheaper option?'). Max 5 words each.",
    ),
});

/** Persona + behaviour rules, prepended to every conversation. */
function styleBlock() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  return [
    `Today is ${today} (Europe/London). Resolve relative or partial dates ("this weekend", "12-14 July") against this date — never book the past; if a month/day has passed this year, assume next year.`,
    "You are Gaffer, Db Cinema Rentals' kit assistant — a sharp, friendly camera-department veteran. Voice: warm, confident, plain English, lightly playful, zero corporate filler. You may use **bold** for gear names or key figures, never headers or lists of more than 4 items.",
    "Keep replies to 1-3 sentences unless the customer asks for depth. Always move the booking forward: if dates are missing ask for them (one question only); if a kit lacks an essential (media, batteries, sound, support), say so and propose it.",
    "When you mention specific rentable gear, **bold its exact catalogue name** — every bolded name automatically becomes a bookable tile (photo, live price for their dates, Add-to-kit button) right in the chat. Prefer naming 1-3 concrete items over generic advice, and also include them in proposals. Never invent gear, specs or prices.",
    "Fill `suggestions` with 2-3 short next actions in the customer's voice. Make them specific to the conversation, not generic.",
  ].join(" ");
}

const TERM: Record<string, string> = {
  "camera-body": "camera", camera: "camera", lens: "lens", lenses: "lens",
  gimbal: "gimbal", light: "light", lighting: "light", "nd-filter": "filter",
  filter: "filter", battery: "battery", monitor: "monitor", "wireless-mic": "mic",
  mic: "mic", audio: "mic", tripod: "tripod", drone: "drone", speaker: "speaker",
};

/** Slot type → the catalogue itemType(s) a resolved card MUST match, so a
 * loose full-text hit can never surface (e.g.) a teleprompter as a "camera".
 * Slots not listed here are unconstrained. */
const EXPECTED_ITEMTYPES: Record<string, string[]> = {
  camera: ["camera-body"], "camera-body": ["camera-body"],
  lens: ["lens"], lenses: ["lens"],
  gimbal: ["gimbal"], light: ["light"], lighting: ["light"],
  "nd-filter": ["nd-filter"], filter: ["nd-filter"],
  battery: ["battery"], monitor: ["monitor"],
  "wireless-mic": ["wireless-mic", "boom-mic"], mic: ["wireless-mic", "boom-mic"], audio: ["wireless-mic", "boom-mic"],
  tripod: ["tripod"], drone: ["drone"], speaker: ["speaker"],
};

/** True when `itemType` satisfies the expected itemType(s) for `slot`.
 * Unknown slots (no constraint) always pass. */
function itemTypeMatches(slot: string, itemType: string | null | undefined): boolean {
  const expected = EXPECTED_ITEMTYPES[slot];
  if (!expected) return true; // no constraint for this slot
  return !!itemType && expected.includes(itemType);
}

/** Find camera bodies whose title is mentioned in free text and collect their
 * mounts. Net effect: "I have an FX3" ⇒ ["E"] even with an empty cart. */
async function camMountsFromText(c: ConvexHttpClient, text: string): Promise<string[]> {
  if (!text || !text.trim()) return [];
  // distinctive model-ish tokens (fx3, a7siii, komodo, gh6, r5…) — alnum, len>=2, must contain a digit OR be a known body word
  const toks = (text.toLowerCase().match(/[a-z][a-z0-9]{1,}[a-z0-9]/g) || [])
    .filter((t) => /\d/.test(t) || /(komodo|raptor|alexa|amira|burano|venice|ursa|komodo)/.test(t));
  const queries = Array.from(new Set([...toks, text.trim()])).slice(0, 6);
  const mounts = new Set<string>();
  for (const q of queries) {
    try {
      const r: any[] = await c.query(api.catalog.listListings, { search: q });
      for (const l of (r || []).slice(0, 4)) {
        if (l.itemType !== "camera-body") continue;
        // require the model token to actually appear in the title to avoid loose matches
        const title = String(l.title || "").toLowerCase();
        if (!toks.some((t) => title.includes(t))) continue;
        for (const m of parseMounts(l.specs?.mount)) mounts.add(m);
      }
    } catch {}
  }
  return [...mounts];
}

/** Score & pick the best lens from a candidate pool for a camera-mount set.
 * Excludes incompatible (-Infinity) glass; ties broken by cheaper day-rate.
 * Returns null if nothing is compatible/available. */
function pickBestLens(cands: any[], camMounts: string[]): any {
  let best: any = null, bestScore = -Infinity;
  for (const it of cands) {
    const s = lensScore({ mount: it.mount, tier: it.tier ?? it.specs?.tier, lensClass: it.lensClass }, camMounts);
    if (s === -Infinity) continue; // incompatible — never offer
    const cheaper = best && s === bestScore && (it.perDay ?? Infinity) < (best.perDay ?? Infinity);
    if (s > bestScore || cheaper) { bestScore = s; best = it; }
  }
  return best;
}

/** Three-state lens-card guard for LLM-proposed / prose-mentioned glass.
 * Mirrors the ranking engine's `bestCompat` instead of the boolean `lensFits`:
 *   - "incompatible" ⇒ drop the card outright (e.g. an RF lens for an E body).
 *   - "adapter"      ⇒ keep, but flag so the UI never presents it as native.
 *   - native/unknown ⇒ keep as-is (unknown = no camera known, don't regress).
 * Only constrains when camMounts is non-empty (no-camera case ⇒ unknown ⇒ keep).
 * Returns { drop, adapter } so callers decide presentation. */
function classifyLensCard(lensMount: string | null | undefined, camMounts: string[]): { drop: boolean; adapter: boolean } {
  if (!camMounts?.length) return { drop: false, adapter: false }; // no camera ⇒ don't constrain
  const compat = bestCompat(parseMounts(lensMount), camMounts);
  if (compat === "incompatible") return { drop: true, adapter: false };
  return { drop: false, adapter: compat === "adapter" };
}

/** Append a one-time "(adapter needed)" note to a card reason so EF-on-E (etc.)
 * is never silently presented as native. Idempotent. */
function withAdapterNote(reason: string | null | undefined): string {
  const base = (reason ?? "").trim();
  if (/\(adapter needed\)/i.test(base)) return base;
  return base ? `${base} (adapter needed)` : "Fits via adapter (adapter needed)";
}

/** Lowercase alphanumeric tokens (len>=2) of a string. */
function toks(s: string): string[] {
  return (String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length >= 2);
}

/** Strip SEO comparison clauses from a catalogue title — "(like Sony FX6 / A7SIII)",
 * "(such as …)" — so a request for an FX6 doesn't resolve to an FX3 kit that merely
 * NAMES the FX6 as a comparison. These clauses are advertising, not the product. */
function stripCompare(s: string): string {
  return String(s || "").replace(/\((?:like|such as|similar to|comparable to|vs\.?|alternative to)[^)]*\)/gi, " ");
}

/** Spacing/punctuation variants of a search term so a model designator typed one way
 * ("FX6") still finds a listing titled the other way ("Sony fx 6"). listListings does
 * a substring match, so "fx6" ≠ "fx 6" without this. Returns a small deduped set. */
function searchVariants(term: string): string[] {
  const t = term.toLowerCase().trim();
  const spaced = t.replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2"); // fx6 -> fx 6
  const despaced = t.replace(/([a-z])\s+(\d)/g, "$1$2").replace(/(\d)\s+([a-z])/g, "$1$2"); // fx 6 -> fx6
  return [...new Set([t, spaced, despaced].filter(Boolean))];
}

/** True when a full-text fallback hit genuinely matches the name the model/prose
 * asked for — so "Sony FX6 Kit" (which we don't own) can't silently resolve to a
 * random "Sony …" listing and surface a wrong card. Model designators (letter+digit
 * tokens like fx6/a7iv/r5/70mm) are the item's identity and MUST appear in the title
 * (token-set OR ordered-concat substring, so "a7iv" still matches "Sony a7 IV").
 * Otherwise require a majority of the distinctive word tokens to overlap. */
function titleMatchesQuery(queryText: string, title: string): boolean {
  const qt = toks(queryText);
  if (!qt.length) return false;
  const cleanTitle = stripCompare(title);
  const tt = new Set(toks(cleanTitle));
  // despaced run of ALL alphanumerics (keeps single digits) so a split model number
  // ("fx 6") still contains the joined form ("fx6"). toks() drops len<2, so don't use it here.
  const titleJoined = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
  const has = (t: string) => tt.has(t) || (t.length >= 3 && titleJoined.includes(t));
  const models = qt.filter((t) => /[a-z]\d|\d[a-z]/.test(t)); // fx6, a7iv, r5, 70mm, f2
  if (models.length) return models.every(has);
  const words = qt.filter((t) => t.length >= 4);
  const pool = words.length ? words : qt;
  const hits = pool.filter(has).length;
  return hits >= 1 && hits / pool.length >= 0.5;
}

/** Cheap quality score for ranking non-lens kit-fill candidates by title/price, so a
 * "camera" slot prefers a real cinema body over the alphabetically-first action cam.
 * Mirrors catalog.bestSellers' demand heuristic (no extra queries). */
function nonLensQuality(l: any, slot: string): number {
  const t = String(l.title || "").toLowerCase();
  let s = 0;
  if (/\b(kit|set|bundle|package)\b/.test(t)) s += 2;
  if (/fx3|fx6|fx9|a7s|a7 ?iii|a7iv|a7r|burano|venice|komodo|raptor|alexa|amira|ursa|c70|c300|c500|ronin|fs7|fs5/.test(t)) s += 3;
  if (slot === "camera" || slot === "camera-body") {
    if (/osmo|action cam|gopro|\bpocket\b|insta ?360|webcam|action [45]/.test(t)) s -= 6;
  }
  s += Math.min(3, Math.floor((l.pricing?.daily ?? 0) / 50));
  return s;
}

/** Gear types explicitly implied by a user message, so "recommend a lens" fills a
 * lens — not a full camera+lens+light+mic kit. Empty ⇒ nothing specific implied. */
function impliedTypes(text: string): string[] {
  const t = String(text || "").toLowerCase();
  const out: string[] = [];
  if (/\blens(es)?\b|\bprime\b|\bzoom\b|\bglass\b/.test(t)) out.push("lens");
  if (/\bcamera\b|\bbody\b|\bbodies\b|\bcam\b/.test(t)) out.push("camera");
  if (/\blight(s|ing)?\b/.test(t)) out.push("light");
  if (/\bgimbal\b|stabili[sz]er|\bronin\b/.test(t)) out.push("gimbal");
  if (/\bmic\b|\baudio\b|\bsound\b|\bboom\b|lavalier|\blav\b/.test(t)) out.push("mic");
  if (/\bmonitor\b/.test(t)) out.push("monitor");
  if (/\btripod\b|\bsticks\b/.test(t)) out.push("tripod");
  if (/\bnd\b|\bfilter\b/.test(t)) out.push("nd-filter");
  if (/\bbatter(y|ies)\b|\bpower\b/.test(t)) out.push("battery");
  if (/\bdrone\b/.test(t)) out.push("drone");
  return [...new Set(out)];
}

/** Drop sentences that merely defer ("let me check…") so a reply shipped WITH real
 * cards doesn't also promise a follow-up message that never comes. */
function stripDeferral(reply: string): string {
  const parts = String(reply || "").split(/(?<=[.!?])\s+/);
  const kept = parts.filter(
    (s) =>
      !/\b(let me|i['’]?ll|one moment|give me a moment|hang on|i will (check|get|pull|look)|will check|getting (that|the)|pulling up|looking (it|that) up)\b/i.test(s),
  );
  return kept.join(" ").trim();
}

/** Does a bolded prose name resolve to a REAL catalogue listing (ignoring
 * availability)? Used to catch availability hallucinations ("Yes, we have X" when
 * no X exists). Returns the listing or null. */
async function resolveNameToListing(c: ConvexHttpClient, name: string): Promise<any | null> {
  const q = name.replace(/^\d+\s*[x×]\s*/i, "").trim();
  if (q.length < 3) return null;
  const slugHit: any = await c.query(api.catalog.getListingBySlug, { slug: q.toLowerCase().replace(/[^a-z0-9]+/g, "-") });
  if (slugHit) return slugHit;
  for (const v of searchVariants(q)) {
    const r: any[] = await c.query(api.catalog.listListings, { search: v });
    const hit = (r || []).find((x: any) => titleMatchesQuery(q, x.title));
    if (hit) return hit;
  }
  return null;
}

async function buildOne(
  c: ConvexHttpClient,
  slugOrTerm: string,
  start: string,
  end: string,
  checkAvail = true,
  opts: { slot?: string; camMounts?: string[] } = {},
) {
  let l: any = await c.query(api.catalog.getListingBySlug, { slug: slugOrTerm });
  if (!l) {
    // full-text resolution — search spacing variants ("FX6"/"fx 6"), gather every hit,
    // then keep ONLY those whose title genuinely matches the requested name (comparison
    // clauses stripped), so an unknown/hallucinated name or a "(like FX6)" comparison
    // yields NO card rather than a confidently-wrong one. For a lens slot, rank the
    // survivors by lensScore so native/premium glass wins.
    const term = slugOrTerm.replace(/-/g, " ");
    const byId = new Map<string, any>();
    for (const v of searchVariants(term)) {
      const r: any[] = await c.query(api.catalog.listListings, { search: v });
      for (const x of r || []) byId.set(String(x._id), x);
    }
    const slot = opts.slot;
    let pool = [...byId.values()];
    if (slot) pool = pool.filter((x: any) => itemTypeMatches(slot, x.itemType));
    pool = pool.filter((x: any) => titleMatchesQuery(term, x.title)); // genuine-name gate
    const wantsLens = slot === "lens" || slot === "lenses" || (!slot && pool[0]?.itemType === "lens");
    if (wantsLens && pool.some((x: any) => x.itemType === "lens")) {
      const cam = opts.camMounts ?? [];
      let best: any = null, bestScore = -Infinity;
      for (const x of pool) {
        if (x.itemType !== "lens") continue;
        const s = lensScore({ mount: x.specs?.mount, tier: x.specs?.tier, lensClass: x.specs?.lensClass }, cam);
        if (s === -Infinity) continue; // incompatible
        const cheaper = best && s === bestScore && (x.pricing?.daily ?? Infinity) < (best.pricing?.daily ?? Infinity);
        if (s > bestScore || cheaper) { bestScore = s; best = x; }
      }
      l = best ?? null;
    } else {
      l = pool[0] ?? null;
    }
  }
  if (!l) return null;
  const days = Math.max(1, Math.round((msOf(end) - msOf(start)) / 86400000) + 1);
  let available = true;
  if (checkAvail) {
    const av: any = await c.query(api.availability.forListing, { listingId: l._id, start: msOf(start), end: msOf(end) });
    available = (av?.available ?? 0) > 0;
  }
  const q: any = quote(l.pricing, days);
  return {
    listingId: l._id, slug: l.slug, title: l.title, image: l.heroImage ?? null,
    start, end, days, perDay: q.perDay, total: q.total, deposit: l.depositAmount ?? 0, available,
    itemType: l.itemType ?? null, mount: l.specs?.mount ?? null, lensClass: l.specs?.lensClass ?? null,
    tier: l.specs?.tier ?? null,
    pricing: l.pricing,
  };
}

async function firstAvailableByType(c: ConvexHttpClient, type: string, start: string, end: string, seen: Set<string>, camMounts: string[] = []) {
  const term = TERM[type] || type;
  const r: any[] = await c.query(api.catalog.listListings, { search: term });
  if (type === "lens" || type === "lenses") {
    // gather ALL available candidate lenses, score every one (mount → native/
    // adapter/incompatible + tier + class), exclude incompatible, return the
    // highest score; ties broken by cheaper day-rate inside pickBestLens.
    const cands: any[] = [];
    for (const l of r || []) {
      if (seen.has(l._id)) continue;
      const item = await buildOne(c, l.slug, start, end, true);
      if (!item || !item.available) continue;
      if (!itemTypeMatches("lens", item.itemType)) continue; // itemType guard
      cands.push(item);
    }
    return pickBestLens(cands, camMounts);
  }
  // non-lens: RANK candidates by quality first (a real cinema body beats the
  // alphabetically-first action cam), enforce the itemType guard, then availability-
  // check only the top few in rank order and return the best available.
  const ranked = (r || [])
    .filter((l: any) => !seen.has(l._id) && itemTypeMatches(type, l.itemType))
    .map((l: any) => ({ l, qs: nonLensQuality(l, type) }))
    .sort((a, b) => b.qs - a.qs || (a.l.pricing?.daily ?? 0) - (b.l.pricing?.daily ?? 0))
    .slice(0, 10);
  for (const { l } of ranked) {
    const item = await buildOne(c, l.slug, start, end, true);
    if (!item || !item.available) continue;
    if (!itemTypeMatches(type, item.itemType)) continue; // itemType guard
    return item;
  }
  return null;
}

async function buildCards(c: ConvexHttpClient, out: any, camMounts: string[] = [], memberPct = 0, booking: any = null, estimated = false) {
  const cards: any[] = [];
  if (!out?.start || !out?.end) return cards;
  const bookingDays = booking ? Math.max(1, Math.round((booking.end - booking.start) / 86400000) + 1) : 0;
  const mp = (it: any) => {
    if (!it) return it;
    if (estimated) it.estimated = true;
    if (memberPct > 0) { it.memberPct = memberPct; it.memberTotal = Math.round(it.total * (1 - memberPct / 100)); }
    if (booking && it.pricing) {
      const q: any = quote(it.pricing, bookingDays);
      it.addonBookingId = booking.id;
      it.addonStart = booking.start;
      it.addonEnd = booking.end;
      it.addonTotal = q.total;
      it.addonLabel = booking.label;
    }
    return it;
  };
  const seen = new Set<string>();
  for (const p of out.proposals ?? []) {
    const item = await buildOne(c, p.slug, out.start, out.end, true);
    // never propose a lens that won't mount on the camera in the kit/known set.
    // Three-state (mount.ts bestCompat): incompatible ⇒ drop; adapter ⇒ keep but
    // flag "(adapter needed)" so EF-on-E is never presented as native.
    let reason = p.reason;
    if (item && item.itemType === "lens") {
      const { drop, adapter } = classifyLensCard(item.mount, camMounts);
      if (drop) continue;
      if (adapter) reason = withAdapterNote(reason);
    }
    if (item && item.available && !seen.has(item.listingId)) {
      seen.add(item.listingId);
      cards.push({ kind: "add", reason, item: mp(item) });
    }
  }
  for (const s of out.swaps ?? []) {
    const removed = await buildOne(c, s.removeSlug, out.start, out.end, false);
    const added = await buildOne(c, s.addSlug, out.start, out.end, true);
    // same three-state guard on the lens being swapped IN.
    let reason = s.reason;
    if (added && added.itemType === "lens") {
      const { drop, adapter } = classifyLensCard(added.mount, camMounts);
      if (drop) continue;
      if (adapter) reason = withAdapterNote(reason);
    }
    if (added && added.available && !seen.has(added.listingId)) {
      seen.add(added.listingId);
      cards.push({ kind: "swap", reason, removed, added: mp(added) });
    }
  }
  // deterministic kit fill: guarantee available cards even if the model's slugs miss
  if (out.wantsKit && cards.length < 5) {
    const types = out.itemTypes?.length ? out.itemTypes : ["camera", "lens", "light"];
    for (const t of types) {
      if (cards.length >= 6) break;
      const item = await firstAvailableByType(c, t, out.start, out.end, seen, camMounts);
      if (item) {
        seen.add(item.listingId);
        cards.push({ kind: "add", reason: `Recommended ${t}`, item: mp(item) });
      }
    }
  }
  return cards;
}

/** Native gear tiles from prose: every **bolded** name in the reply is
 * resolved against the catalogue and becomes a bookable card. */
async function cardsFromMentions(
  c: ConvexHttpClient,
  reply: string,
  start: string,
  end: string,
  seenIds: Set<string>,
  camMounts: string[],
  memberPct: number,
  booking: any,
  estimated: boolean,
) {
  const names = [...reply.matchAll(/\*\*([^*]{4,60})\*\*/g)]
    .map((m) => m[1].trim())
    .filter((n) => /[a-zA-Z]{3,}/.test(n) && !/^[£$\d]/.test(n) && !/^gaffer$/i.test(n));
  const bookingDays = booking ? Math.max(1, Math.round((booking.end - booking.start) / 86400000) + 1) : 0;
  const cards: any[] = [];
  for (const raw of names.slice(0, 6)) {
    if (cards.length >= 4) break;
    const q = raw.replace(/^\d+\s*[x×]\s*/i, "").trim();
    if (q.length < 3) continue;
    try {
      // resolve the bolded name; if it lands on a lens, score-rank the search
      // hits (native/premium first) instead of an arbitrary r[0].
      const item: any = await buildOne(c, q, start, end, true, { camMounts });
      if (!item || !item.available || seenIds.has(item.listingId)) continue;
      // three-state guard (mount.ts): hard-drop incompatible glass for the known
      // camera set; flag adapter matches so the tile reason says "(adapter needed)".
      let needsAdapter = false;
      if (item.itemType === "lens") {
        const { drop, adapter } = classifyLensCard(item.mount, camMounts);
        if (drop) continue;
        needsAdapter = adapter;
      }
      seenIds.add(item.listingId);
      if (estimated) item.estimated = true;
      if (memberPct > 0) {
        item.memberPct = memberPct;
        item.memberTotal = Math.round(item.total * (1 - memberPct / 100));
      }
      if (booking && item.pricing) {
        const q2: any = quote(item.pricing, bookingDays);
        item.addonBookingId = booking.id;
        item.addonStart = booking.start;
        item.addonEnd = booking.end;
        item.addonTotal = q2.total;
        item.addonLabel = booking.label;
      }
      const baseReason = estimated
        ? "Mentioned above — tap the photo to pick exact dates."
        : "Mentioned above — priced for your dates.";
      cards.push({
        kind: "add",
        reason: needsAdapter ? withAdapterNote(baseReason) : baseReason,
        item,
      });
    } catch {}
  }
  return cards;
}

export async function POST(req: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY)
    return NextResponse.json({ reply: "The assistant isn't configured yet.", cards: [] });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reply: "Sorry, I didn't catch that.", cards: [] });
  }
  const history = Array.isArray(body?.messages) ? body.messages.slice(-12) : [];
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

  let ctx = "";
  let memberPct = 0;
  let activeBooking: any = null;
  if (body?.token) {
    try {
      const me: any = await c.query(api.accounts.me, { token: body.token });
      if (me) {
        const tier = me.membershipActive ? tierByKey(me.membershipTier) : null;
        memberPct = tier?.pct ?? 0;
        const name = me.name || (me.email ? me.email.split("@")[0] : "there");
        const bk: any = await c.query(api.accounts.myBookings, { token: body.token });
        const past: any[] = Array.isArray(bk) ? bk : [];
        const recent = (past[0]?.lineItems ?? []).map((li: any) => li.title).slice(0, 3);
        const openB = past.find((b: any) => ["confirmed", "pending", "reserved", "active", "paid"].includes(String(b.status).toLowerCase()));
        const bits: string[] = [];
        bits.push(
          past.length >= 2
            ? `Returning, reliable customer ${name} (${past.length} past bookings) — greet them back warmly BY NAME.`
            : past.length === 1
              ? `Customer ${name} (1 previous booking) — welcome them back by name.`
              : `Customer ${name} (first time) — be welcoming.`,
        );
        if (tier) bits.push(`${tier.name} member (active): apply their ${memberPct}% member discount to every quote and mention the saving.`);
        if (recent.length) bits.push(`Previously rented: ${recent.join(", ")} — personalise suggestions to this.`);
        if (openB) bits.push(`They have a ${openB.status} booking (${(openB.lineItems ?? []).map((li: any) => li.title).join(", ")}); gear can be added to it up to 1h before pickup — offer relevant add-ons.`);
        if (openB && openB.lineItems?.[0])
          activeBooking = { id: openB._id, start: openB.lineItems[0].start, end: openB.lineItems[0].end, label: openB.lineItems[0].title };
        ctx = bits.join(" ");
      }
    } catch {}
  }
  // camera mounts known for this conversation — used to rank native glass first
  // and refuse incompatible lens proposals. Sourced from THREE places (union):
  //   1. cameras already in the cart,
  //   2. cameras the LLM proposes this turn (resolved after generate, below),
  //   3. camera models mentioned in the latest user message.
  // A Set keeps it deduped & canonical (parseMounts normalises FE→E etc.).
  const camMountSet = new Set<string>();
  if (Array.isArray(body?.cart) && body.cart.length) {
    ctx += ` Items currently in their kit: ${body.cart.map((x: any) => `${x.title} (${x.start}→${x.end})`).join("; ")}.`;
    try {
      const ids = body.cart.map((x: any) => x.listingId).filter(Boolean);
      if (ids.length) {
        const cds: any[] = await c.query(api.catalog.listingsByIds, { ids });
        for (const cd of cds)
          if (cd.itemType === "camera-body") for (const m of parseMounts(cd.specs?.mount)) camMountSet.add(m);
      }
    } catch {}
  }
  // (3) cameras named ANYWHERE in the conversation — e.g. "I shoot on an FX3" in
  //     turn 1 still constrains a lens asked in turn 9. Scanning only the latest
  //     turn (the old behaviour) silently dropped the camera context mid-chat.
  const lastUserMsg = [...history].reverse().find((m: any) => m.role === "user")?.content || "";
  const allUserText = history
    .filter((m: any) => m.role === "user")
    .map((m: any) => String(m.content || ""))
    .join("  \n  ");
  try {
    for (const m of await camMountsFromText(c, allUserText)) camMountSet.add(m);
  } catch {}
  let camMounts: string[] = [...camMountSet];

  const messages = [{ role: "system", content: ctx ? `${styleBlock()} ${ctx}` : styleBlock() }, ...history];
  try {
    const agent = mastra.getAgent("renterBot");
    const res: any = await agent.generate(messages, { maxSteps: 12, structuredOutput: { schema: OUT } });
    const out: any = res?.object ?? res?.structuredOutput ?? {};

    // date resolution chain: model → conversation → the kit's dates → 3-day estimate
    if (!out.start || !out.end) {
      const joined = history.map((m: any) => String(m.content || "")).join(" ");
      const ds = joined.match(/\d{4}-\d{2}-\d{2}/g);
      if (ds && ds.length >= 2) {
        out.start = out.start || ds[ds.length - 2];
        out.end = out.end || ds[ds.length - 1];
      }
    }
    let estimated = false;
    if (!out.start || !out.end) {
      const ci: any = Array.isArray(body?.cart) ? body.cart[0] : null;
      if (ci?.start && ci?.end) {
        out.start = out.start || ci.start;
        out.end = out.end || ci.end;
      }
    }
    if (!out.start || !out.end) {
      const t = Date.now() + 86400000;
      out.start = out.start || new Date(t).toISOString().slice(0, 10);
      out.end = out.end || new Date(t + 2 * 86400000).toISOString().slice(0, 10);
      estimated = true;
    }

    let reply = out.reply ?? res?.text ?? "How can I help with your shoot?";

    // (2) camera-bodies the model proposed this turn AND any camera named in the
    //     reply prose → fold their mounts into camMounts BEFORE building cards,
    //     so a freshly-recommended FX3 still constrains the lens it pairs with.
    try {
      for (const p of out.proposals ?? []) {
        const l: any = await c.query(api.catalog.getListingBySlug, { slug: p.slug });
        if (l?.itemType === "camera-body") for (const m of parseMounts(l.specs?.mount)) camMountSet.add(m);
      }
      for (const m of await camMountsFromText(c, String(out.reply ?? ""))) camMountSet.add(m);
    } catch {}
    camMounts = [...camMountSet];

    let cards = await buildCards(c, out, camMounts, memberPct, activeBooking, estimated);
    const lastUser = lastUserMsg;

    // grounded-answer guard: DeepSeek often defers ("let me check…") or free-texts
    // specs/limits it shouldn't. Try a deterministic, knowledge-grounded answer when
    // the reply defers OR the user asks about an item's specs/limits/compatibility.
    // knowledgeAnswer self-gates (returns null unless it found REAL item facts), so
    // broadening WHEN we try it is safe — it only ever overrides with grounded text.
    // Decoupled from card count: a deferring reply must be fixed even WITH cards.
    const defersText =
      reply.trim().length < 12 ||
      /\b(let me|i['’]?ll|one moment|give me a moment|hang on|fetch|pull(ing)? up|look(ing)?\s*(it|that)?\s*up|check (the|on|compat|details)|will check|getting (that|the)|moment)\b/i.test(reply);
    const asksItemInfo =
      /\b(limitation|limits?|spec|specs|specification|weigh|weight|how (heavy|big|long)|stabili[sz]ation|battery life|max iso|dynamic range|frame ?rate|resolution|downside|drawback|pros? and cons?|tell me about|what.*(can|does|do).*(it|this|that))\b/i.test(lastUser);
    if ((defersText || asksItemInfo) && lastUser) {
      const ka = await knowledgeAnswer(c, lastUser, memberPct);
      if (ka) reply = ka;
      else if (defersText && cards.length > 0) {
        // real cards but no groundable prose: strip the deferral so the text doesn't
        // promise a follow-up that never arrives.
        reply = stripDeferral(reply) || "Here's what I'd suggest for your shoot:";
      }
    }

    // native tiles for gear named in prose — every **bolded** mention
    const seenIds = new Set<string>(
      cards.map((cd: any) => (cd.kind === "swap" ? cd.added?.listingId : cd.item?.listingId)).filter(Boolean),
    );
    const mentionCards = await cardsFromMentions(
      c, reply, out.start, out.end, seenIds, camMounts, memberPct, activeBooking, estimated,
    );
    cards = [...cards, ...mentionCards].slice(0, 6);

    // safety net: if they asked for gear but the model returned none, build a default.
    // Narrow to the gear type they actually implied ("recommend a lens" ⇒ just a lens),
    // only filling a full camera+lens+light+mic kit when they clearly want the whole rig.
    // Skip for pure availability questions ("do you have the FX6 kit?") — those must
    // not be answered with a generic substitute kit; the hallucination guard handles them.
    const isAvailabilityQ = /\b(do you (have|stock|carry)|have you got|is there|are there|got (a|an|any)|do you sell)\b/i.test(lastUser);
    if (cards.length === 0 && !isAvailabilityQ && /\b(kit|build|assemble|recommend|set ?up|shoot|gear for|need|suggest|what lens|which lens)\b/i.test(lastUser)) {
      out.wantsKit = true;
      const implied = impliedTypes(lastUser);
      const wantsFullKit = /\b(kit|build|assemble|everything|full (kit|set ?up|rig)|whole (kit|setup|shoot)|complete (kit|setup)|gear for)\b/i.test(lastUser);
      out.itemTypes = out.itemTypes?.length
        ? out.itemTypes
        : implied.length && !wantsFullKit
          ? implied
          : ["camera", "lens", "light", "mic"];
      cards = await buildCards(c, out, camMounts, memberPct, activeBooking, estimated);
    }

    // hallucination guard: if the model CLAIMS we have specific gear (bolded a name +
    // "yes/we have/in stock") but produced no cards AND not one bolded name resolves to
    // a real listing, it invented inventory — replace with a grounded answer or a
    // clarifying ask rather than confirming gear we don't own. (cards>0 ⇒ we have real
    // backing; a "resolves but unavailable" item also passes, avoiding false positives.)
    const claimsPossession =
      /\b(yes\b|we (have|stock|carry|do have|'ve got|have got|offer)|in stock|we've got)\b/i.test(reply) &&
      /\*\*[^*]+\*\*/.test(reply);
    if (claimsPossession && cards.length === 0) {
      const boldNames = [...reply.matchAll(/\*\*([^*]{3,60})\*\*/g)].map((m) => m[1].trim());
      let anyReal = false;
      for (const n of boldNames.slice(0, 5)) {
        try {
          if (await resolveNameToListing(c, n)) { anyReal = true; break; }
        } catch {}
      }
      if (!anyReal) {
        const ka = lastUser ? await knowledgeAnswer(c, lastUser, memberPct) : null;
        reply = ka || "Let me point you to the exact kit we carry — which camera or model are you after, and what dates?";
      }
    }

    // honour a NARROW request: "recommend a lens for my FX3" should show lenses only —
    // not a camera+light kit, and not the user's OWN camera the model bolded back at
    // them. When the user named exactly one gear type (and didn't ask to build a whole
    // kit), drop every off-type card even if that leaves zero — a wrong-type card is
    // worse than none, and the prose reply (often a clarifying question) stands alone.
    const askedTypes = impliedTypes(lastUser);
    const wantsWholeKit = /\b(kit|build|assemble|everything|full (kit|set ?up|rig)|whole (kit|setup|shoot)|complete (kit|setup)|set ?up|gear for|shoot)\b/i.test(lastUser);
    if (askedTypes.length === 1 && !wantsWholeKit) {
      const want = askedTypes[0];
      cards = cards.filter((cd: any) => {
        const it = cd.kind === "swap" ? cd.added : cd.item;
        return it && itemTypeMatches(want, it.itemType);
      });
    }

    const suggestions = Array.isArray(out?.suggestions)
      ? out.suggestions
          .filter((s: any) => typeof s === "string" && s.trim().length > 0 && s.trim().length <= 56)
          .slice(0, 3)
          .map((s: string) => s.trim().replace(/[.?!]$/, (m: string) => (m === "?" ? "?" : "")))
      : [];
    return NextResponse.json({ reply, cards, suggestions, booking: activeBooking });
  } catch {
    return NextResponse.json({
      reply: "Sorry, I'm having a moment — please try again, or reach us via the contact page.",
      cards: [],
    });
  }
}
