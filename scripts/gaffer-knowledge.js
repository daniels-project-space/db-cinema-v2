#!/usr/bin/env node
/**
 * Build and publish everything Gaffer needs to know, from the live catalogue.
 *
 *   - a knowledge base: one policy document plus one per category, written from
 *     each listing's `knowledge` (summary, features, limits, pairsWith) and its
 *     real price ladder, so answers about what's in a set come from the
 *     catalogue rather than the model's imagination
 *   - ASR keywords: the model names people actually say, so "FX3" and "Ronin"
 *     stop coming back as "effects three" and "roning"
 *   - agent settings: the LLM, the native end-call and silence handling, and
 *     the post-call extraction that turns a conversation into a record
 *
 * Only bookable stock is ever described. Suppressed and display-only rows are
 * excluded outright — Gaffer must never offer something that can't be hired,
 * and must never describe an item using internal words like "display only".
 *
 * Usage:
 *   node scripts/gaffer-knowledge.js --dry-run
 *   node scripts/gaffer-knowledge.js --apply            (everything)
 *   node scripts/gaffer-knowledge.js --apply --only=kb  (kb|asr|settings|tools|llm)
 */

const fs = require("fs");
const path = require("path");

const AGENT_ID = process.env.GAFFER_AGENT_ID || "agent_4601kvk2pfznfrws6ah700jnxvfv";
const API = "https://api.elevenlabs.io/v1/convai";
const KEY = process.env.ELEVENLABS_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const LISTINGS = process.env.LISTINGS_JSONL || "/tmp/dbcx/listings/documents.jsonl";

/**
 * Namespace for this business's knowledge-base documents.
 *
 * The ElevenLabs workspace is shared with other agents, so every document this
 * script creates or deletes must be identifiably ours. Never widen this, and
 * never reuse it in another business's script.
 */
const DOC_PREFIX = "Db Cinema";

const el = (p, init = {}) =>
  fetch(`${API}${p}`, { ...init, headers: { "xi-api-key": KEY, ...(init.headers || {}) } });

// ── pricing, mirrored from src/lib/pricing.ts ───────────────────────────
const SYNTH = { 3: 0.1, 7: 0.18, 14: 0.27, 30: 0.38 };
const ladder = (p = {}) => {
  const d = p.daily || 0;
  if (!d) return "";
  const rung = (days, key) => {
    const raw = p[key];
    const per = typeof raw === "number" && raw > 0 ? raw : Math.round(d * (1 - (SYNTH[days] ?? 0)));
    return `${days}d £${Math.round(per)}/day`;
  };
  return [`1d £${Math.round(d)}/day`, rung(3, "day3"), rung(7, "day7"), rung(14, "day14"), rung(30, "day30")].join(", ");
};
const damageHold = (replacement) => Math.max(50, Math.min(200, Math.round((replacement || 0) * 0.05)));

/** Bookable only. Anything suppressed or display-only is invisible to Gaffer. */
const bookable = (rows) => rows.filter((r) => r.active && !r.suppressed && !r.displayOnly);

const isSet = (r) =>
  r.specs?.includesLens === true || /[+]|\bset\b|\bultimate\b|\bbundle\b|\bkit\b|\d\s*[x×]\s/i.test(r.title || "");

/** Same derivation the voice tools use, so screen and speech agree. */
function inclusions(r) {
  const s = r.specs || {};
  const inc = [];
  const exc = [];
  if (r.category === "Cameras") {
    if (s.includesLens && s.lensFocal) inc.push(`${s.lensFocal}mm lens included`);
    else if (!s.includesLens) exc.push("no lens — body only");
    if (s.batteryType) inc.push(`${s.batteryType} battery`);
    exc.push("memory cards not included");
  }
  if (r.category === "Lenses") {
    if (s.mount) inc.push(`${s.mount} mount`);
    if (s.filterThreadMm) inc.push(`${s.filterThreadMm}mm filter thread`);
    exc.push("no camera body — lens only");
  }
  if (r.category === "Stabilizers") exc.push("no camera — gimbal only");
  if (r.category === "Lighting") exc.push("stands and modifiers separate unless the title lists them");
  return { inc, exc };
}

/** `knowledge` is a v.any() column — the shape is not guaranteed per row. */
const arr = (x) =>
  Array.isArray(x) ? x.filter((v) => typeof v === "string" && v.trim()) : typeof x === "string" && x.trim() ? [x] : [];
const text = (x) => (typeof x === "string" ? x.trim() : "");

function listingBlock(r) {
  const k = r.knowledge && typeof r.knowledge === "object" ? r.knowledge : {};
  const { inc, exc } = inclusions(r);
  const lines = [`### ${r.title}`];
  if (text(k.summary)) lines.push(text(k.summary));
  lines.push(`Rates: ${ladder(r.pricing)}.`);
  lines.push(
    `Refundable damage hold £${damageHold(r.depositAmount)} (5% of replacement value, min £50, max £200).` +
      (r.minimumRentalDays > 1 ? ` Minimum hire ${r.minimumRentalDays} days.` : ""),
  );
  if (isSet(r)) lines.push("This is a set — it bundles several items together.");
  if (inc.length) lines.push(`Included: ${inc.join(", ")}.`);
  if (exc.length) lines.push(`NOT included: ${exc.join("; ")}.`);
  const feats = arr(k.features);
  const best = arr(k.bestFor);
  const pairs = arr(k.pairsWith);
  const lims = arr(k.limits);
  if (feats.length) lines.push(`Key specs: ${feats.join("; ")}.`);
  if (best.length) lines.push(`Best for: ${best.join(", ")}.`);
  if (pairs.length) lines.push(`Pairs with: ${pairs.join(", ")}.`);
  if (lims.length) lines.push(`Limitations: ${lims.join("; ")}.`);
  return lines.join("\n");
}

const POLICY_DOC = `# Db Cinema Rentals — rates, deposits, delivery and terms

## How renting works
Browse the catalogue, pick dates, add gear to the basket and check out. Confirmation
arrives by email. Collect from central London or have it delivered.

## Rates and multi-day discounts
Rates are per day and get cheaper the longer the hire, applied automatically — there is
no code to enter. Where a specific rate isn't set for a length, the discount off the
daily rate is: 3 days 10% off, 7 days 18% off, 14 days 27% off, 30 days 38% off per day.
A longer hire is never more expensive per day than a shorter one.
Members save a further 10-30% on every rental.

## Deposits and insurance
ID-verified renters pay a small refundable damage hold plus insurance cover, instead of a
large deposit. The hold is 5% of the item's replacement value, with a minimum of £50 and a
maximum of £200. It is refundable. Verify ID once and it is saved to the account.
The alternative is a full refundable security deposit equal to the replacement value.

## Delivery
Delivery is available across London and quoted both ways — the fee is based on distance
and load, and larger setups travel by van. Pickup or delivery is chosen at checkout along
with a time window. Members may get free delivery.

## Opening hours
Pickups and returns run 09:00-22:00, every day. Delivery windows are
arranged when booking.

## Changes, extensions and cancellations
Compatible gear can be added up to an hour before the rental starts, and dates can be
extended — ask, or message us from the account area. To change or cancel a booking,
message from the account area as early as possible; a member of the team confirms it.
Never invent a cancellation window or a refund figure — if asked for specifics beyond
this, say a human will confirm and take their details.

## What is never included unless stated
Memory cards are not included with cameras. A lens is only included if the listing says
so. A gimbal never includes a camera. Lighting stands and modifiers are separate unless
the title lists them. Always say what is not in the case before the customer books.

## How to reach us
Our email address is dbcinemarentals@gmail.com — say it aloud as "d b cinema rentals, at
gmail dot com". This is the ONLY address we use; never state or guess at another one.
Messages sent through the contact form at dbcinemarentals.com/contact arrive in the same
inbox. Anything you file with request_callback or log_enquiry also lands there, so filing
it yourself is normally better than asking the customer to send an email.
`;

/**
 * The FORM / SEVEN collaboration, as far as Gaffer is allowed to know it.
 *
 * Deliberately a partner briefing and not a copy of their business. Gaffer can
 * say who they are, what the collaboration gives our customers, and hand over.
 * It cannot quote their prices, promise a turnaround, check what they have
 * capacity for, or take a brief on their behalf — that is Madeline's job on
 * their own site, and an agent improvising another company's commercial terms
 * is how a partnership turns into a complaint.
 *
 * The bounds at the end of this document are the gate. Keep them.
 */
const PARTNER_DOC = `# FORM / SEVEN — our creative collaboration

## Who they are
FORM / SEVEN is an AI-native production studio for social — a startup founded by
Daniel that turns a product into short-form advertising: UGC-style ads, polished
product films, and social systems built to sell rather than fill a feed. They work
with founders and small teams who need their product to look considered without an
agency retainer or a full production day.

## What they offer
Single ready-to-post ads, multi-variant campaign packs for a launch, and — for
founders who don't want to run their own feed — ongoing Instagram management: a
content calendar, captions, scheduled publishing and agreed reply windows each
week. They'll also cut a free six-second sample of someone's product before any
money changes hands, which is the easiest thing to point a curious customer at.
Leave exact prices to Madeline; send people to form7.net for numbers.

## Why we work with them
We hire out the kit; they make the film. A customer renting a camera to shoot their
own product often needs the advert made, and a brand that needs an advert often needs
kit for the shoot. The collaboration means neither of us sends someone away
empty-handed.

## What our customers get
Db Cinema Rentals customers get 10% off FORM / SEVEN work. Mention it when someone is
renting for a product shoot, a launch, a campaign, or is clearly making something to
advertise with — it is a genuine saving and the reason the partnership exists. Don't
force it into unrelated calls.

## How to hand over
Point them at form7.net. Their own assistant, Madeline, handles briefs, packages and
pricing there. If they want, take their email and note the interest with log_enquiry so
someone follows up.

## The bounds — read this before answering anything about them
You may explain who FORM / SEVEN are, that we collaborate, and the 10% off.
You may NOT:
- quote their prices, packages or what any package includes
- promise a turnaround, a delivery date, or that they can take on a job
- describe their availability, capacity or process in detail
- take a creative brief, agree scope, or commit them to anything
If asked any of that, say plainly that their team handles it, send them to form7.net,
and offer to pass their details on. Never guess at another company's terms.`;

// ── ASR keywords ────────────────────────────────────────────────────────
const STOP = new Set(
  ("camera cameras lens lenses set sets kit kits bundle package with for the and pro full frame cinema " +
    "mirrorless digital video professional new mark plus zoom prime wide mount rigged rig photography film " +
    "content creator advanced basic portable powered capacity spare extra mini max ultra black white inch " +
    "battery batteries light lights lighting led audio sound mic mics microphone monitor monitors drone " +
    "drones gimbal tripod grip slider power charger accessory accessories speaker speakers f28 f18 f14 " +
    "mm cm kg gb tb hire rental london day days include included").split(/\s+/),
);

/** Brands worth boosting by name — these are what callers lead with. */
const BRANDS = [
  "sony", "canon", "dji", "blackmagic", "bmpcc", "fujifilm", "panasonic", "lumix", "nikon",
  "aputure", "godox", "nanlite", "amaran", "rode", "sennheiser", "deity", "atomos", "smallhd",
  "feelworld", "hollyland", "sigma", "tamron", "samyang", "zeiss", "tilta", "zhiyun", "insta360",
  "gopro", "osmo", "manfrotto", "sirui", "laowa", "ronin", "arri", "sachtler", "teradek",
];

/**
 * The names people say out loud, ranked by how often the gear actually rents.
 *
 * Only fifty slots exist, so they go to brands and model designations — the
 * words speech-to-text mangles into something unsearchable ("FX3" as "effects
 * three", "a7 III" as "a seven three"). Ordinary English earns nothing here: a
 * boost on "stand" or "image" costs a slot and fixes nothing, and generic
 * fragments like "2x" or "f2" are noise from titles rather than things anyone
 * says as a product name.
 */
function asrKeywords(rows, cap = 50) {
  const looksLikeModel = (t) =>
    /^[a-z]{1,5}[- ]?\d{1,4}[a-z]{0,4}$/.test(t) || /^\d{1,3}[a-z]{1,4}$/.test(t);
  const isMultiplier = (t) => /^\d+x$/.test(t) || /^f\d/.test(t) || /^\d+(k|mm|gb|tb|w)$/.test(t);

  const score = new Map();
  for (const r of rows) {
    const weight = 1 + (r.demandScore ?? 0);
    for (const raw of String(r.title).toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g) ?? []) {
      const t = raw.replace(/^-+|-+$/g, "");
      if (t.length < 2 || t.length > 18 || STOP.has(t)) continue;
      if (/^\d+$/.test(t) || isMultiplier(t)) continue;
      const brand = BRANDS.includes(t);
      if (!brand && !looksLikeModel(t)) continue; // ordinary words earn no slot
      // brands lead a request, so they matter more than any single model
      score.set(t, (score.get(t) ?? 0) + weight * (brand ? 3 : 1));
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([t]) => t);
}

// ── data collection + evaluation, so calls become records ───────────────
const DATA_COLLECTION = {
  customer_name: { type: "string", description: "The caller's name, if given." },
  customer_email: { type: "string", description: "Their email address, if given." },
  customer_phone: { type: "string", description: "Their phone number, if given." },
  gear_discussed: { type: "string", description: "Which items were discussed or added to the basket." },
  hire_dates: { type: "string", description: "The hire dates they asked about, as spoken." },
  outcome: {
    type: "string",
    description: "One of: booked, basket_started, enquiry_logged, support_resolved, no_outcome.",
  },
};

const EVALUATION = [
  {
    name: "answered_the_question",
    conversation_goal_prompt:
      "Did the agent actually answer what the caller asked, using real catalogue data rather than guessing? Fail if it invented an item, a price, or an availability claim.",
  },
  {
    name: "stated_exclusions",
    conversation_goal_prompt:
      "If gear was recommended or added, did the agent say what is NOT included (no lens, no memory card, no camera with a gimbal)? Not applicable if no gear was discussed.",
  },
  {
    name: "captured_follow_up",
    conversation_goal_prompt:
      "If the call needed anything afterwards, did the agent log the enquiry or take an email rather than leaving it in the air?",
  },
];

/**
 * What the model reads about specific tools, every turn — webhook AND client.
 *
 * These tools were created by two different scripts, both additive-only by
 * design (a webhook bootstrap and gaffer-agent-sync.js, which explicitly
 * "leaves existing tools exactly as they are" to protect the phone line).
 * Neither ever *updates* a description once a tool exists, so wording that
 * matters this much — what the model reads on every single turn — existed
 * nowhere in the repo for these two client tools, and could drift in the
 * dashboard with nothing to catch it. Pinned here instead, same as the
 * webhook tools already were.
 *
 * ANNOUNCE is on the slow lookups because none of them is instant from the
 * caller's side: the endpoint answers in well under a second, but the model
 * round-trip around it doesn't, and a phone call has no spinner.
 *
 * The rest is about not paying that cost twice. find_gear and browse_for are
 * handed the dates and already report what's free, so re-checking the same item
 * for the same dates buys nothing and doubles the wait. browse_range is the odd
 * one out — it takes a search term, not an item, and never looks at dates at
 * all — so its rule isn't "don't repeat a check", it's "don't mistake this for
 * one". Presenting a catalogue listing as an availability answer is how a
 * caller gets told something is free when nobody has looked.
 */
const ANNOUNCE =
  'ALWAYS say one short line out loud before calling this ("let me check those dates") — ' +
  "the caller hears nothing while it runs. ";
const NO_RECHECK =
  " Do not call this for an item and date range that find_gear or browse_for has already " +
  "reported as free — they check the same calendar.";

const PINNED_TOOL_DESCRIPTIONS = {
  check_availability:
    ANNOUNCE + "Check if a piece of gear is free for given dates and its price." + NO_RECHECK,
  check_stock: ANNOUNCE + "Check whether the shop stocks a piece of gear." + NO_RECHECK,
  get_price: ANNOUNCE + "Get the daily and total price of a piece of gear.",
  browse_range:
    ANNOUNCE +
    "Browse what the shop carries in a category or brand, with a price range. " +
    "This answers what EXISTS and what it COSTS — it does not look at dates and cannot tell " +
    "you whether anything is free. Never present its answer as availability, and never use it " +
    "in place of an availability check: if the caller has given you dates, follow up with " +
    "find_gear or check_availability before promising anything. If find_gear or recommend_gear " +
    "has already put suitable items on screen for those dates, you do not need this at all. " +
    "ONLY use this for a genuinely open question — 'what Sony cameras do you have', 'what's " +
    "your lighting range like'. The moment the caller names a specific thing — a model number, " +
    "a lens type, a feature like 'anamorphic' or '70-200' — call find_gear instead, every time. " +
    "This tool only recognises broad brand and category words; a named model or feature narrows " +
    "the count when it can, but if it can't find that word at all you will be told so honestly " +
    "rather than handed an unrelated 'yes'. find_gear checks the caller's actual words against " +
    "every listing and will not make that mistake.",

  /**
   * A real call: "show me the other lighting options" reached this tool
   * instead of recommend_gear, because this tool's own description said its
   * destination "can be... a category (cameras, lenses, lighting...)" — the
   * exact same words recommend_gear's description uses to describe what IT
   * does. Two tools claiming the same job, and the model picked the one that
   * does less: this is a bare page swap, nothing highlighted, nothing
   * scrolled into view, no availability read. The caller was left looking at
   * an unfiltered grid with no indication which of forty-odd lights Gaffer
   * meant. (The call also ended right here, separately — see GafferSession's
   * reconnect handling — but even a call that had lived would have shown
   * nothing worth looking at.)
   */
  navigate_to:
    "Open a NAMED PAGE on the customer's screen — the basket, checkout, membership, account, " +
    "contact, how it works, guides, or the bare catalogue with no filter. Never pass a category " +
    "or an item here. The moment the ask is a category ('lighting', 'cameras') or something to " +
    "find ('a wide lens', 'what Sony do you have'), that is recommend_gear or browse_for, not " +
    "this — they filter to what was actually asked for, highlight the shortlist, scroll it into " +
    "view, and report real prices and availability. This tool does none of that: passing a " +
    "category here leaves the customer looking at an unfiltered grid with nothing marked out, " +
    "having heard you say you'd show them something specific.",

  /**
   * A real call: the caller named three items and said "once you've added
   * all of that" — about as explicit as consent gets — and none of the
   * three were ever added. The call ended before Gaffer got back to them,
   * but "ask before adding" is also just the wrong instinct for gear that
   * was named with the word "add" already in the sentence: asking again
   * reads as not having listened. Also pushes toward adding as each item
   * clears, not batching every check before any commitment — so a call that
   * ends unexpectedly still leaves whatever was already confirmed sitting
   * in the basket rather than lost with nothing to show for it.
   */
  add_to_basket:
    "Add an item to the customer's basket and open it. If they've already told you to add it, " +
    "get it, or book it — that already IS the ask; call this directly, don't check back first. " +
    "Only ask before adding when you are the one suggesting the item, not them. If you know the " +
    "hire dates pass them; otherwise it is pencilled in for tomorrow and the customer can change " +
    "it. When someone names several items to add in one breath, add each the moment it checks " +
    "out available rather than checking all of them and adding at the end — if anything " +
    "interrupts the call, whatever already cleared should already be in the basket.",
};

/**
 * Every tool named here MUST get a spoken line before it runs, mechanically —
 * not just told to in the prompt. A real call showed why the prompt-only rule
 * (SPOKEN_PACE) isn't enough on its own: the model can still choose to chain
 * several of these with nothing said in between, which is exactly the 10-15s
 * of silence a caller mistook for a dropped line. Setting `pre_tool_speech`
 * to "force" makes ElevenLabs itself require a spoken turn immediately before
 * the tool fires — the caller hears "let me pull that up for you" before the
 * pause, not instead of it. Scoped to tools that genuinely take a beat (a
 * lookup, a navigation, an add) — instant ones like select_item don't need it.
 *
 * The API exposes a `force_pre_tool_speech` boolean too, but it's read-only —
 * PATCHing it directly returns 200 and silently keeps the old value; verified
 * live, three times, against a real tool. The actual control is the
 * `pre_tool_speech` enum (auto | force | off); "force" is what the boolean
 * reflects, not something settable on its own.
 */
const FORCE_PRE_TOOL_SPEECH = new Set([
  "navigate_to", "browse_for", "find_gear", "recommend_gear", "add_to_basket",
  "suggest_addons", "add_addon", "review_basket", "go_to_checkout", "remove_unavailable",
  "check_availability", "check_stock", "get_price", "browse_range",
  "check_basket", "log_enquiry", "send_follow_up", "suggest_alternatives",
]);

async function pinToolDescriptions(toolIds) {
  let changed = 0;
  for (const id of toolIds) {
    const tool = await (await el(`/tools/${id}`)).json();
    const cfg = tool.tool_config || {};
    const wantedDescription = PINNED_TOOL_DESCRIPTIONS[cfg.name];
    const wantsForce = FORCE_PRE_TOOL_SPEECH.has(cfg.name);
    const descriptionStale = wantedDescription && cfg.description !== wantedDescription;
    const forceStale = wantsForce && cfg.pre_tool_speech !== "force";
    if (!descriptionStale && !forceStale) continue;

    const next = { ...cfg };
    if (descriptionStale) next.description = wantedDescription;
    if (forceStale) next.pre_tool_speech = "force";

    let r = await el(`/tools/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool_config: next }),
    });
    /**
     * pre_tool_speech is confirmed valid on both client and webhook tools —
     * verified live — but this stays defensive against any other field this
     * pass might one day carry that isn't universal: a rejected combined PATCH
     * retries with the description alone rather than aborting every other
     * tool's update in the same run.
     */
    if (!r.ok && forceStale && descriptionStale) {
      console.warn(`  ${cfg.name}: combined update rejected (${r.status}), retrying description only`);
      r = await el(`/tools/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool_config: { ...cfg, description: wantedDescription } }),
      });
    }
    if (!r.ok) {
      console.warn(`  ${cfg.name}: update failed (${r.status}) — ${(await r.text()).slice(0, 200)}`);
      continue;
    }
    console.log(
      `  updated ${cfg.name}:` +
        (descriptionStale ? " description" : "") +
        (forceStale ? " pre_tool_speech=force" : ""),
    );
    changed++;
  }
  if (!changed) console.log("  tool descriptions and pre-tool-speech already current");
}

async function main() {
  if (!KEY) throw new Error("ELEVENLABS_API_KEY is not set");
  const apply = process.argv.includes("--apply");
  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "all";
  const want = (n) => only === "all" || only === n;

  if (!fs.existsSync(LISTINGS)) throw new Error(`No listings export at ${LISTINGS} — run: convex export`);
  const all = fs.readFileSync(LISTINGS, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const rows = bookable(all);
  console.log(`listings: ${all.length} total, ${rows.length} bookable (${all.length - rows.length} excluded)`);

  // ── documents ──
  const byCat = {};
  for (const r of rows) (byCat[r.category] ??= []).push(r);
  const docs = [
    { name: `${DOC_PREFIX} — rates, deposits, delivery and terms`, text: POLICY_DOC },
    { name: `${DOC_PREFIX} — the FORM / SEVEN collaboration`, text: PARTNER_DOC },
  ];
  for (const [cat, items] of Object.entries(byCat).sort()) {
    const body = items
      .sort((a, b) => (b.demandScore ?? 0) - (a.demandScore ?? 0))
      .map(listingBlock)
      .join("\n\n");
    docs.push({ name: `Db Cinema catalogue — ${cat}`, text: `# ${cat} (${items.length} items available to hire)\n\n${body}` });
  }
  const kw = asrKeywords(rows);

  console.log(`\nknowledge base: ${docs.length} documents`);
  for (const d of docs) console.log(`  ${String(d.text.length).padStart(7)} chars  ${d.name}`);
  console.log(`\nASR keywords (${kw.length}): ${kw.join(", ")}`);
  console.log(`\nLLM -> google/gemini-3.7-flash via OpenRouter (key ${OPENROUTER_KEY ? "present" : "MISSING"})`);
  console.log(`data collection: ${Object.keys(DATA_COLLECTION).join(", ")}`);
  console.log(`evaluation criteria: ${EVALUATION.map((e) => e.name).join(", ")}`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  /**
   * ---- webhook tool descriptions live here, not only in the dashboard ----
   *
   * These six tools were created by a one-shot bootstrap (scripts/el-agent.mjs)
   * that doesn't define browse_range at all and can't update anything — it only
   * creates. So the wording the model reads every single turn existed nowhere in
   * this repository. Pinning it from the sync makes the file the source of truth
   * and means a dashboard edit can't quietly drift away from it.
   *
   * The wording matters more than it looks. A lookup answers in under a second,
   * but each one costs a full model round-trip, and the caller hears silence
   * with nothing on screen to say anything is happening.
   */
  /**
   * Everything this run needs, checked before anything is written.
   *
   * The LLM step used to be validated near the end, after the knowledge base
   * had already been uploaded. A missing key therefore aborted the run *between*
   * uploading the new documents and attaching them to the agent, stranding a
   * full set that nothing pointed at — and since the cleanup below only removed
   * documents attached to this agent, those strays could never be reclaimed.
   * Seventy-five of the workspace's ninety-two documents were wreckage from
   * exactly this. Fail before the first write instead.
   */
  if (want("llm") && !OPENROUTER_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set — needed for the custom LLM. Nothing was written.");
  }

  const agent = await (await el(`/agents/${AGENT_ID}`)).json();
  const kbIds = [];

  if (want("kb")) {
    /**
     * Replace our own previous docs so re-running doesn't pile up duplicates.
     *
     * Scoped two ways on purpose. The workspace is shared with other agents
     * (Madeline, for FORM / SEVEN), and a destructive sweep keyed on a loose
     * prefix is exactly how one business's script deletes another's knowledge:
     *   - the name must start with this script's own prefix, AND
     *   - the document must already be attached to THIS agent
     * A document belonging to another agent fails the second test even if
     * someone later gives it a colliding name.
     */
    const attachedToUs = new Set(
      (agent.conversation_config?.agent?.prompt?.knowledge_base ?? []).map((d) => d.id),
    );
    /**
     * Paginated on purpose. A single page_size=100 fetch works today at 33
     * workspace documents, but the count only grows — every other agent's
     * docs count too — and a single-page fetch would silently stop cleaning
     * anything past the first 100 with no error at all, which is exactly the
     * kind of thing that compounds: the docs it fails to clean are the same
     * kind of stray that pushes the workspace further past the page size.
     */
    let existingDocs = [], cursor;
    do {
      const path = `/knowledge-base?page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = await (await el(path)).json();
      existingDocs = existingDocs.concat(page.documents ?? []);
      cursor = page.next_cursor || null;
    } while (cursor);
    for (const d of existingDocs) {
      if (!String(d.name).startsWith(DOC_PREFIX)) continue; // never another business's

      /**
       * Ours, and safe to remove if either:
       *   - it is attached to THIS agent (the copy we're replacing), or
       *   - it is attached to no agent at all (wreckage from a run that died
       *     between uploading and attaching)
       * A document belonging to another agent has that agent listed as a
       * dependent, so it fails both tests even under a colliding name.
       */
      const dependents = d.dependent_agents ?? [];
      const orphaned = dependents.length === 0;
      if (!attachedToUs.has(d.id) && !orphaned) continue;

      // Checked, not assumed: this used to log "removed" unconditionally, so
      // a delete the API silently rejected (rate limit, a transient 5xx,
      // anything) looked identical in the output to one that actually
      // happened — exactly the kind of gap that let orphans accumulate for
      // a long time with every run reporting success.
      const r = await el(`/knowledge-base/${d.id}`, { method: "DELETE" });
      if (r.ok) console.log(`  removed ${orphaned ? "orphaned" : "old"} doc: ${d.name}`);
      else console.warn(`  delete FAILED for ${orphaned ? "orphaned" : "old"} doc "${d.name}": ${r.status}`);
    }
    for (const d of docs) {
      const r = await el("/knowledge-base/text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: d.name, text: d.text }),
      });
      if (!r.ok) throw new Error(`KB upload "${d.name}" failed: ${r.status} ${await r.text()}`);
      const j = await r.json();
      kbIds.push({ type: "text", name: d.name, id: j.id, usage_mode: "auto" });
      console.log(`  uploaded: ${d.name} -> ${j.id}`);
    }
  }

  const prompt = { ...agent.conversation_config.agent.prompt };
  delete prompt.tools; // tool_ids is authoritative; sending both is rejected

  if (want("tools")) await pinToolDescriptions(prompt.tool_ids || []);

  if (want("kb")) {
    prompt.knowledge_base = kbIds;
    /**
     * RAG, because the catalogue is far too big to sit in a prompt — but tuned
     * for a phone call rather than a chat window.
     *
     * The defaults retrieve up to twenty chunks and fifty thousand characters
     * per turn. On a voice call that is paid for twice: once in time-to-first
     * word, and once in the caller sitting in silence wondering if the line
     * dropped. Eight chunks and twelve thousand characters still answers "what
     * does this include" from the real catalogue, and answers it quickly.
     */
    prompt.rag = {
      ...(prompt.rag || {}),
      enabled: true,
      max_retrieved_rag_chunks_count: 8,
      max_documents_length: 12000,
    };
  }
  if (want("settings")) {
    if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY is not set — needed for the custom LLM");
    /**
     * The key has to live in the workspace secret store; the agent config only
     * ever holds a reference to it. Reused if it already exists, so re-running
     * doesn't litter the store with duplicates.
     */
    const secrets = await (await el("/secrets")).json();
    let secret = (secrets.secrets ?? []).find((s) => s.name === "OPENROUTER_API_KEY");
    if (!secret) {
      const r = await el("/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "new", name: "OPENROUTER_API_KEY", value: OPENROUTER_KEY }),
      });
      if (!r.ok) throw new Error(`secret create failed: ${r.status} ${await r.text()}`);
      secret = await r.json();
      console.log(`  stored workspace secret OPENROUTER_API_KEY -> ${secret.secret_id || secret.id}`);
    } else {
      console.log(`  reusing workspace secret OPENROUTER_API_KEY`);
    }

    prompt.llm = "custom-llm";
    prompt.custom_llm = {
      url: "https://openrouter.ai/api/v1",
      model_id: "google/gemini-3.7-flash",
      api_key: { secret_id: secret.secret_id || secret.id },
      request_headers: {},
    };
    // a salesperson at 0 is a robot reading a list
    prompt.temperature = 0.4;
    prompt.built_in_tools = {
      ...(prompt.built_in_tools || {}),
      end_call: {
        name: "end_call",
        description: "End the call once the caller has said goodbye or is clearly finished.",
        type: "system",
        params: { system_tool_type: "end_call" },
      },
    };
  }

  const body = { conversation_config: { agent: { prompt } } };
  if (want("settings")) {
    body.conversation_config.asr = { ...(agent.conversation_config.asr || {}), keywords: kw };
    body.conversation_config.turn = {
      ...(agent.conversation_config.turn || {}),
      /**
       * Backstop only — our own watchdog is the one that should decide.
       *
       * At 25s this fired during ordinary work. A three-item request chains
       * several lookups, each costing a model round-trip, and the caller is
       * silent through all of it because they're waiting: 36 seconds of it in
       * the call that surfaced this. ElevenLabs counts that as dead air and
       * hangs up on a customer who did nothing wrong. Ours reads the same
       * silence correctly — it knows a lookup is running — so this only needs
       * to catch the case where our own timer never runs at all.
       */
      silence_end_call_timeout: 90,
    };
    body.platform_settings = {
      ...(agent.platform_settings || {}),
      data_collection: Object.fromEntries(
        Object.entries(DATA_COLLECTION).map(([k, v]) => [k, { type: v.type, description: v.description, dynamic_variable: "", constant_value: "" }]),
      ),
      evaluation: { criteria: EVALUATION.map((e) => ({ ...e, id: e.name, type: "prompt", use_knowledge_base: false })) },
    };
  }

  const patch = await el(`/agents/${AGENT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!patch.ok) throw new Error(`PATCH failed: ${patch.status} ${await patch.text()}`);

  let after = await (await el(`/agents/${AGENT_ID}`)).json();

  /**
   * Verify the PATCH actually stuck — by id, not by count.
   *
   * Found the hard way: the exact same code, run twice in a row, succeeded
   * once and silently failed once. The failed run's newly-uploaded documents
   * went straight from "just created" to orphaned — the agent's
   * knowledge_base still pointed at whatever it had before, with none of
   * the just-uploaded ids in it. The old success log only ever printed the
   * COUNT ("knowledge base: 14 docs"), which stayed 14 either way, so a run
   * that silently kept last time's stale knowledge (or none at all) looked
   * identical in the output to one that actually updated. Likeliest cause:
   * the agent PATCH references documents created moments earlier, before
   * ElevenLabs' backend has finished indexing them — retrying the same PATCH
   * after a short pause is enough to clear it when it happens.
   */
  if (want("kb")) {
    const attachedIds = new Set((after.conversation_config.agent.prompt.knowledge_base ?? []).map((d) => d.id));
    const wantedIds = kbIds.map((d) => d.id);
    let missing = wantedIds.filter((id) => !attachedIds.has(id));
    for (let attempt = 1; missing.length && attempt <= 3; attempt++) {
      console.warn(`  knowledge_base attach incomplete (${missing.length}/${wantedIds.length} missing) — retrying (${attempt}/3)`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      const retryPrompt = { ...after.conversation_config.agent.prompt, knowledge_base: kbIds };
      delete retryPrompt.tools;
      const retry = await el(`/agents/${AGENT_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_config: { agent: { prompt: retryPrompt } } }),
      });
      if (!retry.ok) throw new Error(`knowledge_base retry PATCH failed: ${retry.status} ${await retry.text()}`);
      after = await (await el(`/agents/${AGENT_ID}`)).json();
      const nowAttached = new Set((after.conversation_config.agent.prompt.knowledge_base ?? []).map((d) => d.id));
      missing = wantedIds.filter((id) => !nowAttached.has(id));
    }
    if (missing.length) {
      throw new Error(
        `knowledge_base attach never stuck after 3 retries — ${missing.length}/${wantedIds.length} documents ` +
          `still not referenced by the agent. Uploaded docs are real but orphaned; re-run the sync, and if this ` +
          `keeps happening it needs escalating to ElevenLabs, not retrying further here.`,
      );
    }

    /**
     * A final sweep, after everything above has actually settled.
     *
     * The scan-then-delete pass earlier in this run works from a snapshot
     * taken before any of this run's own uploads or the final PATCH — so a
     * document that only became orphaned as a SIDE EFFECT of this run's own
     * attach (the previous generation, replaced moments ago) is invisible to
     * that pass by construction, not by a bug in it. Running the same
     * prefix-and-zero-dependents check again now, once the agent's real
     * knowledge_base is confirmed correct, catches exactly that generation
     * with nothing left to race against.
     */
    let sweepDocs = [], sweepCursor;
    do {
      const path = `/knowledge-base?page_size=100${sweepCursor ? `&cursor=${encodeURIComponent(sweepCursor)}` : ""}`;
      const page = await (await el(path)).json();
      sweepDocs = sweepDocs.concat(page.documents ?? []);
      sweepCursor = page.next_cursor || null;
    } while (sweepCursor);
    let swept = 0;
    for (const d of sweepDocs) {
      if (!String(d.name).startsWith(DOC_PREFIX)) continue;
      if ((d.dependent_agents ?? []).length !== 0) continue;
      const r = await el(`/knowledge-base/${d.id}`, { method: "DELETE" });
      if (r.ok) { console.log(`  final sweep removed: ${d.name}`); swept++; }
      else console.warn(`  final sweep: delete failed for ${d.name} (${r.status})`);
    }
    if (!swept) console.log("  final sweep: nothing left to clean");
  }

  const ap = after.conversation_config.agent.prompt;
  console.log(`\napplied:`);
  console.log(`  llm:              ${ap.llm}${ap.custom_llm ? ` (${ap.custom_llm.model_id} @ ${ap.custom_llm.url})` : ""}`);
  console.log(`  temperature:      ${ap.temperature}`);
  console.log(`  knowledge base:   ${(ap.knowledge_base || []).length} docs (ids verified), rag ${ap.rag?.enabled}`);
  console.log(`  asr keywords:     ${(after.conversation_config.asr?.keywords || []).length}`);
  console.log(`  end_call tool:    ${!!ap.built_in_tools?.end_call}`);
  console.log(`  silence timeout:  ${after.conversation_config.turn?.silence_end_call_timeout}`);
  console.log(`  data collection:  ${Object.keys(after.platform_settings?.data_collection || {}).length} fields`);
  console.log(`  evaluation:       ${(after.platform_settings?.evaluation?.criteria || []).length} criteria`);
  console.log(`  tools intact:     ${(ap.tool_ids || []).length}`);
  console.log(`  prompt unchanged: ${ap.prompt === agent.conversation_config.agent.prompt.prompt}`);
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
