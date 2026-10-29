/**
 * Parsing for inbound email replies to Gaffer follow-ups.
 *
 * Lives here rather than in the route so it can be tested directly — a Next
 * route file may only export handlers and config, and this is the part most
 * likely to break quietly when a mail provider changes its payload shape.
 *
 * Handles the Resend / Postmark / SendGrid shapes, which disagree about
 * capitalisation, nesting and whether recipients are strings or arrays.
 */

/** gaffer+<key>@domain — the key that says which conversation this belongs to. */
export function replyKeyFrom(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const s = typeof c === "string" ? c : Array.isArray(c) ? c.join(",") : "";
    const m = s.match(/gaffer\+([a-f0-9]{8,64})@/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Just the new text.
 *
 * Without this Gaffer answers the entire quoted history every time, and each
 * round-trip gets longer — by the third reply it is reading the whole thread
 * back to the customer.
 */
export function newTextOnly(body: string): string {
  return String(body ?? "")
    .replace(/\r/g, "")
    .split(/^\s*(?:On .+?wrote:|-{2,}\s*Original Message|_{5,}|>{1,}\s?)/m)[0]
    .trim()
    .slice(0, 4000);
}

/** "Dan <dan@x.com>" and "dan@x.com" both mean dan@x.com. */
export function senderFrom(payload: any): string {
  const raw =
    payload?.from?.email ??
    payload?.From ??
    payload?.from ??
    payload?.sender ??
    payload?.envelope?.from ??
    "";
  const s = typeof raw === "string" ? raw : "";
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

const HUMAN_CONTACT_REQUEST_RE = /\b(?:can you|could you|would you|may i|can i|could i|please|i(?:['’]d like| would like| want| need| prefer| request))\b[^.!?;,\n]{0,40}\b(?:speak|talk|chat|connect|transfer|put me through|escalate|hand(?: me)? off|contact|email|call|phone|ring|reach out|get back|respond|reply)\b[^.!?;,\n]{0,40}\b(?:human|real person|person|someone|somebody|team member|(?:your|the) team|staff|(?:live|support) agent|(?:the )?owner|support)\b/i;
const PERSON_CONTACT_REQUEST_RE = /\b(?:can|could|would|please)\s+(?:human|real person|person|someone|somebody|team member|(?:your|the) team|staff|(?:live|support) agent|(?:the )?owner|support)\b[^.!?;,\n]{0,40}\b(?:call|phone|ring|email|contact|reach(?: out)?|get back|follow up|respond|reply)\b[^.!?;,\n]{0,20}\b(?:me|us)\b|\b(?:can you|could you|would you|please)\b[^.!?;,\n]{0,35}\b(?:have|ask|send|connect|put|pass|forward)\b[^.!?;,\n]{0,35}\b(?:human|real person|person|someone|somebody|team member|(?:your|the) team|staff|(?:live|support) agent|(?:the )?owner|support)\b[^.!?;,\n]{0,35}\b(?:call|phone|ring|email|contact|reach(?: out)?|get back|follow up|respond|reply)\b[^.!?;,\n]{0,20}\b(?:me|us)\b/i;
const HUMAN_DIRECT_REQUEST_RE = /\b(?:i(?:['’]d| would| want| need| prefer| request)|can i|could i|may i)\b[^.!?;,\n]{0,24}\b(?:human|real person|person|live agent|support agent|someone|somebody)\b(?:\s+to\s+(?:speak|talk|chat)\s+(?:to|with))?\s*(?:please)?$/i;
const NEGATED_HUMAN_REQUEST_RE = /\b(?:(?:i\s+)?(?:do not|don't|dont|never|not looking for|not asking for|don't want|do not want|don't need|do not need|no need for|no need to|not interested in|unable to|not able to|can't|cannot)|(?:can|could|would)\s+you\s+not)\b[^.!?;,\n]{0,55}\b(?:human|real person|person|someone|somebody|team member|(?:your|the) team|staff|(?:live|support) agent|(?:the )?owner|support)\b/i;
const NEGATED_CALLBACK_REQUEST_RE = /\b(?:do not|don't|dont|never|not|can't|cannot)\b[^.!?;,\n]{0,20}\b(?:call|phone|ring|callback)\b/i;
const CALLBACK_REQUEST_RE = /\b(?:please\s+)?(?:call|phone|ring)\s+me(?:\s+back)?(?:\s+please)?\b|\b(?:can|could|would)\s+(?:you|someone|somebody|anyone|the team|the owner|a person|a human)\s+(?:please\s+)?(?:call|phone|ring)\s+me(?:\s+back)?\b|\b(?:can|could|would|please)\s+(?:you\s+)?(?:arrange|schedule|set up)\s+(?:a\s+)?callback\b|\b(?:i(?:['’]d| would| want| need| prefer)\s+(?:a\s+)?callback)\b/i;

/** Escalate only an explicit request for a person or a callback. Include the subject,
 * and evaluate clauses independently so a negated mention does not trigger a handoff. */
export function isHumanHandoffRequested(subject: string, body: string): boolean {
  const clauses = `${subject ?? ""}\n${body ?? ""}`.split(/[.!?;,\n]+/);
  return clauses.some((value) => {
    const clause = value.trim();
    if (!clause || NEGATED_HUMAN_REQUEST_RE.test(clause) || NEGATED_CALLBACK_REQUEST_RE.test(clause)) return false;
    return CALLBACK_REQUEST_RE.test(clause) || HUMAN_CONTACT_REQUEST_RE.test(clause) || PERSON_CONTACT_REQUEST_RE.test(clause) || HUMAN_DIRECT_REQUEST_RE.test(clause);
  });
}

/** Stop an exact-model request from leaving the email route as a different model or bundle. */
export function hasSpecificModelQuoteMismatch(customerText: string, enquiry?: import("../../shared/gafferEmailQuote").GafferEmailQuote): boolean {
  const requestedModels = equipmentModelTokens(String(customerText ?? ""));
  if (!enquiry || !requestedModels.length) return false;
  const acceptsAlternatives = explicitlyAllowsAlternatives(customerText);
  return enquiry.requests.some(request => {
    const requestModels = equipmentModelTokens(request.displaySubject || request.subject);
    const requestModelMismatch = requestModels.length > 0 && !requestModels.some(model => requestedModels.includes(model));
    if (requestModelMismatch && !(acceptsAlternatives && request.lines.length > 0 && request.lines.every(line => line.alternative))) return true;
    const expectedModels = requestModels.length
      ? requestModels.filter(model => requestedModels.includes(model))
      : requestedModels;
    return request.lines.some(line => {
      if (line.alternative && acceptsAlternatives) return false;
      const offerModels = equipmentModelTokens(equipmentOfferLabel(line.displayTitle || line.title));
      return !expectedModels.some(model => offerModels.includes(model)) ||
        offerModels.some(model => !expectedModels.includes(model));
    });
  });
}

/** Preserve Gaffer's exact catalogue cards in email, where there is no separate card UI. */
export function formatGafferEmailReply(reply: string, cards: unknown, enquiry?: import("../../shared/gafferEmailQuote").GafferEmailQuote, preparedBasketUrl?: string, additionalAnswer?: string, recipientName?: string, customerText?: string): string {
  const gbp = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
  const date = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
  const label = (value: string) => equipmentOfferLabel(value).replace(/[\[\]]/g, "");
  const link = (title: string, slug: string) => slug ? "[" + label(title) + "](https://dbcinemarentals.com/gear/" + encodeURIComponent(slug) + ")" : label(title);
  const rows: any[] = Array.isArray(cards) ? cards : [];
  const customer = String(customerText ?? "");
  const firstName = String(recipientName ?? "").trim().replace(/^['"]|['"]$/g, "").split(/\s+/)[0] ?? "";
  const greeting = /^[\p{L}][\p{L}\p{M}'’-]{0,31}$/u.test(firstName) ? `Hi ${firstName},` : "Hi there,";
  const sections: string[] = [greeting];
  const requestedModels = equipmentModelTokens(customer);
  const mismatchedSpecificQuote = hasSpecificModelQuoteMismatch(customer, enquiry);

  if (mismatchedSpecificQuote) {
    const requestedItem = requestedModels.length === 1 ? `the ${requestedModels[0].toUpperCase()}` : "your requested model";
    const hasTime = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b(?:[01]?\d|2[0-3])\s*(?:am|pm)\b|\b(?:at|around|about)\s+(?:[01]?\d|2[0-3])\b/i.test(customer);
    sections.push(`I have your request for ${requestedItem}. I couldn't verify an exact match in this quote, so I won't send a different camera or bundle. ${hasTime ? "Could another pickup and return time work?" : "What pickup and return times should I check?"}`);
    const independentAnswer = sanitizeQuoteSupplementalAnswer(additionalAnswer, customer);
    if (independentAnswer) sections.push(independentAnswer);
  } else if (enquiry) {
    const period = enquiry.start === enquiry.end ? date(enquiry.start) : date(enquiry.start) + " to " + date(enquiry.end);
    const subjectLabel = (request: typeof enquiry.requests[number]) => label(request.displaySubject || request.subject);
    const requested = enquiry.requests.map(request => request.quantity + " × " + subjectLabel(request)).join(", ") || "the requested gear";
    const lines = enquiry.requests.flatMap(request => request.lines.map(line => ({ request, line })));
    const hasAlternative = lines.some(({ line }) => line.alternative);
    const pickupWindow = enquiry.pickupTimeWindow
      ? `pickup between ${enquiry.pickupTimeWindow.from} and ${enquiry.pickupTimeWindow.to}`
      : enquiry.pickupTime ? `pickup at ${enquiry.pickupTime}` : "pickup time";
    const returnWindow = enquiry.returnTimeWindow
      ? `return between ${enquiry.returnTimeWindow.from} and ${enquiry.returnTimeWindow.to}`
      : enquiry.returnTime ? `return at ${enquiry.returnTime}` : "return time";
    const unresolved = enquiry.requests.filter(request => request.fulfilled === null || request.availabilityIssue === "stock_check_failed");
    const partial = enquiry.requests.filter(request => request.fulfilled !== null && request.fulfilled < request.quantity);
    const configurationConflicts = enquiry.requests.filter(request => request.configurationConflict);
    const confirmed = enquiry.requests.filter(request => request.fulfilled !== null && request.fulfilled > 0 && !unresolved.includes(request))
      .map(request => request.fulfilled! < request.quantity
        ? `${request.fulfilled} of ${request.quantity} ${subjectLabel(request)} for this ${enquiry.days}-day rental`
        : `${request.fulfilled} × ${subjectLabel(request)}`);
    const minimumPeriodRequests = enquiry.requests.filter(request => request.minimumRentalOffer);
    const compactSingleItemQuote = enquiry.stockVerified && enquiry.complete && enquiry.requirementsComplete &&
      !enquiry.timeWindowPricingConservative && enquiry.availabilityIssue === undefined &&
      enquiry.requests.length === 1 && enquiry.requests[0].quantity === 1 &&
      lines.length === 1 && !lines[0].line.alternative && !lines[0].line.inventoryReviewRequired &&
      minimumPeriodRequests.length === 0 && enquiry.total !== null;

    if (minimumPeriodRequests.length) {
      const minimumText = minimumPeriodRequests.map(request => {
        const offer = request.minimumRentalOffer!;
        const offerTitle = link(offer.title, offer.slug);
        const listing = offer.alternative ? `A possible alternative, ${offerTitle},` : offerTitle;
        const shortPeriod = enquiry.estimated ? "" : ` Your request is for ${enquiry.days} rental day${enquiry.days === 1 ? "" : "s"}, which is below that minimum.`;
        return `${listing} has a ${offer.minimumDays}-day minimum.${shortPeriod} Minimum gear hire is ${gbp(offer.total)} for ${offer.minimumDays} days. I haven't checked stock for that longer period.`;
      });
      const minimumDays = [...new Set(minimumPeriodRequests.map(request => request.minimumRentalOffer!.minimumDays))];
      const next = enquiry.estimated
        ? "What dates and pickup and return times should I check?"
        : minimumDays.length === 1
          ? `Would you like me to check it for the full ${minimumDays[0]}-day minimum?`
          : "Would you like me to check those items over their minimum rental periods?";
      const confirmedTotal = enquiry.total !== null && confirmed.length
        ? ` Gear hire for the confirmed items is ${gbp(enquiry.total)} for ${enquiry.days} rental day${enquiry.days === 1 ? "" : "s"}.`
        : "";
      sections.push([...confirmed.length ? [`I can supply ${confirmed.join(", ")}.`] : [], ...minimumText, confirmedTotal, next].filter(Boolean).join(" "));
    } else if (configurationConflicts.length) {
      sections.push(configurationConflicts.map(request => {
        const conflict = request.configurationConflict!;
        const offer = link(conflict.title, conflict.slug);
        const contents = conflict.verifiedContents.length
          ? ` It includes ${conflict.verifiedContents.join(", ")}.`
          : " I don't have verified details of its included contents yet.";
        const unavailable = conflict.availableUnits === 0;
        const stock = enquiry.timed
          ? conflict.availableUnits === null
            ? "I couldn't verify stock for your selected times."
            : conflict.availableUnits > 0
              ? `${conflict.availableUnits} of this package ${conflict.availableUnits === 1 ? "is" : "are"} available for your selected times.`
              : "This package isn't available for your selected times."
          : unavailable
            ? `I couldn't find this package in stock for ${period}.`
            : "I need your pickup and return times before I can confirm availability.";
        const price = unavailable ? "" : ` One listing is ${gbp(conflict.total)} for ${enquiry.days === 1 ? "the day" : `${enquiry.days} days`}.`;
        const next = unavailable
          ? "Would another time or date work, or should I look for another FX3 configuration?"
          : "Would you accept this package?";
        return `The ${subjectLabel(request)} is listed as ${offer}, with a different package configuration.${contents} ${stock}${price} ${next}`;
      }).join("\n\n"));
    } else if (enquiry.estimated) {
      sections.push(`What dates and pickup and return times would suit for ${requested}?`);
    } else if (enquiry.availabilityIssue === "no_common_window") {
      sections.push(`I couldn't find one pickup and return window for all the gear on ${period}. Could you move either time?`);
    } else if (unresolved.length) {
      const names = unresolved.map(request => `${request.quantity} × ${subjectLabel(request)}`).join(", ");
      sections.push(`${confirmed.length ? `I can supply ${confirmed.join(", ")}. ` : ""}I couldn't verify stock for ${names} on ${period}, so I can't confirm those quantities yet. Could you try a different time?`);
    } else if (enquiry.availabilityIssue === "combined_stock_changed") {
      const status = enquiry.requests.map(request => request.fulfilled === 0
        ? `none of the ${request.quantity} requested ${subjectLabel(request)}`
        : request.fulfilled !== null && request.fulfilled < request.quantity
          ? `${request.fulfilled} of the ${request.quantity} requested ${subjectLabel(request)}`
          : request.fulfilled !== null ? `${request.fulfilled} × ${subjectLabel(request)}` : "").filter(Boolean).join(", ");
      const short = enquiry.requests.reduce((sum, request) => sum + Math.max(0, request.quantity - (request.fulfilled ?? 0)), 0);
      sections.push(`The final stock check for ${period} confirmed ${status}${short ? `; we're short by ${short}` : ""}. Would another time work?`);
    } else if (compactSingleItemQuote && enquiry.total !== null && !enquiry.timed) {
      const line = lines[0].line;
      const item = link(line.displayTitle || line.title, line.slug);
      const duration = enquiry.days === 1 ? "the day" : `${enquiry.days} days`;
      const window = enquiry.availabilityWindow?.suggested
        ? `A possible window is pickup at ${enquiry.availabilityWindow.pickupTime} and return at ${enquiry.availabilityWindow.returnTime}; I’ll confirm availability once you tell me those times suit.`
        : "What pickup and return times should I check?";
      const card = rows.find(row => String(row?.item?.listingId) === line.listingId);
      const discountNote = enquiry.days > 1 && Number.isFinite(card?.item?.saved) && card.item.saved > 0
        ? " The multi-day rate is already included."
        : "";
      sections.push(`The ${item} would be ${gbp(enquiry.total)} for ${duration} on ${period}. ${window}${discountNote}`);
    } else if (compactSingleItemQuote && enquiry.total !== null) {
      const line = lines[0].line;
      const item = link(line.displayTitle || line.title, line.slug);
      const availability = enquiry.availabilityWindow
        ? `The ${item} is available on ${period}. I can offer pickup at ${enquiry.availabilityWindow.pickupTime} and return at ${enquiry.availabilityWindow.returnTime}. Would that work for you?`
        : `The ${item} is available on ${period}. Pickup at ${enquiry.pickupTime} and return at ${enquiry.returnTime} both work.`;
      const card = rows.find(row => String(row?.item?.listingId) === line.listingId);
      const discountNote = enquiry.days > 1 && Number.isFinite(card?.item?.saved) && card.item.saved > 0
        ? " The multi-day rate is already included."
        : "";
      sections.push(`${availability} Gear hire is ${gbp(enquiry.total)} for ${enquiry.days === 1 ? "the day" : `${enquiry.days} days`}.${discountNote}`);
    } else if (enquiry.timeWindowPricingConservative) {
      sections.push(`I have ${requested} available on ${period}. I checked ${pickupWindow} and ${returnWindow}.`);
    } else if (enquiry.availabilityWindow) {
      const window = enquiry.availabilityWindow;
      const option = hasAlternative ? "I found an alternative that fits" : `I have ${requested} available`;
      sections.push(`${option} on ${period}. The available window is pickup at ${window.pickupTime} and return at ${window.returnTime}. Would that work for you?`);
    } else if (enquiry.stockVerified && partial.length) {
      const unavailable = partial.filter(request => request.fulfilled === 0);
      if (unavailable.length === partial.length && !confirmed.length) {
        sections.push(`I couldn't find ${unavailable.map(subjectLabel).join(", ")} available on ${period}. Are your dates flexible?`);
      } else {
        const coverage = partial.map(request => `${request.fulfilled ?? 0} of the ${request.quantity} requested ${subjectLabel(request)}`).join(", ");
        const short = partial.reduce((sum, request) => sum + request.quantity - (request.fulfilled ?? 0), 0);
        const supplied = confirmed.length ? `${confirmed.join(", ")} are available. ` : "";
        sections.push(`${supplied}I can supply ${coverage}${short ? `; I'm short by ${short}` : ""} on ${period}. Are your dates flexible?`);
      }
    } else if (enquiry.stockVerified && hasAlternative) {
      sections.push(`I found an available alternative for ${period}. Would you like to consider it?`);
    } else if (enquiry.stockVerified && enquiry.complete) {
      sections.push(enquiry.timed
        ? `Yes, ${requested} is available for ${period}. Pickup at ${enquiry.pickupTime} and return at ${enquiry.returnTime} work.`
        : `I have ${requested} available on ${period}. What pickup and return times would suit you?`);
    } else if (!enquiry.timed) {
      sections.push(`I can check ${requested} for ${period}. What pickup and return times do you have in mind?`);
    } else {
      sections.push(`I couldn't confirm ${requested} for ${period}. Would a different time work?`);
    }

    if (enquiry.timeWindowPricingConservative) {
      sections.push("I've priced the full time windows, so this is the maximum hire cost. The total may be lower once you choose exact times.");
    }

    if (lines.length && !compactSingleItemQuote) {
      const lineText = lines.map(({ request, line }) => {
        const suppliedUnits = typeof line.providedUnits === "number" && Number.isSafeInteger(line.providedUnits) ? line.providedUnits : line.quantity;
        const packNote = suppliedUnits > line.quantity ? ` (one listing supplies ${suppliedUnits} × ${subjectLabel(request)})` : "";
        const alternative = line.alternative ? " (alternative; please confirm)" : "";
        const duration = enquiry.days === 1 ? "for the day" : `for ${enquiry.days} days`;
        return `${line.quantity} × ${link(line.displayTitle || line.title, line.slug)}: ${gbp(line.total)} ${duration}${alternative}${packNote}`;
      });
      sections.push(lineText.join("\n"));
      const contentNotes = lines.flatMap(({ line }) => line.inventoryReviewRequired
        ? [line.verifiedContents?.length
          ? `Owner-confirmed contents: ${line.verifiedContents.join(", ")}. Other seller-listed accessories still need checking.`
          : "The owner hasn't confirmed all the listing contents yet."]
        : []);
      if (contentNotes.length) sections.push(contentNotes.join("\n"));
      if ((lines.length > 1 || enquiry.requests.length > 1 || !enquiry.complete) && enquiry.total !== null) {
        const totalLabel = enquiry.timeWindowPricingConservative ? "Maximum gear hire" : hasAlternative ? "Total for this option" : enquiry.complete ? "Total gear hire" : "Confirmed gear hire";
        sections.push(`${totalLabel}: ${gbp(enquiry.total)} for ${enquiry.days} day${enquiry.days === 1 ? "" : "s"}.`);
      } else if (lines.length === 1 && enquiry.days > 1) {
        const card = rows.find(row => String(row?.item?.listingId) === lines[0].line.listingId);
        if (Number.isFinite(card?.item?.saved) && card.item.saved > 0) sections.push(`The multi-day discount is already included.`);
      }
    }

    if (enquiry.recommendedAddOn) {
      const addOn = enquiry.recommendedAddOn;
      sections.push(`If useful, ${link(addOn.title, addOn.slug)} ${addOn.fitNote}. It adds ${gbp(addOn.total)} for ${addOn.days} day${addOn.days === 1 ? "" : "s"} and isn't included above.`);
    }
    const clarification = enquiry.requests.find(request => request.quantityUnit);
    if (clarification) sections.push(`How many complete ${clarification.quantityUnit} would you like?`);
    const extraAnswer = sanitizeQuoteSupplementalAnswer(additionalAnswer, customerText);
    if (extraAnswer) sections.push(extraAnswer);
    if (preparedBasketUrl) sections.push(`[Review your gear and continue to checkout](${preparedBasketUrl})`);
    else if (lines.length && enquiry.timed) sections.push("Availability is checked again when you book.");
  } else {
    const text = String(reply ?? "").trim();
    const ungroundedQuote = /(?:your rental enquiry|indicative proposal|provisional gear quote|equipment options? and stock checked|quantity not yet confirmed|proposed alternative|multi[ -]day rates per unit|rate ladder)/i.test(text) ||
      /£\s?\d/.test(text) && /\b(?:rental|gear|hire|quote|price|stock|availability|available)\b/i.test(text);
    const rentalDateMentioned = /\b(?:20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(customer);
    const rentalRequestWithoutQuote = requestedModels.length > 0 &&
      (rentalDateMentioned || /\b(?:rent|hire|book|quote|price|cost|available|availability|rental)\b/i.test(customer));
    if (ungroundedQuote || rentalRequestWithoutQuote) {
      const requestedItem = requestedModels.length === 1 ? `the ${requestedModels[0].toUpperCase()}` : "your requested gear";
      const hasTime = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b(?:[01]?\d|2[0-3])\s*(?:am|pm)\b|\b(?:at|around|about)\s+(?:[01]?\d|2[0-3])\b/i.test(customer);
      const nextStep = rentalDateMentioned
        ? hasTime
          ? "I couldn't verify the exact listing and live stock for that window in this reply, so I won't quote a substitute."
          : "What pickup and return times should I check for that date? I’ll confirm the exact listing, live stock and gear-only price."
        : "What rental dates and pickup and return times should I check? I’ll confirm the exact listing, live stock and gear-only price.";
      sections.push(`I have your request for ${requestedItem}. ${nextStep}`);
      const independentAnswer = sanitizeQuoteSupplementalAnswer(additionalAnswer, customer) || sanitizeQuoteSupplementalAnswer(text, customer);
      if (independentAnswer) sections.push(independentAnswer);
    } else {
      if (text) sections.push(text);
      const options = [...new Map(rows.filter(card => card?.item?.listingId != null &&
        !(Number.isSafeInteger(card.item.availableUnits) && card.item.availableUnits === 0))
        .map(card => [String(card.item.listingId), card])).values()].slice(0, 2);
      if (options.length) {
        sections.push(options.map(card => {
          const item = card.item;
          const price = Number.isFinite(item.perDay) ? `£${gbp(item.perDay).replace(/^£/, "")}/day` : "";
          const requestedMicKits = Number.isSafeInteger(item.requestedMicKitCount) && item.requestedMicKitCount > 0 ? item.requestedMicKitCount : null;
          const available = Number.isSafeInteger(item.availableUnits) ? item.availableUnits : null;
          const count = requestedMicKits !== null
            ? available === null ? `${requestedMicKits} complete mic kits requested; stock not confirmed`
              : available >= requestedMicKits ? `${available} complete mic kits available`
                : `${available} of ${requestedMicKits} complete mic kits available; short by ${requestedMicKits - available}`
            : available !== null && available > 0 ? `${available} available` : "";
          return `${link(String(item.title ?? "Gear option"), String(item.slug ?? ""))}${price ? `: ${price}` : ""}${count ? ` (${count})` : ""}`;
        }).join("\n"));
      }
    }
  }

  sections.push("DB Cinema Rentals Team");
  return sections.filter(Boolean).join("\n\n");
}

/** Every place a provider might put the recipient address. */
export function recipientCandidates(msg: any): unknown[] {
  return [
    msg?.to,
    msg?.To,
    msg?.envelope?.to,
    msg?.OriginalRecipient,
    msg?.recipient,
    msg?.headers?.to,
  ];
}

/** Providers disagree on where the plain-text body lives. */
export function plainBody(msg: any): string {
  return msg?.text ?? msg?.TextBody ?? msg?.plain ?? msg?.["body-plain"] ?? "";
}
import { equipmentModelTokens, equipmentOfferLabel } from "../../shared/equipmentIdentity";
import { explicitlyAllowsAlternatives, sanitizeQuoteSupplementalAnswer } from "../../shared/gafferEmailQuote";
