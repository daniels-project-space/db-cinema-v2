/** Public, read-only enquiry evidence. A quote never creates a reservation. */
export type GafferEmailQuote = {
  start: string;
  end: string;
  pickupTime?: string;
  returnTime?: string;
  pickupTimeWindow?: { from: string; to: string };
  returnTimeWindow?: { from: string; to: string };
  /** Rates use the longest rental contained by customer-provided time windows. */
  timeWindowPricingConservative?: boolean;
  days: number;
  estimated: boolean;
  timed: boolean;
  stockVerified: boolean;
  availabilityIssue?: "no_common_window" | "combined_stock_changed" | "stock_check_failed";
  availabilityWindow?: { pickupTime: string; returnTime: string; suggested: true };
  requirementsComplete: boolean;
  complete: boolean;
  total: number | null;
  /** A separately quoted, live-checked optional addition; never included in total. */
  recommendedAddOn?: {
    listingId: string;
    title: string;
    slug: string;
    itemType: string;
    label: string;
    fitNote: string;
    quantity: number;
    perDay: number;
    total: number;
    days: number;
    start: string;
    end: string;
    pickupTime: string;
    returnTime: string;
    compatibility: string;
    includedInTotal: false;
  };
  requests: {
    subject: string;
    /** Exact catalogue name used when a customer abbreviation resolved to an owned listing. */
    displaySubject?: string;
    quantity: number;
    quantityUnit?: string;
    fulfilled: number | null;
    availabilityIssue?: "no_common_window" | "combined_stock_changed" | "stock_check_failed" | "minimum_rental_days" | "configuration_conflict";
    /** Closest exact-model listing, when the only offer includes gear the renter excluded. */
    configurationConflict?: {
      title: string;
      slug: string;
      perDay: number;
      total: number;
      availableUnits: number | null;
      verifiedContents: string[];
    };
    /** An option for a longer minimum period; it is never added to the requested rental automatically. */
    minimumRentalOffer?: {
      title: string;
      slug: string;
      minimumDays: number;
      total: number;
      alternative: boolean;
      availability?: "available" | "unavailable" | "unverified";
      end?: string;
      returnTime?: string;
      rentalDays?: number;
      quantity?: number;
      providedUnits?: number;
      priceConservative?: boolean;
      listingId?: string;
    };
    lines: {
      listingId: string;
      title: string;
      /** Concise customer-facing label for an exact single-body request. */
      displayTitle?: string;
      slug: string;
      quantity: number;
      providedUnits?: number;
      perDay: number;
      total: number;
      alternative: boolean;
      inventoryReviewRequired?: boolean;
      verifiedContents?: string[];
    }[];
  }[];
};

type MinimumRentalOffer = NonNullable<GafferEmailQuote["requests"][number]["minimumRentalOffer"]>;

/** Keep email, chat and phone descriptions tied to the same checked option. */
export function minimumRentalOfferText(offer: MinimumRentalOffer, options: { links?: boolean; spoken?: boolean } = {}): string {
  const title = options.links && offer.slug
    ? `[${offer.title}](https://dbcinemarentals.com/gear/${encodeURIComponent(offer.slug)})`
    : offer.title;
  const plural = (offer.quantity ?? 1) > 1;
  const listing = plural ? `${offer.quantity} × ${title}` : title;
  const amount = new Intl.NumberFormat("en-GB", {
    style: "currency", currency: "GBP", minimumFractionDigits: options.spoken ? 0 : 2, maximumFractionDigits: 2,
  }).format(offer.total);
  const duration = offer.rentalDays ?? offer.minimumDays;
  const description = offer.alternative
    ? `An alternative is ${listing}. ${plural ? "These have" : "It has"} a ${offer.minimumDays}-day minimum.`
    : `${listing} ${plural ? "have" : "has"} a ${offer.minimumDays}-day minimum.`;
  if (offer.end && offer.returnTime && offer.availability === "available") {
    const date = new Date(`${offer.end}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
    return `${description} ${plural ? "They're" : "It's"} available with return at ${offer.returnTime} on ${date}; gear hire is ${offer.priceConservative ? "up to " : ""}${amount} for ${duration} rental day${duration === 1 ? "" : "s"}.`;
  }
  if (offer.end && offer.returnTime && offer.availability === "unavailable") {
    const date = new Date(`${offer.end}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
    return `${description} ${plural ? "They aren't" : "It isn't"} available with the other requested gear through ${offer.returnTime} on ${date}.`;
  }
  return `${description} Minimum gear hire is ${amount} for ${offer.minimumDays} days; I couldn't confirm stock for that longer period.`;
}

export function minimumRentalCombinedTotal(quote: GafferEmailQuote): number | null {
  if (!quote.timed || quote.estimated || !quote.requirementsComplete || quote.availabilityIssue) return null;
  if (!quote.requests.some(request => request.minimumRentalOffer)) return null;
  const lines = quote.requests.flatMap(request => request.lines);
  if (lines.some(line => line.alternative) || (lines.length && (!quote.stockVerified || quote.total === null))) return null;
  for (const request of quote.requests) {
    if (request.fulfilled === null) return null;
    const remaining = request.quantity - request.fulfilled;
    if (remaining <= 0) continue;
    const offer = request.minimumRentalOffer;
    if (!offer || offer.availability !== "available" || offer.alternative || (offer.providedUnits ?? 0) < remaining) return null;
  }
  const extra = quote.requests.reduce((sum, request) => sum + (request.minimumRentalOffer?.availability === "available" ? request.minimumRentalOffer.total : 0), 0);
  return Math.round(((quote.total ?? 0) + extra) * 100) / 100;
}

export function minimumRentalNextStep(quote: GafferEmailQuote): string {
  if (quote.estimated) return "What pickup and return dates and times should I check?";
  if (!quote.timed) return "What pickup and return times should I check?";
  const offers = quote.requests.flatMap(request => request.minimumRentalOffer ? [request.minimumRentalOffer] : []);
  if (offers.some(offer => offer.availability === "available")) return "Would that later return work for you?";
  if (offers.some(offer => offer.availability !== "unavailable")) return "I can try checking that longer period again.";
  return "Would another date or a different item work?";
}

/** Build only a fully checked proposal; opening the link is not a reservation. */
export function minimumRentalBasketLines(quote: GafferEmailQuote): { listingId: string; start: number; end: number; pickupTime: string; returnTime: string }[] | null {
  const validTime = (value?: string) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (minimumRentalCombinedTotal(quote) === null || !quote.pickupTime || !quote.returnTime || !validTime(quote.pickupTime) || !validTime(quote.returnTime)) return null;
  const day = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const value = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : NaN;
  };
  const start = day(quote.start), originalEnd = day(quote.end);
  if (!Number.isFinite(start) || !Number.isFinite(originalEnd) || originalEnd < start || originalEnd - start > 365 * 86400000) return null;
  const lines: { listingId: string; start: number; end: number; pickupTime: string; returnTime: string }[] = [];
  for (const request of quote.requests) {
    for (const line of request.lines) {
      if (!line.listingId || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || lines.length + line.quantity > 100) return null;
      for (let i = 0; i < line.quantity; i++) lines.push({ listingId: line.listingId, start, end: originalEnd, pickupTime: quote.pickupTime, returnTime: quote.returnTime });
    }
    if ((request.fulfilled ?? 0) >= request.quantity) continue;
    const offer = request.minimumRentalOffer;
    if (!offer?.listingId || !offer.end || !offer.returnTime || !validTime(offer.returnTime) || !Number.isSafeInteger(offer.quantity) || (offer.quantity ?? 0) < 1 || lines.length + (offer.quantity ?? 0) > 100) return null;
    const end = day(offer.end);
    if (!Number.isFinite(end) || end < originalEnd || end - start > 365 * 86400000) return null;
    for (let i = 0; i < offer.quantity!; i++) lines.push({ listingId: offer.listingId, start, end, pickupTime: quote.pickupTime, returnTime: offer.returnTime });
  }
  return lines.length > 0 && lines.length <= 100 ? lines : null;
}

const INDEPENDENT_QUOTE_QUESTION_RE = /\b(?:where\s+(?:are|is)\s+(?:you|the\s+(?:shop|studio|office))|where(?:'s|\s+is)\s+(?:your|the)\s+(?:location|shop|studio|address)|where\s+can\s+i\s+(?:collect|pick\s+up)|can\s+i\s+(?:collect|pick\s+up)\s+from|(?:collection|pickup)\s+(?:point|location|address|instructions?)|how\s+does\s+collection\s+work|do\s+you\s+(?:offer|allow|provide)\s+collection|\b(?:location|address|delivery|deliver|opening\s+hours|business\s+hours|cancell?ation|refund|deposit|security\s+(?:deposit|payment)|insurance|damage\s+cover|rental\s+terms|polic(?:y|ies)|parking)\b)/i;

const QUOTE_CONTENT_RE = /\b(?:your\s+rental\s+enquiry|indicative\s+proposal|proposal|equipment\s+options?|stock\s+(?:checked|confirmed)|availability\s+(?:checked|confirmed)|full\s+quantity|short\s+by\s+\d|multi[ -]day\s+rates?|rate\s+ladder|daily\s+rate|gear\s+hire(?:\s+(?:total|cost|is))?|rental\s+quote|rental\s+rates?|gear\s+rates?|(?:gear|rental|equipment)\s+(?:price|pricing|cost|total)|checkout|prepared\s+basket|per\s+(?:rental\s+)?day|\d+\s+rental\s+days?|what.{0,50}(?:pickup|return)\s+times?)\b/i;
const QUOTE_STATUS_RE = /\b(?:stock|availability|available|unavailable|confirmed|confirmation|quantity|substitution|alternative)\b/i;
const NON_QUOTE_AVAILABILITY_CONTEXT_RE = /\b(?:collection|collect|delivery|deliver|studio|location|address|opening\s+hours)\b/i;

/**
 * Supplemental narration may answer a separate location, delivery, or policy
 * question, but the structured quote remains the only source for gear, stock,
 * and rental pricing. Drop quote-shaped model text at both narration and email
 * formatting boundaries so it cannot leak into the customer reply.
 */
export function sanitizeQuoteSupplementalAnswer(value: unknown, customerText: unknown): string {
  const source = String(value ?? "").trim();
  const question = String(customerText ?? "");
  if (!source || !INDEPENDENT_QUOTE_QUESTION_RE.test(question)) return "";

  const allowedDepositAnswer = /\b(?:deposit|security\s+(?:deposit|payment))\b/i.test(question);
  const allowedDeliveryFeeAnswer = /\b(?:delivery\s+fee|cost\s+to\s+deliver|delivery\s+cost)\b/i.test(question);
  const parts = source
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map(part => part.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^#{1,6}\s*/, "").trim())
    .filter(Boolean)
    .filter(part => !QUOTE_CONTENT_RE.test(part))
    .filter(part => {
      if (QUOTE_STATUS_RE.test(part) && !NON_QUOTE_AVAILABILITY_CONTEXT_RE.test(part)) return false;
      if (/£\s?\d|\b\d+(?:\.\d+)?\s?(?:GBP|pounds?)\b/i.test(part)) {
        if (allowedDepositAnswer && /\b(?:deposit|security\s+(?:deposit|payment))\b/i.test(part)) return true;
        if (allowedDeliveryFeeAnswer && /\b(?:delivery|deliver)\b/i.test(part)) return true;
        return false;
      }
      return true;
    });

  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 600);
}

const EXPLICIT_NO_ADD_ON_RE = /\b(?:no\s+(?:more\s+)?(?:extras?|additional|optional|accessor(?:y|ies)|add[ -]?ons?|lenses?|mics?|microphones?)|without\s+(?:any\s+)?(?:extras?|additional|optional|accessor(?:y|ies)|add[ -]?ons?|lenses?|mics?|microphones?)|(?:camera|body|kit|package)\s+only|(?:just|only)\s+(?:the\s+)?(?:camera|body|requested\s+(?:item|gear)|kit)\b)/i;

const EXPLICIT_OPTIONAL_ADD_ON_REQUEST_RE = /\b(?:what\s+else\s+(?:do\s+i\s+need|should\s+i\s+(?:get|add|include|bring))|(?:which|what)\s+(?:compatible\s+)?(?:lenses?|mics?|microphones?|audio|lighting|gimbal|tripods?|monitors?|filters?|batter(?:y|ies)|accessories|extras?|upgrades?)\s+(?:would|should|do|can)|(?:recommend|suggest).{0,48}\b(?:lens|lenses|mic|mics|microphones?|audio|lighting|gimbal|tripods?|monitors?|filters?|batter(?:y|ies)|accessories|extras?|add[ -]?ons?|upgrades?)\b|\b(?:build|make|put\s+together|assemble|plan)\b.{0,40}\bkit\b|\b(?:full|complete)\s+(?:gear\s+|camera\s+|interview\s+|production\s+|film\s+|video\s+)?kit\b|\b(?:interview|camera|production|film|video)\s+kit\b)/i;

/** Deterministically respect a customer's request to limit a quote to named gear. */
export function explicitlyNoOptionalAddOns(value: unknown): boolean {
  return EXPLICIT_NO_ADD_ON_RE.test(String(value ?? ""));
}

/** Clear production contexts can justify one optional, live-checked addition. */
export function explicitlyRequestsOptionalAddOns(value: unknown): boolean {
  const text = String(value ?? "");
  return EXPLICIT_OPTIONAL_ADD_ON_REQUEST_RE.test(text) && !explicitlyNoOptionalAddOns(text);
}

const CLEAR_SHOOT_CONTEXT_RE = /\b(?:interview|documentary|commercial|music video|wedding|podcast|live stream|livestream|conference|event|concert|performance|sports?|wildlife|run[ -]and[ -]gun|handheld|low[ -]light|studio shoot|talking head|corporate (?:film|video|shoot)|product shoot|night shoot)\b/i;

/** Offer at most one optional add-on for an explicit ask or a clear shoot need.
 * A camera-only or no-extras instruction always wins over contextual selling.
 */
export function shouldSuggestOptionalAddOns(value: unknown): boolean {
  const text = String(value ?? "");
  if (explicitlyNoOptionalAddOns(text)) return false;
  return explicitlyRequestsOptionalAddOns(text) || CLEAR_SHOOT_CONTEXT_RE.test(text);
}

const EXPLICIT_ALTERNATIVES_RE = /\b(?:alternatives?\s+(?:are\s+)?(?:welcome|fine|okay|ok|acceptable)|substitutes?\s+(?:are\s+)?(?:welcome|fine|okay|ok|acceptable)|(?:open|happy|willing)\s+to\s+(?:(?:consider|accept|use)\s+)?(?:(?:a|an|the|any|some|closest)\s+)?(?:[a-z0-9-]+\s+){0,2}(?:alternatives?|substitutes?)|(?:show|suggest|recommend|offer)\s+(?:me\s+)?(?:some\s+|the\s+closest\s+)?(?:alternatives?|substitutes?|similar(?:\s+(?:items?|models?|gear|cameras?))?|equivalent(?:s)?|other\s+options)|closest\s+(?:matches|options)|any\s+(?:similar|comparable|equivalent|other)\s+(?:items?|models?|options|gear|cameras?))\b/i;
const EXPLICIT_NO_ALTERNATIVES_RE = /\b(?:no|without|not|don't|dont|do\s+not|never|can't|cannot)\s+(?:any\s+)?(?:alternatives?|substitutes?|other\s+options)\b|\b(?:not|don't|dont|do\s+not|never|can't|cannot)\s+(?:(?:be|feel)\s+)?(?:open|happy|willing|interested)\s+to\b|\b(?:don't|dont|do\s+not|never|can't|cannot)\s+(?:show|suggest|recommend|offer)\b|\bexact\s+(?:model|item|configuration)\s+only\b/i;

/** Substitutions are used only when the customer explicitly welcomes them. */
export function explicitlyAllowsAlternatives(value: unknown): boolean {
  const text = String(value ?? "");
  return EXPLICIT_ALTERNATIVES_RE.test(text) && !EXPLICIT_NO_ALTERNATIVES_RE.test(text);
}

/** The email lead is evidence, not an LLM availability assurance. */
export function gafferEmailQuoteIntro(quote: GafferEmailQuote): string {
  const name = (request: GafferEmailQuote["requests"][number]) => request.displaySubject || request.subject;
  const requested = quote.requests.map(request => request.quantity === 1 ? name(request) : request.quantity + " × " + name(request)).join(", ") || "the requested items";
  const count = (request: GafferEmailQuote["requests"][number]) => request.fulfilled === null
    ? "I couldn't verify stock for " + name(request)
    : request.fulfilled === 0
      ? "I couldn't find " + name(request) + " available"
      : request.fulfilled < request.quantity
        ? "I can supply " + request.fulfilled + " of the " + request.quantity + " requested " + name(request)
        : request.quantity === 1
          ? "I have the requested " + name(request) + " available"
          : "I can supply all " + request.quantity + " requested " + name(request);
  const date = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London",
  });
  const period = quote.start === quote.end ? date(quote.start) : date(quote.start) + " to " + date(quote.end);
  const duration = quote.days + " rental day" + (quote.days === 1 ? "" : "s");
  const price = quote.total === null ? "" : quote.timeWindowPricingConservative
    ? " The maximum gear hire cost across those time windows is £" + quote.total.toFixed(2) + " for " + duration + "; the final amount may be lower once the exact times are set."
    : " Gear hire is £" + quote.total.toFixed(2) + " for " + duration + ".";
  const timeWindow = quote.timeWindowPricingConservative
    ? " I checked " +
      (quote.pickupTimeWindow ? "the pickup window (" + quote.pickupTimeWindow.from + "–" + quote.pickupTimeWindow.to + ")" : "pickup at " + quote.pickupTime) +
      " and " +
      (quote.returnTimeWindow ? "the return window (" + quote.returnTimeWindow.from + "–" + quote.returnTimeWindow.to + ")" : "return at " + quote.returnTime) +
      ", using the earliest pickup and latest return."
    : "";

  const minimumPeriodRequests = quote.requests.filter(request => request.minimumRentalOffer);
  if (minimumPeriodRequests.length) {
    const offers = minimumPeriodRequests.map(request => {
      const offer = request.minimumRentalOffer!;
      const partial = request.fulfilled === null
        ? ` I couldn't confirm the requested ${request.displaySubject ?? request.subject} for the current rental period.`
        : request.fulfilled > 0 && request.fulfilled < request.quantity
          ? ` I can supply ${request.fulfilled} of ${request.quantity} ${request.displaySubject ?? request.subject} for the current ${quote.days}-day rental.`
          : "";
      const remaining = request.fulfilled === null ? 0 : request.quantity - request.fulfilled;
      const partialOption = offer.availability === "available" && offer.providedUnits && offer.providedUnits < remaining
        ? ` It covers ${offer.providedUnits} of the ${remaining} still needed.` : "";
      return `${partial} ${minimumRentalOfferText(offer, { links: true })}${partialOption}`.trim();
    });
    const otherRequests = quote.requests.filter(request => !request.minimumRentalOffer);
    const otherConfirmed = otherRequests.filter(request => request.fulfilled !== null && request.fulfilled > 0).map(count);
    const otherStatus = otherConfirmed.length ? `For the other gear, I can supply ${otherConfirmed.join("; ")}. ` : "";
    const basePrice = quote.total !== null ? ` Gear hire for the confirmed items is ${quote.timeWindowPricingConservative ? "up to " : ""}£${quote.total.toFixed(2)} for ${duration}.` : "";
    const combined = minimumRentalCombinedTotal(quote);
    const combinedPrice = combined !== null && quote.total !== null ? ` Together, gear hire would be ${quote.timeWindowPricingConservative ? "up to " : ""}£${combined.toFixed(2)}.` : "";
    return otherStatus + offers.join(" ") + timeWindow + basePrice + combinedPrice + " " + minimumRentalNextStep(quote);
  }

  if (quote.estimated) return "What pickup and return dates would work? I can check " + requested + ".";
  if (quote.availabilityIssue === "no_common_window") {
    return "I couldn't find one pickup and return window for all the requested gear on " + period + ". Would different times work?";
  }
  if (quote.availabilityIssue === "combined_stock_changed" || quote.requests.some(request => request.availabilityIssue === "combined_stock_changed")) {
    const supplied = quote.requests.filter(request => request.fulfilled !== null && request.fulfilled > 0).map(count).join("; ");
    const shortfalls = quote.requests.filter(request => request.fulfilled !== null && request.fulfilled < request.quantity)
      .map(request => (request.quantity - (request.fulfilled ?? 0)) + " more " + name(request)).join("; ");
    return "The final basket check couldn't fit the full request. " + (supplied || "No quantity was confirmed") + "." +
      (shortfalls ? " Short by " + shortfalls + "." : "") + " Would another pickup or return time work?";
  }
  const stockFailed = quote.availabilityIssue === "stock_check_failed" || quote.requests.some(request => request.availabilityIssue === "stock_check_failed");
  if (stockFailed) {
    const confirmed = quote.requests.filter(request => request.fulfilled !== null && request.fulfilled > 0 && request.availabilityIssue !== "stock_check_failed").map(count).join("; ");
    const unresolved = quote.requests.filter(request => request.fulfilled === null || request.availabilityIssue === "stock_check_failed");
    const items = unresolved.length ? unresolved.map(request => request.quantity + " × " + name(request)).join(", ") : requested;
    return (confirmed ? confirmed + ". " : "") +
      "I couldn't verify stock for " + items + " on " + period + ". No quantity is confirmed for those items; I can recheck.";
  }
  if (!quote.stockVerified) {
    if (!quote.timed && !quote.availabilityWindow) return "What pickup and return times would suit on " + period + "? I need both to check " + requested + ".";
    return "I couldn't verify stock for " + requested + " on " + period + ". No quantity is confirmed yet; I can recheck.";
  }

  if (quote.availabilityWindow?.suggested && !quote.timed) {
    const coverage = quote.requests.map(request => request.fulfilled === request.quantity
      ? count(request)
      : request.fulfilled === 0
        ? "none of the " + request.quantity + " requested " + name(request)
        : request.fulfilled === null
          ? "stock not verified for " + request.quantity + " × " + name(request)
          : request.fulfilled + " of " + request.quantity + " requested " + name(request)).join("; ");
    const lead = quote.complete ? "I can quote " + requested : "The date-only check covers " + coverage;
    const estimate = quote.total === null ? "" : " Indicative gear hire is £" + quote.total.toFixed(2) + " for " + duration + ".";
    return lead + " for " + period + "." + estimate + " A possible window is pickup at " + quote.availabilityWindow.pickupTime +
      " and return at " + quote.availabilityWindow.returnTime + ". Would that suit? I'll confirm availability once you confirm those times.";
  }

  const partial = quote.requests.filter(request => request.fulfilled !== null && request.fulfilled < request.quantity);
  if (partial.length) {
    const supplied = quote.requests.filter(request => request.fulfilled !== null && request.fulfilled > 0).map(count).join("; ");
    const shortfalls = partial.map(request => (request.quantity - (request.fulfilled ?? 0)) + " more " + name(request)).join("; ");
    return "For " + period + ", " + (supplied || "I couldn't confirm any of the requested quantity") + "." +
      (shortfalls ? " Short by " + shortfalls + "." : " The full basket did not fit at those times.") +
      " Would another pickup or return time work?" + timeWindow + price;
  }

  if (!quote.requirementsComplete) {
    return "The listed items are available for " + period + ". What else should I include?" + timeWindow + price;
  }
  if (quote.availabilityWindow && quote.timed && !quote.availabilityWindow.suggested) {
    const supply = quote.requests.length === 1 ? count(quote.requests[0]) : "I found the requested gear available";
    return supply + " on " + period + ". Pickup at " + quote.availabilityWindow.pickupTime +
      " and return at " + quote.availabilityWindow.returnTime + " are available. Would those times work?" + price;
  }
  const alternatives = quote.requests.some(request => request.lines.some(line => line.alternative));
  if (alternatives) {
    return "I can cover " + requested + " for " + period + " with the listed alternatives. Please confirm the substitutions." + timeWindow + price;
  }
  const supply = quote.requests.length === 1
    ? count(quote.requests[0])
    : "I have all the requested gear available";
  const times = quote.timeWindowPricingConservative
    ? " across your requested time windows"
    : quote.timed ? " at your requested times" : "";
  return supply + " for " + period + times + "." + timeWindow + price;
}
