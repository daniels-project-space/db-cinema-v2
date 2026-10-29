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
    /** The shortest period on a matching listing, with no availability assumed. */
    minimumRentalOffer?: {
      title: string;
      slug: string;
      minimumDays: number;
      total: number;
      alternative: boolean;
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
      const linked = offer.slug ? `[${offer.title}](https://dbcinemarentals.com/gear/${encodeURIComponent(offer.slug)})` : offer.title;
      const listing = offer.alternative ? `A possible alternative, ${linked},` : linked;
      const partial = request.fulfilled !== null && request.fulfilled > 0 && request.fulfilled < request.quantity
        ? ` I can supply ${request.fulfilled} of ${request.quantity} ${request.displaySubject ?? request.subject} for the current ${quote.days}-day rental.`
        : "";
      return `${partial} ${listing} has a ${offer.minimumDays}-day minimum. Minimum gear hire is £${offer.total.toFixed(2)} for ${offer.minimumDays} days; I haven't checked stock for that longer period.`.trim();
    });
    const otherRequests = quote.requests.filter(request => !request.minimumRentalOffer);
    const otherConfirmed = otherRequests.filter(request => request.fulfilled !== null && request.fulfilled > 0).map(count);
    const otherStatus = otherConfirmed.length ? `For the other gear, I can supply ${otherConfirmed.join("; ")}. ` : "";
    const minimumDays = [...new Set(minimumPeriodRequests.map(request => request.minimumRentalOffer!.minimumDays))];
    const next = quote.estimated
      ? "What dates and pickup and return times should I check?"
      : minimumDays.length === 1
        ? `Would you like me to check it for the full ${minimumDays[0]}-day minimum?`
        : "Would you like me to check those items over their minimum rental periods?";
    return otherStatus + offers.join(" ") + " " + next + (quote.total !== null ? price : "");
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
