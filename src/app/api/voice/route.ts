import { savedCardChargeLimit } from "../../../../shared/rentalSecurity";
import { contentsText } from "../../../../shared/rentalContents";
import { explicitlyNoOptionalAddOns } from "../../../../shared/gafferEmailQuote";
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { quoteRentalEnquiry } from "@/lib/gaffer";
import { deriveItemType } from "../../../../convex/lib/taxonomy";
import { equipmentOfferLabel, equipmentRequest, normalizeEquipmentName } from "../../../../shared/equipmentIdentity";
import { PICKUP_SLOTS } from "@/lib/site";
import { dayMs } from "@/lib/dates";
import { rateLimit } from "@/lib/ratelimit";
import { londonToday, resolveDate, speak } from "@/lib/voiceDates";

/**
 * /api/voice — tool endpoint for the Gaffer voice agent (SignalWire phone line
 * and the in-browser call both land here).
 *
 * Everything the agent says about stock, prices, dates and availability comes
 * from this endpoint, because the model on its own gets all four wrong: it told
 * a caller we don't stock Sony (we have 130 Sony listings), and it checked
 * availability for "tomorrow" against a date in 2023. So the rules live
 * server-side — the catalogue is matched here, the clock is read here, and the
 * agent is handed sentences it can safely say.
 *
 * Auth: shared secret (VOICE_WEBHOOK_SECRET) via `X-Voice-Secret` or `?key=`.
 * Works with Retell ({name,args}) and ElevenLabs (flat body + ?fn=<tool>).
 */
export const maxDuration = 30;

/**
 * Every field that goes into this response is context the model has to read
 * on the next turn — and this is a webhook, not the browser: nothing here
 * ever reaches a screen, so any field that only exists for rendering (a
 * thumbnail URL, a slug, a raw deposit figure Gaffer never quotes) is pure
 * weight with no payoff. Measured on a real "anamorphic lenses" call: the
 * spoken `result` was 278 characters, the `items` array riding alongside it
 * was 2478 bytes — heroImage URLs alone were 460 of that, on a phone line
 * that can't show an image. Trimmed to what a follow-up turn could actually
 * use: the name, spoken from `result` anyway, and the price.
 */
function trimItems(items: unknown): unknown {
  if (!Array.isArray(items)) return items;
  return items.map((i: any) => ({ title: i?.title, daily: i?.daily ?? null }));
}

const say = (result: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({
    result,
    today: londonToday(),
    ...extra,
    ...("items" in extra ? { items: trimItems(extra.items) } : {}),
  });

const money = (n: number | null | undefined) => (n == null ? "" : `£${Math.round(n)}`);

/** Read prices as a range the way a person would, not as a list. */
function priceRange(from: number | null, to: number | null) {
  if (from == null) return "";
  if (to == null || to === from) return `${money(from)} a day`;
  return `from ${money(from)} to ${money(to)} a day`;
}

/** Join item names for speech: "the A, the B and the C". */
function readList(titles: string[]) {
  const t = titles.map((s) => shorten(s));
  if (t.length <= 1) return t[0] ?? "";
  return `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
}

/**
 * Product titles are SEO-stuffed ("Sony fx 3 fx3 full frame 4k cinema camera +
 * 24-70 mm f2.8 zoom lens gmaster..."). Read aloud in full they're unusable, so
 * trim to the part a person would say.
 */
function shorten(title: string): string {
  let t = String(title).split("|")[0].split("(")[0].trim();
  // Drop the "+ extras" tail first — "FX3 + 24-70 + 70-200 + cards" is a
  // keyword list, and the caller only needs the thing it actually is.
  const plus = t.indexOf(" + ");
  if (plus > 12) t = t.slice(0, plus).trim();
  // Titles repeat the model for search ("Sony fx 3 fx3 full frame 4k camera").
  // Collapse consecutive near-duplicate words so it reads like speech.
  const seen = new Set<string>();
  t = t
    .split(/\s+/)
    .filter((w) => {
      const k = w.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!k || k.length < 2) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(" ");
  return t.length > 52 ? `${t.slice(0, 49).trim()}…` : t;
}

type Match = {
  id: string; title: string; slug: string; category: string;
  daily: number | null; deposit: number | null; minDays: number; deal: number | null;
};

/** Phone answers consume the same physical allocation and period prices as email. */
async function rentalQuoteTool(c: ConvexHttpClient, args: any, today: string, availabilityOnly: boolean) {
  const supplied = args.requests === undefined
    ? [
        { subject: args.item ?? args.query, quantity: args.quantity, allowAlternatives: args.allowAlternatives },
        ...Array.from({ length: 7 }, (_, index) => {
          const number = index + 2;
          return { subject: args[`item_${number}`], quantity: args[`quantity_${number}`], allowAlternatives: args[`allowAlternatives_${number}`] };
        }),
      ].filter(input => input.subject !== undefined && input.subject !== null)
    : args.requests;
  const hasOrphanedDetails = args.requests === undefined && Array.from({ length: 7 }, (_, index) => index + 2)
    .some(number => args[`item_${number}`] == null && (args[`quantity_${number}`] !== undefined || args[`allowAlternatives_${number}`] !== undefined));
  if (hasOrphanedDetails) return say("Please confirm the item for each quantity or alternative preference.", { needs: "items" });
  if (!Array.isArray(supplied) || !supplied.length || supplied.length > 8)
    return say("Please confirm the items you need, up to eight at a time.", { needs: "items" });
  if (args.requirementsComplete !== undefined && typeof args.requirementsComplete !== "boolean")
    return say("Please confirm the complete list of items you need.", { needs: "items" });
  if (args.allowOptionalAddOns !== undefined && typeof args.allowOptionalAddOns !== "boolean")
    return say("Please confirm whether you want optional compatible gear suggestions.", { needs: "items" });
  if (supplied.some(input => input?.allowAlternatives !== undefined && typeof input.allowAlternatives !== "boolean"))
    return say("Please confirm whether you would consider an alternative for each item.", { needs: "items" });
  const requests: { subject: string; itemType: string; quantity: number; quantityIsListingUnits: boolean; allowAlternatives: boolean }[] = [];
  for (const input of supplied) {
    if (!input || typeof input !== "object" || typeof input.subject !== "string" || !input.subject.trim() || input.subject.length > 160)
      return say("Please confirm each item you would like to rent.", { needs: "items" });
    const raw = input.subject.trim();
    const request = equipmentRequest(raw);
    const quantity = Number(input.quantity ?? request.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100 || request.explicit && input.quantity !== undefined && quantity !== request.quantity)
      return say("Please confirm the number of complete rental items or kits.", { needs: "quantity" });
    const subject = request.subject;
    if (/\b(?:with|and|plus)\b.{0,60}\b(?:lens|gimbal|microphone|mic|monitor|tripod)\b/i.test(subject))
      return say("Please list each specific item you need so I can quote the complete kit.", { needs: "configuration" });
    const itemType = deriveItemType(normalizeEquipmentName(subject));
    const listingUnits = input.quantityIsListingUnits !== undefined ? input.quantityIsListingUnits === true
      : !(quantity > 1 && itemType === "wireless-mic" && !/\b(?:kits?|sets?|systems?)\b/i.test(raw));
    if (!listingUnits) return say("Do you mean complete wireless microphone kits, or individual microphones and channels?", { needs: "quantity" });
    requests.push({ subject, itemType, quantity, quantityIsListingUnits: true, allowAlternatives: input.allowAlternatives === true });
  }
  const start = args.start ? resolveDate(args.start, today) : null;
  if (start && !start.ok) return say("Please confirm your pickup date before I quote.", { needs: "dates" });
  const end = args.end ? resolveDate(args.end, today) : start;
  if (end && !end.ok) return say("Please confirm your return date before I quote.", { needs: "dates" });
  const startDate = start?.ok ? start.date : undefined, endDate = end?.ok ? end.date : undefined;
  const pickupTime = String(args.pickupTime ?? args.pickup_time ?? "") || undefined;
  const returnTime = String(args.returnTime ?? args.return_time ?? "") || undefined;
  if (startDate && !args.end && (availabilityOnly || pickupTime || returnTime || Number(args.days) > 1))
    return say("What is your return date and time? I need that to quote the full rental period.", { needs: "dates" });
  if (availabilityOnly && !startDate) return say("What are your pickup and return dates and times?", { needs: "dates" });
  if (endDate && startDate && (endDate < startDate || startDate === endDate && pickupTime && returnTime && returnTime <= pickupTime))
    return say("Return must be after pickup. Please confirm the dates and times.", { needs: "times" });
  const timed = !!startDate && !!pickupTime && !!returnTime && PICKUP_SLOTS.includes(pickupTime) && PICKUP_SLOTS.includes(returnTime);
  const first = requests[0];
  const addOnsAllowed = args.allowOptionalAddOns === true && !supplied.some(input => explicitlyNoOptionalAddOns(input?.subject));
  const result = await quoteRentalEnquiry({ ...first, requests, requirementsComplete: args.requirementsComplete !== false,
    allowOptionalAddOns: addOnsAllowed,
    start: startDate, end: endDate, pickupTime, returnTime, days: args.days === undefined ? undefined : Number(args.days) });
  const enquiry = result.enquiry;
  if (!enquiry) throw Error("Rental quote is unavailable");
  const lines = enquiry.requests.flatMap(request => request.lines);
  const requestName = (request: typeof enquiry.requests[number]) => equipmentOfferLabel(request.displaySubject || request.subject);
  const date = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" });
  const period = enquiry.start === enquiry.end ? date(enquiry.start) : date(enquiry.start) + " to " + date(enquiry.end);
  const duration = enquiry.days === 1 ? "the day" : `${enquiry.days} days`;
  const itemNames = lines.map(line => equipmentOfferLabel(line.displayTitle ?? line.title));
  const itemSummary = itemNames.map((title, index) => {
    const line = lines[index];
    const quantity = line.providedUnits ?? line.quantity;
    return `${quantity === 1 ? "one" : quantity} ${title}`;
  }).join(", ");
  const hasAlternatives = lines.some(line => line.alternative);
  const requestIssues = enquiry.requests.filter(request => request.availabilityIssue);
  const minimumPeriodRequests = enquiry.requests.filter(request => request.minimumRentalOffer);
  if (!lines.length) {
    const unresolved = enquiry.requests.filter(request => request.fulfilled === null || request.availabilityIssue === "stock_check_failed");
    const unavailable = enquiry.requests.filter(request => request.fulfilled === 0 && request.availabilityIssue !== "stock_check_failed" && !request.minimumRentalOffer);
    const minimumMessages = minimumPeriodRequests.map(request => {
      const offer = request.minimumRentalOffer!;
      return `${offer.title} has a ${offer.minimumDays}-day minimum. Minimum gear hire is ${money(offer.total)} for ${offer.minimumDays} days, but I haven't checked stock for that longer period.`;
    });
    const message = enquiry.availabilityIssue === "no_common_window"
      ? `I couldn't find one pickup and return window for all that gear on ${period}. Are your times flexible?`
      : minimumMessages.length
        ? `${minimumMessages.join(" ")} Would you like me to check those over their minimum rental periods?`
      : unresolved.length
        ? `I couldn't verify live stock for ${unresolved.map(requestName).join(", ")} on ${period}. Would another time window work?`
        : unavailable.length || enquiry.stockVerified
          ? `I couldn't find ${unavailable.length ? unavailable.map(requestName).join(" or ") : "a matching item"} available on ${period}. Would another date work?`
          : `What pickup and return times suit you on ${period}? I need both to check availability.`;
    return say(message, { needs: "availability", enquiry, items: [] });
  }
  const confirmationSummary = enquiry.requests.map(request => {
    const name = requestName(request);
    if (request.minimumRentalOffer) {
      const offer = request.minimumRentalOffer;
      const partial = request.fulfilled !== null && request.fulfilled > 0 && request.fulfilled < request.quantity
        ? `I can supply ${request.fulfilled} of ${request.quantity} ${name} for the current ${enquiry.days}-day rental; `
        : "";
      return `${partial}${offer.title} has a ${offer.minimumDays}-day minimum. Minimum gear hire is ${money(offer.total)} for ${offer.minimumDays} days; stock for that longer period is not checked.`;
    }
    if (request.fulfilled === null || request.availabilityIssue === "stock_check_failed") return `I couldn't verify stock for ${name}.`;
    if (request.fulfilled === 0) return `I couldn't find ${name} available.`;
    if (request.fulfilled < request.quantity) return `I can supply ${request.fulfilled} of ${request.quantity} ${name}; I'm short by ${request.quantity - request.fulfilled}.`;
    return `I can supply ${request.fulfilled} ${name}.`;
  });
  const configurationConflictRequest = enquiry.requests.find(request => request.configurationConflict);
  const configurationConflict = configurationConflictRequest?.configurationConflict;
  let status: string;
  if (minimumPeriodRequests.length) {
    status = confirmationSummary.join(" ");
  } else if (configurationConflict && configurationConflictRequest) {
    const unavailable = configurationConflict.availableUnits === 0;
    const contents = configurationConflict.verifiedContents.length
      ? ` It includes ${configurationConflict.verifiedContents.join(", ")}.`
      : " Its included contents still need confirmation.";
    const stock = enquiry.timed
      ? configurationConflict.availableUnits === null
        ? "I couldn't verify stock for those times."
        : configurationConflict.availableUnits > 0
          ? `${configurationConflict.availableUnits} of this package ${configurationConflict.availableUnits === 1 ? "is" : "are"} available for those times.`
          : "This package isn't available for those times."
      : unavailable
        ? `I couldn't find this package in stock for ${period}.`
        : "I need your pickup and return times before I can check availability.";
    status = `The ${requestName(configurationConflictRequest)} is listed as ${equipmentOfferLabel(configurationConflict.title)}, which is a different package configuration.${contents} ${stock}`;
  } else if (enquiry.availabilityIssue === "no_common_window") {
    status = `I couldn't find one pickup and return window for all that gear on ${period}.`;
  } else if (enquiry.availabilityIssue === "combined_stock_changed") {
    status = `The final stock check could fit only the confirmed items at those times. ${confirmationSummary.join(" ")}`;
  } else if (requestIssues.some(request => request.availabilityIssue === "stock_check_failed") || enquiry.availabilityIssue === "stock_check_failed") {
    status = confirmationSummary.join(" ");
  } else if (!enquiry.timed && enquiry.complete && enquiry.availabilityWindow?.suggested) {
    status = hasAlternatives
      ? `I found a possible alternative, ${itemSummary}, for ${period}, with pickup at ${enquiry.availabilityWindow.pickupTime} and return at ${enquiry.availabilityWindow.returnTime}.`
      : `I found a possible window for ${itemSummary} on ${period}: pickup at ${enquiry.availabilityWindow.pickupTime} and return at ${enquiry.availabilityWindow.returnTime}.`;
  } else if (enquiry.complete && hasAlternatives && enquiry.availabilityWindow) {
    status = `I can offer ${itemSummary} as an alternative for ${period}, with a suggested ${enquiry.availabilityWindow.pickupTime} pickup and ${enquiry.availabilityWindow.returnTime} return.`;
  } else if (enquiry.complete && hasAlternatives) {
    status = `I can cover the request with ${itemSummary} as an alternative. Would that work for you?`;
  } else if (enquiry.complete && enquiry.availabilityWindow) {
    status = `I found ${itemSummary} for ${period}, with a suggested ${enquiry.availabilityWindow.pickupTime} pickup and ${enquiry.availabilityWindow.returnTime} return.`;
  } else if (enquiry.complete) {
    status = `I found ${itemSummary} for ${period}${timed ? `, with ${pickupTime} pickup and ${returnTime} return` : ""}.`;
  } else {
    status = confirmationSummary.join(" ");
  }
  const price = configurationConflict?.availableUnits === 0
    ? ""
    : configurationConflict
    ? `${!enquiry.timed ? "The listed package estimate" : "Gear hire for the listed package"} is ${money(configurationConflict.total)} for ${duration}.`
    : enquiry.total !== null
    ? `${!enquiry.timed ? "The hire estimate" : enquiry.complete ? "Gear hire" : "Confirmed gear hire"} is ${money(enquiry.total)} for ${duration}.`
    : "I can't give a gear hire total until I can confirm the quantities.";
  const selectedIds = new Set(lines.map(line => line.listingId));
  const packing = (result.cards ?? []).some(card => selectedIds.has(String(card.item?.listingId)) && card.item?.inventoryReviewRequired)
    ? "A few kit contents still need confirmation." : "";
  const addOn = enquiry.recommendedAddOn;
  const recommendation = addOn
    ? `Optional ${addOn.label}: ${equipmentOfferLabel(addOn.title)} ${addOn.fitNote} and is available for ${money(addOn.total)} for ${addOn.days} rental day${addOn.days === 1 ? "" : "s"}. It isn't included in the requested gear-hire total.`
    : "";
  const selectedCards = (result.cards ?? []).filter(card => selectedIds.has(String(card.item?.listingId)));
  const discounted = enquiry.days > 1 && selectedCards.some(card => Number.isFinite(card.item?.saved) && card.item.saved > 0)
    ? "The multi-day discount is already included." : "";
  let next: string;
  if (minimumPeriodRequests.length) {
    const minimumDays = [...new Set(minimumPeriodRequests.map(request => request.minimumRentalOffer!.minimumDays))];
    next = minimumDays.length === 1
      ? `Would you like me to check it for the full ${minimumDays[0]}-day minimum?`
      : "Would you like me to check those items over their minimum rental periods?";
  }
  else if (configurationConflict && configurationConflict.availableUnits === 0) next = "Would another date or pickup window work, or should I look for another FX3 configuration?";
  else if (configurationConflict) next = "Would you accept the included items in that package?";
  else if (requestIssues.some(request => request.availabilityIssue === "stock_check_failed") || enquiry.availabilityIssue === "stock_check_failed") next = "I can recheck the stock if you like.";
  else if (!enquiry.timed && enquiry.availabilityWindow?.suggested) next = "Would those times work? I can confirm availability once you choose them.";
  else if (hasAlternatives && enquiry.availabilityWindow) next = "Would that alternative and those times suit you?";
  else if (hasAlternatives) next = "Would that alternative work for you?";
  else if (enquiry.availabilityWindow) next = "Would those times suit you?";
  else if (enquiry.complete) next = "Would you like to book it? We’ll check the stock again at checkout.";
  else if (enquiry.stockVerified) next = "Would a different date or smaller quantity help?";
  else if (!timed) next = "What pickup and return times would suit you?";
  else next = "Would another date or pickup window help?";
  const message = [status, price, discounted, packing, recommendation, next].filter(Boolean).join(" ");
  return say(message, { enquiry, items: lines.map(line => ({ title: line.displayTitle ?? line.title, daily: line.perDay })), start: enquiry.start, end: enquiry.end, days: enquiry.days });
}

export async function POST(req: NextRequest) {
  const secret = process.env.VOICE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "voice tool is not configured" }, { status: 503 });
  if (secret) {
    const got = req.headers.get("x-voice-secret") || new URL(req.url).searchParams.get("key");
    if (got !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rl = await rateLimit(req, "voice", 40, 60_000);
  if (!rl.allowed) return say("Sorry, the line is busy for a moment — please try again shortly.");

  const body: any = await req.json().catch(() => ({}));
  const name: string =
    body.name || body.function_name || body.function?.name ||
    new URL(req.url).searchParams.get("fn") || "";
  const args: any = body.args || body.arguments || body.function?.arguments || body || {};
  const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const today = londonToday();

  try {
    switch (name) {
      /* ── What do you stock? ───────────────────────────────────────────── */
      case "browse_range":
      case "what_do_you_have": {
        const b: any = await c.query(api.voiceCatalog.browse, { q: String(args.query ?? args.item ?? "") });
        if (!b?.count) {
          const o: any = await c.query(api.voiceCatalog.overview, {});
          const cats = Object.entries(o?.byCategory ?? {})
            .sort((a: any, x: any) => x[1] - a[1]).slice(0, 6)
            .map(([k, v]) => `${v} ${String(k).toLowerCase()}`);
          return say(`We've got ${o?.total ?? 0} items in total — ${readList(cats)}. What are you shooting?`);
        }
        // "405 gear" is not a sentence — fall back to "items" when the caller
        // named neither a brand nor a category.
        const what = [b.brand ? cap(b.brand) : "", b.category ? b.category.toLowerCase() : ""]
          .filter(Boolean).join(" ") || "items";

        // A real call asked for anamorphic lenses. `browse` used to drop
        // "anamorphic" silently and answer for "lenses" in general, so this
        // said "yes" and then read out three lenses that had nothing to do
        // with the question — the caller was told no dedicated glass existed
        // while nineteen real listings sat in the very count just quoted.
        // `askedFor` set with `matchedSpecific` false means the specific word
        // genuinely matched nothing; say that honestly rather than reusing the
        // broad "yes" sentence for a question it never actually answered.
        if (b.askedFor && !b.matchedSpecific) {
          return say(
            `We don't specifically carry dedicated ${b.askedFor}, but we do have ${b.count} ${what}, ` +
            `${priceRange(b.from, b.to)} — like ${readList(b.items.slice(0, 2).map((i: Match) => i.title))}. ` +
            `Would one of those work, or is there something else you had in mind?`,
            { items: b.items },
          );
        }

        return say(
          `Yes — we've got ${b.count} ${what}, ${priceRange(b.from, b.to)}. ` +
          `Popular ones are ${readList(b.items.slice(0, 3).map((i: Match) => i.title))}. ` +
          `Any of those sound right, or shall I narrow it down?`,
          { items: b.items },
        );
      }

      /* ── Do you have X? / how much is X? ──────────────────────────────── */
      case "get_price":
        return await rentalQuoteTool(c, args, today, false);
      case "check_availability":
        return await rentalQuoteTool(c, args, today, true);
      case "check_stock":
      case "find_gear": {
        const q = String(args.item ?? args.query ?? "");
        const s: any = await c.query(api.voiceCatalog.search, { q, limit: 3 });
        const hits: Match[] = s?.matches ?? [];

        // Nothing specific matched — fall back to the range rather than denying
        // stock, which is how "we don't carry Sony camera" happened.
        if (!hits.length) {
          const b: any = await c.query(api.voiceCatalog.browse, { q });
          if (b?.count) {
            return say(
              `I can't find that exact model, but we do have ${b.count} ` +
              `${[b.brand ? cap(b.brand) : "", b.category ? b.category.toLowerCase() : "items"].filter(Boolean).join(" ")}, ` +
              `${priceRange(b.from, b.to)} — like ${readList(b.items.slice(0, 2).map((i: Match) => i.title))}. Would one of those work?`,
              { items: b.items },
            );
          }
          return say(`I couldn't find ${q || "that"} in our catalogue. We're mainly Sony cinema cameras, G Master glass, lighting, audio and drones — what are you shooting?`);
        }

        const top = hits[0];
        const full = await c.query(api.catalog.getListingBySlug,{slug:top.slug});
        const packed = contentsText(full);
        // Say what configurations exist. Gaffer once told a customer the a7 iii
        // "is only offered like that" after being handed a gimbal package —
        // it couldn't see the bare body, so it guessed. State the shape of the
        // options instead, and it never has to.
        const pkgs: Match[] = (s?.packages ?? []).filter((p: Match) => p.id !== top.id);
        const alt = pkgs.length
          ? ` We also do it in ${pkgs.length} package${pkgs.length > 1 ? "s" : ""} — ` +
            `${readList(pkgs.slice(0, 2).map((p) => p.title))}, from ${money(Math.min(...pkgs.map((p) => p.daily ?? 0).filter(Boolean)))} a day.`
          : hits.length > 1
            ? ` We've also got ${readList(hits.slice(1, 3).map((h) => h.title))}.`
            : "";

        return say(
          `Yes — we've got the ${shorten(top.title)}, ${money(top.daily)} a day.${alt} ` +
          `${packed} Want me to check your dates?`,
          { items: hits },
        );
      }

      /* ── Opening hours, delivery, where we are ────────────────────────── */
      case "business_info": {
        const st: any = await c.query(api.settings.get, {}).catch(() => null);
        const bits: string[] = [];
        if (st?.openingHours) bits.push(`We're open ${st.openingHours}`);
        if (st?.deliveryMaxKm) bits.push(`we deliver up to about ${st.deliveryMaxKm} kilometres across London`);
        if (st?.businessAddress) bits.push(`we're at ${st.businessAddress}`);
        bits.push("pickup is from central London and we'll confirm the exact spot when the booking's set");
        return say(`${bits.join(", ")}. Anything else I can help with?`);
      }

      /* ── Capture the lead ─────────────────────────────────────────────── */
      case "request_callback":
      case "capture_lead":
      case "take_booking":
      case "log_inquiry":
      case "report_issue": {
        const nm = String(args.name || "Phone caller").slice(0, 60);
        const phone = String(args.phone || "").slice(0, 40);
        const email = String(args.email || "").slice(0, 80);
        const kind = String(
          args.kind || args.intent ||
          (name === "take_booking" ? "booking" : name === "report_issue" ? "issue" :
            name === "log_inquiry" ? "inquiry" : "callback"),
        ).slice(0, 20);

        const parts = [
          args.message, args.details,
          args.items && `Gear: ${args.items}`,
          (args.start || args.end) && `Dates: ${args.start ?? "?"}${args.end ? `→${args.end}` : ""}`,
        ].filter(Boolean).map((x: any) => String(x)).join(" — ");

        // Do NOT swallow this. Previously a failed insert still produced
        // "I've noted that and passed it to the team", so the caller hung up
        // happy and the lead vanished with no trace anywhere.
        try {
          await c.mutation(api.voice.lead, {
            kind, name: nm,
            phone: phone || undefined,
            email: email || undefined,
            message: (parts || "(no details)").slice(0, 800),
          });
        } catch (err) {
          console.error("[voice] LEAD CAPTURE FAILED", { kind, nm, hasPhone: !!phone, err });
          return say(
            `Sorry ${nm} — I couldn't save that just now. The best thing is to call us back or drop us an email, ` +
            `and I'd rather tell you than have it go missing. Apologies about that.`,
            { lead_saved: false },
          );
        }

        if (!phone && !email) {
          return say(`Thanks ${nm} — what's the best number or email to reach you on? I want to make sure the team can get back to you.`, { lead_saved: true, needs: "contact" });
        }
        return say(
          kind === "booking"
            ? `Brilliant ${nm}, I've got those booking details down and sent them straight to the team — they'll confirm availability and the total with you shortly. Anything else?`
            : `Thanks ${nm}, that's noted and passed to the team — they'll come back to you. Anything else I can help with?`,
          { lead_saved: true },
        );
      }

      default:
        return say("Sorry, I didn't quite catch that — could you say it again?");
    }
  } catch (err) {
    console.error("[voice] tool error", { name, err });
    return say("Sorry, I'm having trouble checking that right now. Can I take your number and have the team call you straight back?");
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Some agents probe the URL with GET first — return a simple health response.
export async function GET() {
  return NextResponse.json({ ok: true, service: "db-cinema voice webhook", today: londonToday() });
}
