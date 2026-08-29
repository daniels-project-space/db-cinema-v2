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
 *
 * "Nanlite 300" ranked "Aputure 300d ii Light" first and the actual Nanlite
 * forza 300 fifth. Neither the brand bonus nor the mismatch were enough:
 * Aputure's title has no "nanlite" anywhere, but "300" is a plain substring
 * of "300d" so it still scored, and the real item's long bundled title
 * ("+ stand + Gels") ate enough of the extras penalty to fall behind an item
 * that didn't even carry the brand asked for. A caller who names a brand has
 * ruled out every other one — a title that doesn't contain it at all should
 * never be able to outrank one that does purely on a coincidental digit
 * match, so a mismatch is now penalised as hard as a match is rewarded.
 */
function score(r: Doc<"listings">, tokens: string[], brand: string | null, category: string | null) {
  const hay = haystack(r);
  const words = new Set(hay.match(/[a-z0-9]+/g) ?? []);
  let s = 0;
  for (const t of tokens) {
    // A bare number is the most decisive word in a model query — "300" said
    // for a Nanlite means the 300-watt one — so it needs to be weighted like
    // it, not like an ordinary word. But titles here are keyword-stuffed with
    // *other* products' model numbers as comparison references ("like Aputure
    // 300d"), and "300" is a plain substring of "300d". Giving that partial
    // credit was scoring marketing noise as a real match: three listings that
    // only ever say "300d" outranked the one genuine 300-watt light because
    // none of them paid the honest bundle's extras penalty. A number only
    // counts here if it stands on its own — no credit at all for landing
    // inside a longer one.
    const numeric = /^\d+$/.test(t);
    if (words.has(t)) s += numeric ? 8 : 3;
    else if (!numeric && hay.includes(t)) s += 1;
  }
  if (brand) s += hay.includes(brand) ? 4 : -4;
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
    // What glass is in the box. The catalogue carries several near-identical
    // bodies that differ only by the lens bundled with them — an a7 III with a
    // 28-70 and an a7 III with a GM 24-70 are separate listings at different
    // prices. Without this the voice agent picks one on title match alone and
    // the customer finds out which lens they booked when it arrives.
    includesLens: (r as any).specs?.includesLens ?? false,
    lensFocal: (r as any).specs?.lensFocal ?? null,
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
        // Plain substring, or squashed — "a75" spoken for "a7 V" / "a7v" as
        // written misses a plain check on spacing alone. score() already
        // squash-matches for ranking; this is the same trick applied to the
        // gate that decides whether a result is admitted at all. Without it,
        // asking for "a75" returned zero matches even though the A7 V listing
        // was sitting right there, and the caller was told to try browse()'s
        // softer "can't find that exact model" fallback instead of a direct hit.
        const sq = squash(hay);
        return modelTokens.some((t) => hay.includes(t) || sq.includes(squash(t)));
      })
      .sort((a, b) => {
        // Brand match outranks everything below it. "Nanlite 300" put an
        // Aputure light first and the actual Nanlite forza 300 last — the
        // score fix above made the real item win on points, but the
        // bare-before-bundle rule beneath this one is a hard cut, not a
        // tiebreak, and the Nanlite forza 300 genuinely IS a kit (it comes
        // with a stand and gels — that's how it's sold, not a sign it's the
        // wrong thing). A bare item from a brand the caller didn't name has
        // no business outranking the bundle from the brand they did.
        if (brand) {
          const hayA = haystack(a.r), hayB = haystack(b.r);
          const am = hayA.includes(brand) ? 1 : 0;
          const bm = hayB.includes(brand) ? 1 : 0;
          if (am !== bm) return bm - am;
        }
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
 *
 * A real call: "do you have any anamorphic lenses?" reached this query as
 * `browse("anamorphic lenses")`. "lenses" is a recognised category word, so it
 * filtered to Lenses — but "anamorphic" is neither a brand nor a category word,
 * and every token that isn't one was silently thrown away. The caller's actual
 * question was never asked. It came back "yes, 64 lenses", Gaffer read out three
 * that had nothing to do with anamorphic glass, and told the caller we don't
 * carry any — while nineteen real anamorphic listings sat in that same result,
 * just never looked at. `search` never had this bug: it scores every token.
 * `browse` now checks anything left over the same way, so a feature word either
 * narrows the count for real or is honestly reported as not narrowing it —
 * never dropped in silence.
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

    // Everything left is the actual ask: a feature, a lens type, a model
    // number. Two ways to hit — plain substring for a real word ("anamorphic"),
    // squashed for a model spoken with different spacing than it's typed
    // ("a75" said, "a7 5" / "a7v" written; squash makes both "a75").
    const rest = tokens.filter((t) => t !== brand && !CATEGORY_WORDS[t]);
    let matchedSpecific = false;
    if (rest.length) {
      const narrowed = sel.filter((r) => {
        const hay = haystack(r);
        const sq = squash(hay);
        return rest.some((t) => hay.includes(t) || sq.includes(squash(t)));
      });
      // Only narrow when it actually found something. An empty result here
      // means "we don't carry that specifically" — worth knowing, but the
      // caller still deserves the honest count of the broader category rather
      // than a hard zero, so the fallback sentence can offer real alternatives.
      if (narrowed.length) {
        sel = narrowed;
        matchedSpecific = true;
      }
    }

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
      /** True only when a specific word beyond brand/category actually matched something. */
      matchedSpecific,
      /** What that specific ask was, so the caller can be told plainly when it drew a blank. */
      askedFor: rest.length ? rest.join(" ") : null,
    };
  },
});

/**
 * Is this listing a bundle rather than the bare item?
 *
 * The catalogue is overwhelmingly combos — of 170 cameras only nine are bare
 * bodies — so someone asking for "a Sony camera" gets buried in
 * body-plus-lens-plus-tripod listings unless the two are separated. There is no
 * flag for it: `components` is empty on every row and `itemType` is the class of
 * thing ("camera-body"), not whether it is a set. So it is inferred from the
 * bundled-lens spec and the way sets are titled.
 */
function isSet(r: Doc<"listings">): boolean {
  // a bundled lens makes it a set even when the title doesn't say so
  return (r as any).specs?.includesLens === true || isBundle(r.title);
}

/**
 * What the customer will and won't find in the case.
 *
 * Derived rather than stored: there is no inclusions field, but the specs carry
 * enough to answer the questions that actually cause problems on collection —
 * whether glass is in the box, what mount it is, what batteries it eats, what
 * filter thread it takes. Being explicit about what is *not* included is the
 * half that prevents a bad handover.
 */
function inclusions(r: Doc<"listings">) {
  const s = (r as any).specs ?? {};
  const includes: string[] = [];
  const excludes: string[] = [];

  if (r.category === "Cameras") {
    if (s.includesLens && s.lensFocal) includes.push(`${s.lensFocal}mm lens`);
    else if (!s.includesLens) excludes.push("no lens — body only");
    if (s.batteryType) includes.push(`${s.batteryType} battery`);
    excludes.push("memory cards are not included");
  }
  if (r.category === "Lenses") {
    if (s.mount) includes.push(`${s.mount} mount`);
    if (s.filterThreadMm) includes.push(`${s.filterThreadMm}mm filter thread`);
    excludes.push("no camera body — lens only");
  }
  if (r.category === "Stabilizers") excludes.push("no camera — gimbal only");
  if (r.category === "Lighting") excludes.push("stands and modifiers are separate unless the title says otherwise");

  return { includes, excludes };
}

/**
 * A shortlist to put on screen, split so the bare item can be offered before
 * the sets. Used by Gaffer to filter the real catalogue page and highlight what
 * it just recommended, rather than describing gear the caller can't see.
 */
export const recommend = query({
  args: {
    q: v.optional(v.string()),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { q, category, limit }) => {
    const tokens = tokenize(q ?? "");
    const guess = detect(tokens);
    const cat = category && category !== "All" ? category : guess.category;
    const brand = guess.brand;

    let rows = bookable(await ctx.db.query("listings").collect());
    if (cat) rows = rows.filter((r) => r.category === cat);
    if (brand) rows = rows.filter((r) => r.title.toLowerCase().includes(brand));

    // model tokens beyond the brand/category words narrow it further
    const rest = tokens.filter((t) => t !== brand && !CATEGORY_WORDS[t]);
    if (rest.length) {
      const narrowed = rows.filter((r) => {
        const t = r.title.toLowerCase();
        return rest.some((tok) => t.includes(tok));
      });
      if (narrowed.length) rows = narrowed;
    }

    const byDemand = (a: Doc<"listings">, b: Doc<"listings">) =>
      ((b as any).demandScore ?? 0) - ((a as any).demandScore ?? 0);
    const n = limit ?? 6;
    const single = rows.filter((r) => !isSet(r)).sort(byDemand).slice(0, n);
    const sets = rows.filter(isSet).sort(byDemand).slice(0, n);

    const withInfo = (r: Doc<"listings">) => ({ ...shape(r), ...inclusions(r) });
    return {
      category: cat ?? null,
      brand,
      total: rows.length,
      standalone: single.map(withInfo),
      bundles: sets.map(withInfo),
    };
  },
});

/**
 * Real, bookable items in a category — nothing else.
 *
 * Exists because `alternativesFor` (the substitute-offering path, used when a
 * requested item is booked out) was calling `catalog.listListings` instead —
 * the query built for the public /gear page, which deliberately keeps
 * display-only marketing rows visible (sunk to the bottom of the page, not
 * hidden) so a human browsing can still see them. A voice call has no bottom
 * of the page: whatever this returns, Gaffer offers as a real thing the
 * caller can book. So it goes through the same `bookable()` gate every other
 * voice-facing query in this file uses, and nowhere else.
 */
export const byCategory = query({
  args: { category: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { category, limit }) => {
    const rows = bookable(
      await ctx.db.query("listings").withIndex("by_category", (q) => q.eq("category", category)).collect(),
    );
    rows.sort((a, b) => (b.demandScore ?? 0) - (a.demandScore ?? 0));
    return rows.slice(0, limit ?? 12).map(shape);
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
