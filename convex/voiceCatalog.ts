import { query } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";

/**
 * Catalogue lookup built for the Gaffer voice agent.
 *
 * `catalog.listListings` matches with `title.includes(searchString)`, i.e. the
 * caller's whole spoken phrase must appear verbatim in a product title. On a
 * phone call it almost never does: "Sony" finds 130 items, "Sony camera" finds
 * zero, and Gaffer then told a caller we don't stock Sony — while offering
 * "Sony cinema cameras" in the same breath. Speech is phrased, not typed, so
 * matching here is token-based and intent-aware instead.
 *
 * Two shapes, because callers ask two different kinds of question:
 *   search  — "have you got an FX3"      → specific items, best first
 *   browse  — "what Sony cameras do you have" → the shape of the range
 *             (how many, price range, representative names) so Gaffer can
 *             actually sell rather than name one arbitrary item.
 */

/** Words that carry no product meaning in a spoken request. */
const FILLER = new Set([
  "a", "an", "the", "any", "some", "do", "does", "you", "your", "we", "i", "im", "id",
  "have", "has", "got", "get", "there", "is", "are", "it", "of", "and", "or", "to", "for",
  "me", "my", "can", "could", "would", "please", "looking", "look", "need", "want", "like",
  "hire", "hiring", "rent", "renting", "rental", "book", "booking", "available", "availability",
  "stock", "carry", "much", "how", "what", "whats", "which", "price", "cost", "day", "days",
  "with", "on", "in", "at", "about", "guys", "hello", "hi", "thanks", "please", "one", "kit",
]);

/** Category names as a caller would say them → our stored category. */
const CATEGORY_WORDS: Record<string, string> = {
  camera: "Cameras", cameras: "Cameras", body: "Cameras", bodies: "Cameras",
  lens: "Lenses", lenses: "Lenses", glass: "Lenses", zoom: "Lenses", prime: "Lenses",
  light: "Lighting", lights: "Lighting", lighting: "Lighting", led: "Lighting",
  audio: "Audio", sound: "Audio", mic: "Audio", mics: "Audio", microphone: "Audio",
  microphones: "Audio", recorder: "Audio", lav: "Audio", lavalier: "Audio",
  monitor: "Monitors", monitors: "Monitors", screen: "Monitors",
  drone: "Drones", drones: "Drones", fpv: "Drones",
  gimbal: "Stabilizers", gimbals: "Stabilizers", stabiliser: "Stabilizers",
  stabilizer: "Stabilizers", steadicam: "Stabilizers",
  tripod: "Grip", tripods: "Grip", grip: "Grip", slider: "Grip", rig: "Grip",
  battery: "Power", batteries: "Power", power: "Power", charger: "Power", vmount: "Power",
  accessory: "Accessories", accessories: "Accessories", card: "Accessories", cards: "Accessories",
  package: "Packages", packages: "Packages", bundle: "Packages", bundles: "Packages",
  dj: "Sound & DJ", speaker: "Sound & DJ", speakers: "Sound & DJ", party: "Sound & DJ",
};

/** Brands we actually stock — used to detect "what Sony do you have" style asks. */
const BRANDS = [
  "sony", "canon", "dji", "blackmagic", "bmpcc", "fujifilm", "fuji", "panasonic", "lumix",
  "nikon", "aputure", "godox", "nanlite", "amaran", "rode", "sennheiser", "deity", "atomos",
  "smallhd", "feelworld", "hollyland", "sigma", "tamron", "samyang", "zeiss", "tilta",
  "zhiyun", "insta", "gopro", "osmo", "manfrotto", "sirui", "laowa", "chauvet", "pioneer",
];

function tokenize(s: string): string[] {
  return (String(s).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 1 && !FILLER.has(t),
  );
}

/** Everything about a listing a spoken query might plausibly match against. */
function haystack(r: Doc<"listings">): string {
  return [r.title, r.category, r.itemType ?? "", (r.specs as any)?.tier ?? ""]
    .join(" ")
    .toLowerCase();
}

const isBundle = (t: string) =>
  /\+|\bset\b|\bultimate\b|\bbundle\b|\bkit\b|\d\s*[x×]\s/i.test(String(t));

/**
 * How much extra gear a title bolts on beyond the headline item.
 *
 * Titles list companions with "+", so "a7 iii + 28-70mm + DJI wireless mic" is
 * three things. Used to keep a body-plus-gimbal package from outranking the
 * bare body when someone just says "a7 iii".
 */
function extras(title: string): number {
  return (String(title).match(/\+/g) ?? []).length;
}

/**
 * Spelling-insensitive form for model matching: "a7 iii", "a7iii", "A7-III"
 * all collapse to "a7iii".
 *
 * Product titles compress models ("Sony a7iii") while callers space them out
 * ("a7 iii"), and word-boundary matching scored that backwards — bundles whose
 * titles happened to contain "a7" as a standalone word beat the bare body,
 * which is how asking for an a7 iii produced a gimbal package.
 */
const squash = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Bookable items only; display-only marketing rows must never be quoted. */
function bookable(rows: Doc<"listings">[]) {
  return rows.filter((r) => r.active && !r.suppressed);
}

function detect(tokens: string[]) {
  const brand = tokens.find((t) => BRANDS.includes(t)) ?? null;
  const catToken = tokens.find((t) => CATEGORY_WORDS[t]);
  return { brand, category: catToken ? CATEGORY_WORDS[catToken] : null };
}

/**
 * Score one listing against the query tokens. Whole-word hits beat substring
 * hits so "a7" doesn't score the same as a genuine "a7iii" match, and the
 * brand/category signals are weighted low: they broaden a search, they
 * shouldn't outrank the actual model the caller named.
 */
function score(r: Doc<"listings">, tokens: string[], brand: string | null, category: string | null) {
  const hay = haystack(r);
  const words = new Set(hay.match(/[a-z0-9]+/g) ?? []);
  let s = 0;
  for (const t of tokens) {
    if (words.has(t)) s += 3;
    else if (hay.includes(t)) s += 1;
  }
  if (brand && hay.includes(brand)) s += 2;
  if (category && r.category === category) s += 2;

  // The caller's words, spacing removed, appearing intact in the title: this is
  // the strongest signal we have that it's the model they actually named, and
  // it's immune to "a7 iii" vs "a7iii" spelling.
  const sq = squash(tokens.join(""));
  if (sq.length >= 3 && squash(r.title).includes(sq)) s += 6;

  // Every bolted-on extra makes this less like the thing they asked for. Enough
  // to demote a package below the bare item, not enough to bury a package when
  // it's the only match.
  s -= Math.min(extras(r.title), 3) * 2;

  // Specificity: a short title is mostly the thing itself, a long one is the
  // thing plus a keyword haul. Without this, per-word bonuses reward the
  // longest title — the bundle that happens to spell "a7 iii" as two words beats
  // the bare body whose title is literally "Sony a7iii".
  s += Math.max(0, 6 - Math.floor(squash(r.title).length / 12));
  return s;
}

/** Same image precedence as `catalog.card`, so voice-added basket lines show
 *  the identical thumbnail the customer sees when browsing. */
function heroImage(r: Doc<"listings">): string | null {
  const r2 = (r as any).r2Images ?? [];
  if (r2.length) return r2[0];
  return ((r as any).sourceImages ?? (r as any).gallery ?? [])[0] ?? null;
}

function shape(r: Doc<"listings">) {
  return {
    id: String(r._id),
    title: r.title,
    slug: r.slug,
    category: r.category,
    heroImage: heroImage(r),
    daily: r.pricing?.daily ?? null,
    deposit: r.depositAmount ?? null,
    minDays: r.minimumRentalDays ?? 1,
    deal: r.quietDeal ?? null,
  };
}

/**
 * Best-matching specific items for a spoken request.
 *
 * Returns several, not one: on a call the top hit is often a bundle when the
 * caller wanted the bare body (or vice versa), and offering two or three real
 * options is what lets Gaffer sell instead of guess.
 */
export const search = query({
  args: { q: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { q, limit }) => {
    const tokens = tokenize(q);
    const rows = bookable(await ctx.db.query("listings").collect());
    if (!tokens.length) return { matches: [], total: rows.length, brand: null, category: null };

    const { brand, category } = detect(tokens);
    // Did they actually ask for a package? Only then should sets outrank bodies.
    const wantsBundle = /\b(set|kit|bundle|package|combo|with|plus)\b/i.test(q);
    // Model tokens are the ones that identify a product: not the brand, not the
    // category word. If the caller named one, every result must contain it —
    // otherwise "FX3" quietly returns any old Sony.
    const modelTokens = tokens.filter((t) => !BRANDS.includes(t) && !CATEGORY_WORDS[t]);

    const scored = rows
      .map((r) => ({ r, s: score(r, tokens, brand, category) }))
      .filter((x) => {
        if (x.s <= 0) return false;
        if (!modelTokens.length) return true;
        const hay = haystack(x.r);
        return modelTokens.some((t) => hay.includes(t));
      })
      .sort((a, b) => {
        // Someone who says "an FX3" means the camera. Unless they asked for a
        // set, bare items come first as a hard rule rather than a tiebreak —
        // scoring alone kept surfacing packages, because a short bundle title
        // ("Sony FX3 + Gimbal set") looks specific by every other measure.
        if (!wantsBundle) {
          const ab = isBundle(a.r.title) ? 1 : 0;
          const bb = isBundle(b.r.title) ? 1 : 0;
          if (ab !== bb) return ab - bb;
        }
        return (
          b.s - a.s ||
          (b.r.demandScore ?? 0) - (a.r.demandScore ?? 0) ||
          a.r.title.length - b.r.title.length
        );
      });

    // Split the configurations out explicitly. Gaffer told a customer the a7 iii
    // "is only offered like that" after being handed a gimbal package — it had
    // no way to know a bare body existed, so it filled the gap with a guess.
    // Now the answer is in the payload: the cheapest standalone, and every
    // package, as separate facts it can read out.
    const standalone = scored.filter((x) => !isBundle(x.r.title));
    const packages = scored.filter((x) => isBundle(x.r.title));
    const cheapest = [...standalone].sort(
      (a, b) => (a.r.pricing?.daily ?? 1e9) - (b.r.pricing?.daily ?? 1e9),
    )[0];

    return {
      matches: scored.slice(0, limit ?? 5).map((x) => shape(x.r)),
      total: scored.length,
      brand,
      category,
      /** Cheapest bare version, or null if we genuinely only bundle it. */
      standalone: cheapest ? shape(cheapest.r) : null,
      standaloneCount: standalone.length,
      packageCount: packages.length,
      packages: packages.slice(0, 4).map((x) => shape(x.r)),
    };
  },
});

/**
 * The shape of a range, for "what <brand>/<category> do you have?".
 *
 * Answers with a count and a price floor as well as names, because that's what
 * turns a stock question into a booking. Falls back to the whole catalogue when
 * neither brand nor category is recognised, so Gaffer can always say something
 * true about what we stock rather than inventing it.
 */
export const browse = query({
  args: { q: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { q, limit }) => {
    const rows = bookable(await ctx.db.query("listings").collect());
    const tokens = tokenize(q ?? "");
    const { brand, category } = detect(tokens);

    let sel = rows;
    if (brand) sel = sel.filter((r) => haystack(r).includes(brand));
    if (category) sel = sel.filter((r) => r.category === category);

    sel.sort(
      (a, b) => (b.demandScore ?? 0) - (a.demandScore ?? 0) || a.title.localeCompare(b.title),
    );

    const prices = sel.map((r) => r.pricing?.daily ?? 0).filter((n) => n > 0);
    const counts: Record<string, number> = {};
    for (const r of sel) counts[r.category] = (counts[r.category] ?? 0) + 1;

    return {
      brand,
      category,
      count: sel.length,
      from: prices.length ? Math.min(...prices) : null,
      to: prices.length ? Math.max(...prices) : null,
      byCategory: counts,
      items: sel.slice(0, limit ?? 6).map(shape),
    };
  },
});

/** Categories we stock, with counts — so Gaffer can orient a vague caller. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const rows = bookable(await ctx.db.query("listings").collect());
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1;
    return { total: rows.length, byCategory: counts };
  },
});
