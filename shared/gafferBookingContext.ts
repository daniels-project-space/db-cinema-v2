import { isKeepRentalExtensionIntent } from "./rentalExtensionConversation";
import { verificationValidUntil } from "./verificationProgress";
import { tierByKey } from "./membership";
import { loyaltyPercent } from "./rentalBenefits";
import { gafferVerificationCheckFacts } from "./gafferVerificationFacts";

type RentalLine = {
  title?: unknown;
  qty?: unknown;
  start?: unknown;
  end?: unknown;
  returnTime?: unknown;
  lineTotal?: unknown;
};

type RentalRecord = {
  status?: unknown;
  idVerifyStatus?: unknown;
  idVerificationSource?: unknown;
  verificationProvider?: unknown;
  idVerifiedAt?: unknown;
  verifiedAt?: unknown;
  paidConfirmedAt?: unknown;
  verificationExpiresAt?: unknown;
  verificationChecks?: unknown;
  verificationLateApprovalBlocked?: unknown;
  total?: unknown;
  subtotal?: unknown;
  discount?: unknown;
  creditApplied?: unknown;
  membershipCreditApplied?: unknown;
  cancellation?: {
    termsVersion?: unknown;
    termsText?: unknown;
    policy?: unknown;
    timingBasis?: unknown;
    decisionPending?: unknown;
  } | null;
  handoverDetails?: { pickupAddress?: unknown; returnAddress?: unknown; phone?: unknown; pickupInstructions?: unknown } | null;
  fulfilment?: unknown;
  deliveryLegs?: unknown;
  deliveryFee?: unknown;
  lineItems?: unknown;
  pickupTime?: unknown;
  returnTime?: unknown;
  at?: unknown;
};

export function gafferHandoverDisclosureReady(booking: unknown): boolean {
  if (!booking || typeof booking !== "object") return false;
  const record = booking as RentalRecord;
  const checks = record.verificationChecks as Record<string, unknown> | null | undefined;
  return !!record.handoverDetails &&
    ["confirmed", "active"].includes(safeText(record.status, 48).toLowerCase()) &&
    Number.isSafeInteger(record.paidConfirmedAt) && Number(record.paidConfirmedAt) > 0 &&
    record.idVerifyStatus === "verified" &&
    record.verificationProvider === "didit" &&
    ["didit", "reused_didit"].includes(String(record.idVerificationSource ?? "")) &&
    !!checks && ["identity", "selfie", "address"].every(key => checks[key] === "approved");
}

const bookingIntentPattern = /\b(?:my|our)\s+(?:current\s+)?(?:booking|rental|reservation|order|invoice|verification|deposit|payment|refund|pickup|return)\b|\b(?:my|our)\b.{0,80}\b(?:booking|rental|reservation|order)\b|\b(?:my|our|this)\s+(?:delivery|collection|pickup)\b|\b(?:delivery|collection|pickup)\b.{0,50}\b(?:my|our)\s+(?:booking|rental)\b|\b(?:what|which)\s+(?:delivery|collection|pickup)\b.{0,40}\b(?:did|have)\s+i\b|\b(?:did|have)\s+i\b.{0,40}\b(?:delivery|collection|pickup)\b|\b(?:am i|can i|could i|would i|will i|do i)\b.{0,90}\b(?:eligible|qualif\w*|entitled)\b.{0,60}\b(?:refund\w*|account credit|credit|cancel\w*)\b|\b(?:can i|could i|would i|will i)\b.{0,50}\b(?:get|receive|have)\b.{0,35}\b(?:a refund|my money back|account credit)\b|\b(?:booking|rental|reservation)\s+(?:status|reference|confirmation|details|date|dates|extension|pickup|return)\b|\b(?:extend|change|cancel|check)\s+(?:my|our)\s+(?:booking|rental|reservation)\b|\b(?:when|when's|when is|what time|what date|by when)\b.{0,70}\b(?:return|bring back|drop off|pick up|pickup|collect)\b|\b(?:where|how)\b.{0,50}\b(?:collect|pick up|pickup|drop off|return)\b|\b(?:what|which)\b.{0,40}\b(?:did i|have i)\b.{0,30}\b(?:rent|book|hire)\b|\b(?:extend|keep|hold)\b.{0,40}\b(?:this|it|them|the kit|the items|the rental|longer|until|through)\b|\b(?:my|the)\s+(?:kit|items?|camera|lens|gear)\b.{0,60}\b(?:due back|return|pickup|pick up|collect|rented|booked)\b|\b(?:pickup|pick up|collect|return|drop off)\b.{0,50}\b(?:my|the)\s+(?:booking|rental|kit|items?|camera|gear)\b|\b(?:what (?:was|is) (?:the|my|our)\s+(?:rental\s+)?(?:total|price|cost)|(?:price|cost|total) of (?:my|our|this|that)\s+(?:booking|rental|reservation)|how much (?:did|do|have) i (?:pay|spend) for (?:my|our|this|that)\s+(?:booking|rental|reservation))\b/i;
const contextualBookingFollowUpPattern = /^(?:(?:and|also|so|then|but|okay|ok)\s+)*(?:what|when|where|which|how|is|was|are|were|do|does|did|can|could|will|would|have|has)\b(?=[\s\S]{0,160}\b(?:that|it|they|them|this|those|one|again|same)\b)/i;
const bookingDetailFollowUpPattern = /^(?:(?:and|also|so|then|but|okay|ok)\s+)*(?:what|when|where|which|how|is|was|are|were|do|does|did|can|could|will|would|have|has)\b(?=[\s\S]{0,160}\b(?:pickup|pick up|collection|return|drop off|delivery|verification|documents?|deposit|payment|refund|cancellation|invoice)\b)/i;
const bookingDetailFragmentPattern = /^(?:(?:and|also|so|then|but|okay|ok)\s+)*(?:(?:the|my|that|its|their)\s+)?(?:pickup|pick up|collection|return|drop off|delivery|verification|documents?|deposit|payment|refund|cancellation|invoice|rental|booking|reservation|dates?|times?|status|confirmation)\b/i;
const bookingItemsFragmentPattern = /^(?:(?:and|also|so|then|but|okay|ok)\s+)*(?:(?:my|the|those|these|its|their)\s+)items?\b/i;
const bookingChangeFollowUpPattern = /^(?:(?:and|also|so|then|but|okay|ok)\s+)*(?:i(?:'d| would) like to|i (?:want|need) to|please)\s+(?:reschedule|change|move)\b.{0,100}\b(?:pickup|pick up|collection|return|drop off|delivery|date|time)\b/i;
const acknowledgementPattern = /^(?:thanks?(?:,? that helps)?|thank you(?:,? that helps)?|great|perfect|got it|makes sense|okay|ok|sure|one more thing|another thing)[.!\s]*$/i;

function isBookingIntentText(content: string): boolean {
  return bookingIntentPattern.test(content) || isKeepRentalExtensionIntent(content);
}

function isBookingContextFollowUp(content: string): boolean {
  return contextualBookingFollowUpPattern.test(content)
    || bookingDetailFollowUpPattern.test(content)
    || bookingDetailFragmentPattern.test(content)
    || bookingItemsFragmentPattern.test(content)
    || bookingChangeFollowUpPattern.test(content);
}

const bookingStatusLabels: Record<string, string> = {
  confirmed: "confirmed",
  active: "active",
  returned: "returned",
  pending_verification: "awaiting verification and not confirmed",
  awaiting_review: "under review and not confirmed",
  pending: "pending and not confirmed",
  reserved: "reserved and not confirmed",
  paid: "payment is marked paid; this alone does not confirm the rental",
  cancelled: "cancelled",
  canceled: "cancelled",
  declined: "declined",
};

function safeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\u0000-\u001f]+/g, " ").trim().slice(0, maxLength);
}

function safeTime(value: unknown): string | null {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function safeDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    try { return new Date(value).toISOString().slice(0, 10); }
    catch { return null; }
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try { return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value ? value : null; }
  catch { return null; }
}

function safeMoney(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : null;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function rentalStatus(value: unknown, verification: string, approvedForCurrentRental: boolean): string {
  const status = safeText(value, 48).toLowerCase();
  if (status === "confirmed" && verification !== "passed and current" && !approvedForCurrentRental) {
    return "not ready for collection because current verification is not confirmed";
  }
  return bookingStatusLabels[status] ?? (status ? `recorded as ${status}` : "not available");
}

function verificationStatus(value: unknown, validUntil: unknown, checkFacts: ReturnType<typeof gafferVerificationCheckFacts>, approvedForCurrentRental: boolean): string {
  const status = safeText(value, 48).toLowerCase();
  if (status === "verified") {
    if (typeof validUntil !== "number" || !Number.isFinite(validUntil)) return "previously passed, but current validity could not be confirmed";
    if (checkFacts?.incomplete) return "aggregate result is marked approved, but required Didit checks are incomplete; not cleared for handover";
    if (validUntil > Date.now()) return "passed and current";
    return approvedForCurrentRental
      ? "passed for this rental; re-verification is required for future rentals"
      : "previously passed but expired; re-verification is required";
  }
  if (status === "required" || status === "not_started") return "required or not started";
  if (status === "pending" || status === "in_progress") return "in progress";
  if (status === "rejected" || status === "declined" || status === "failed") return "did not pass";
  if (status === "manual_review" || status === "awaiting_review" || status === "review") return "awaiting manual review";
  return status || "not available";
}

export function gafferNeedsRenterBookingContext(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  const thread = messages.slice(-12);
  const latestUserIndex = thread.findLastIndex((message) =>
    !!message && typeof message === "object" && (message as { role?: unknown }).role === "user",
  );
  if (latestUserIndex < 0) return false;
  const latestUserMessage = thread[latestUserIndex] as { content?: unknown };
  const latestContent = safeText(latestUserMessage.content, 600);
  if (isBookingIntentText(latestContent)) return true;
  if (!isBookingContextFollowUp(latestContent)) return false;

  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = thread[index];
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") continue;
    const content = safeText((message as { content?: unknown }).content, 600);
    if (!content || acknowledgementPattern.test(content)) continue;
    if (isBookingIntentText(content) || isBookingContextFollowUp(content)) return true;
    return false;
  }
  return false;
}

export function buildGafferMembershipContext(account: unknown): Record<string, unknown> | null {
  if (!account || typeof account !== "object") return null;
  const record = account as Record<string, unknown>;
  if (typeof record.membershipActive !== "boolean") return null;
  const tierKey = safeText(record.membershipTier, 32).toLowerCase();
  const activeTier = record.membershipActive ? tierByKey(tierKey) : undefined;
  const status = safeText(record.membershipStatus, 40).toLowerCase() || null;
  const encoreLevel = Number.isSafeInteger(record.loyaltyLevel) ? Number(record.loyaltyLevel) : 0;
  const encorePercent = Number.isFinite(record.loyaltyPercent) ? Number(record.loyaltyPercent) : 0;
  const encoreCompleted = Number.isSafeInteger(record.loyaltyCompleted) ? Number(record.loyaltyCompleted) : null;
  const encoreAssigned = record.loyaltyAdminAssigned === true;
  const encore = record.loyaltyEligible === true && encoreLevel >= 1 && encoreLevel <= 3 && encorePercent === loyaltyPercent(encoreLevel)
    ? { level: encoreLevel, percent: encorePercent, assigned: encoreAssigned, completed: encoreCompleted }
    : null;
  return {
    active: record.membershipActive,
    status,
    encore,
    tier: activeTier ? {
      key: activeTier.key,
      name: activeTier.name,
      monthlyRentalCredit: activeTier.monthlyCredit,
      deliveryDiscountPercent: activeTier.deliveryPct,
      includesMonthlyLondonDelivery: activeTier.key === "studio",
      weekendDeals: activeTier.weekend,
    } : null,
    paidThrough: safeDate(record.membershipPaidThrough),
    trialEnds: safeDate(record.membershipTrialEnd),
    cancelsAtPeriodEnd: typeof record.membershipCancelAtPeriodEnd === "boolean" ? record.membershipCancelAtPeriodEnd : null,
  };
}

export function buildGafferRenterBookingFacts(bookings: unknown): string[] {
  if (!Array.isArray(bookings)) return [];
  const records = bookings
    .filter((booking): booking is RentalRecord => !!booking && typeof booking === "object")
    .slice()
    .sort((left, right) => Number((right as RentalRecord).at ?? 0) - Number((left as RentalRecord).at ?? 0))
    .slice(0, 5);

  return records.map((booking, index) => {
    const validUntil = verificationValidUntil(booking as { idVerifiedAt?: number | null; verifiedAt?: number | null; verificationExpiresAt?: number | null });
    const checkFacts = gafferVerificationCheckFacts(booking.verificationChecks, booking.idVerificationSource);
    const approvedForCurrentRental = gafferHandoverDisclosureReady(booking) && checkFacts !== null && !checkFacts.incomplete;
    const identityStatus = verificationStatus(booking.idVerifyStatus, validUntil, checkFacts, approvedForCurrentRental);
    const status = rentalStatus(booking.status, identityStatus, approvedForCurrentRental);
    const lines = Array.isArray(booking.lineItems)
      ? booking.lineItems.filter((line): line is RentalLine => !!line && typeof line === "object").slice(0, 8)
      : [];
    const items = lines.map((line) => {
      const title = safeText(line.title, 120);
      if (!title) return null;
      const quantity = Number.isSafeInteger(line.qty) && Number(line.qty) > 0 ? Number(line.qty) : 1;
      const lineTotal = safeMoney(line.lineTotal);
      const start = safeDate(line.start);
      const end = safeDate(line.end);
      const returnTime = safeTime(line.returnTime) ?? safeTime(booking.returnTime);
      const dates = start ? ` (${start}${end && end !== start ? ` to ${end}` : ""}${returnTime ? `; due back ${returnTime}` : ""})` : returnTime ? ` (due back ${returnTime})` : "";
      return `${quantity} × ${title}${lineTotal === null ? "" : ` (listed rental line amount ${formatMoney(lineTotal)})`}${dates}`;
    }).filter((item): item is string => !!item);
    const pickupTime = safeTime(booking.pickupTime);
    const returnTime = safeTime(booking.returnTime);
    const times = pickupTime || returnTime
      ? ` Times: pickup ${pickupTime ?? "not listed"}; return ${returnTime ?? "not listed"}.`
      : "";
    const identity = ` Verification state: ${identityStatus}.${checkFacts ? ` ${checkFacts.summary}` : ""}`;
    const cancellation = booking.cancellation;
    const cancellationVersion = safeText(cancellation?.termsVersion, 48);
    const cancellationTerms = safeText(cancellation?.termsText, 6000);
    const cancellationPolicy = safeText(cancellation?.policy, 32);
    const cancellationBasis = safeText(cancellation?.timingBasis, 240);
    const cancellationFacts = cancellationVersion && cancellationTerms
      ? ` Signed cancellation terms (${cancellationVersion}): ${cancellationTerms} Current cancellation window check: ${cancellation?.decisionPending ? "a cancellation decision is already pending" : cancellationPolicy || "not assessed"}${cancellationBasis ? ` — ${cancellationBasis}` : ""}.`
      : " The accepted cancellation terms could not be verified for this rental; do not estimate its refund or credit eligibility.";
    const fulfilment = safeText(booking.fulfilment, 24).toLowerCase();
    const deliveryLegs = safeText(booking.deliveryLegs, 24).toLowerCase();
    const deliveryFee = typeof booking.deliveryFee === "number" && Number.isFinite(booking.deliveryFee) && booking.deliveryFee >= 0
      ? `£${booking.deliveryFee.toFixed(2)}`
      : "not recorded";
    const deliveryLeg = deliveryLegs === "one_way"
      ? "one way"
      : deliveryLegs === "round_trip"
        ? "delivery and collection"
        : "leg not recorded";
    const deliveryFacts = fulfilment === "delivery"
      ? ` Fulfilment: delivery (${deliveryLeg}); recorded delivery fee ${deliveryFee}. The fee record does not prove a payment or refund.`
      : fulfilment === "pickup"
        ? " Fulfilment: in-person pickup; no delivery leg is recorded."
        : "";
    const rentalTotal = safeMoney(booking.total);
    const rentalSubtotal = safeMoney(booking.subtotal);
    const discount = safeMoney(booking.discount);
    const appliedCredit = safeMoney(booking.creditApplied);
    const membershipCredit = safeMoney(booking.membershipCreditApplied);
    const pricingParts = [
      rentalSubtotal === null ? null : `listed subtotal ${formatMoney(rentalSubtotal)}`,
      discount === null || discount === 0 ? null : `discounts ${formatMoney(discount)}`,
      fulfilment === "delivery" && deliveryFee !== "not recorded" ? `delivery fee ${deliveryFee}` : null,
      appliedCredit === null || appliedCredit === 0 ? null : `checkout credit applied ${formatMoney(appliedCredit)}${membershipCredit !== null && membershipCredit > 0 && membershipCredit <= appliedCredit ? ` (including ${formatMoney(membershipCredit)} plan credit)` : ""}`,
    ].filter((part): part is string => !!part);
    const priceFacts = rentalTotal === null
      ? " The saved rental checkout amount is not available in this account record; do not estimate the renter's price."
      : ` Recorded rental checkout amount after discounts and applied credit: ${formatMoney(rentalTotal)}${pricingParts.length ? ` (${pricingParts.join("; ")})` : ""}. It includes the recorded delivery fee when delivery was used, excludes separate security and any separate membership charge, and does not subtract later refunds. It is not a payment-settlement record.`;
    const handoverDetails = approvedForCurrentRental ? booking.handoverDetails : null;
    const handover = handoverDetails
      ? ` Approved handover details: pickup ${safeText(handoverDetails.pickupAddress, 240) || "not listed"}; return ${safeText(handoverDetails.returnAddress, 240) || "not listed"}; contact Leo ${safeText(handoverDetails.phone, 32) || "not listed"}.${safeText(handoverDetails.pickupInstructions, 240) ? ` ${safeText(handoverDetails.pickupInstructions, 240)}` : ""}`
      : " Exact handover address and Leo's phone remain hidden unless this booking's payment, Didit approval and confirmed status passed the shared handover gate.";
    const lateVerification = booking.verificationLateApprovalBlocked === true
      ? " Verification passed only after this rental's cutoff; this rental was not confirmed."
      : "";
    return `Signed-in renter's rental record ${index + 1}: status ${status}.${items.length ? ` Items: ${items.join("; ")}.` : " Items are not listed in this record."}${times}${deliveryFacts}${priceFacts}${identity}${lateVerification}${cancellationFacts}${handover} Do not infer payment settlement, later refunds, or deposit outcomes from this record.`;
  });
}

export function focusGafferRenterBookings(bookings: unknown, bookingId: unknown): unknown[] {
  if (!Array.isArray(bookings)) return [];
  if (typeof bookingId !== "string" || !bookingId.trim()) return bookings;
  return bookings.filter((booking) =>
    !!booking && typeof booking === "object" && String((booking as { _id?: unknown })._id ?? "") === bookingId,
  ).slice(0, 1);
}

const nonDistinctiveRentalTitleWords = new Set([
  "a", "an", "and", "for", "from", "in", "my", "of", "on", "or", "the", "to", "with",
  "camera", "cameras", "lens", "lenses", "kit", "rental", "rentals", "set", "sets", "item", "items",
  "hire", "package", "bundle", "body", "full", "frame", "mark", "series", "version",
]);

function distinctiveRentalTitleWords(value: unknown): string[] {
  return [...new Set(safeText(value, 240).toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((word) => word.length > 1 && !nonDistinctiveRentalTitleWords.has(word));
}

function rentalDates(booking: RentalRecord): string[] {
  const lines = Array.isArray(booking.lineItems)
    ? booking.lineItems.filter((line): line is RentalLine => !!line && typeof line === "object")
    : [];
  return lines.flatMap((line) => [safeDate(line.start), safeDate(line.end)]).filter((date): date is string => !!date);
}

function questionMatchesRentalDate(question: string, date: string): boolean {
  if (question.includes(date)) return true;
  const [, , monthText, dayText] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) ?? [];
  if (!monthText || !dayText) return false;
  const month = Number(monthText);
  const day = Number(dayText);
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2020, month - 1, 1))).toLowerCase();
  const shortMonthName = monthName.slice(0, 3);
  const dayPattern = new RegExp(`\\b0?${day}(?:st|nd|rd|th)?\\b`);
  const monthPattern = new RegExp(`\\b(?:${monthName}|${shortMonthName})\\b`);
  return dayPattern.test(question) && monthPattern.test(question);
}

function matchingRentalReferences(records: RentalRecord[], question: string): RentalRecord[] {
  const normalizedQuestion = safeText(question, 1000).toLowerCase();
  const questionWords = new Set(distinctiveRentalTitleWords(normalizedQuestion));
  const titleCandidates = records.filter((booking) => {
    const lines = Array.isArray(booking.lineItems)
      ? booking.lineItems.filter((line): line is RentalLine => !!line && typeof line === "object")
      : [];
    return lines.some((line) => {
      const titleWords = distinctiveRentalTitleWords(line.title);
      const matches = titleWords.filter((word) => questionWords.has(word)).length;
      return titleWords.length >= 2 && matches >= 2;
    });
  });
  const dateCandidates = records.filter((booking) => rentalDates(booking).some((date) => questionMatchesRentalDate(normalizedQuestion, date)));
  return [...new Set([...titleCandidates, ...dateCandidates])];
}

export function selectGafferCancellationBooking(bookings: unknown, question: unknown): RentalRecord | null {
  if (!Array.isArray(bookings)) return null;
  const records = bookings.filter((booking): booking is RentalRecord => !!booking && typeof booking === "object").slice(0, 50);
  if (records.length === 1) return records[0];
  if (records.length < 2 || typeof question !== "string") return null;
  const candidateRecords = matchingRentalReferences(records, question);
  return candidateRecords.length === 1 ? candidateRecords[0] : null;
}

export function selectGafferRenterBooking(bookings: unknown, messages: unknown): RentalRecord | null {
  if (!Array.isArray(bookings) || !Array.isArray(messages)) return null;
  const thread = messages.slice(-12);
  const latestUserIndex = thread.findLastIndex((message) =>
    !!message && typeof message === "object" && (message as { role?: unknown }).role === "user",
  );
  if (latestUserIndex < 0) return null;
  const latestContent = safeText((thread[latestUserIndex] as { content?: unknown }).content, 600);
  if (!gafferNeedsRenterBookingContext(thread)) return null;
  const directMatch = selectGafferCancellationBooking(bookings, latestContent);
  if (directMatch) return directMatch;
  const records = bookings.filter((booking): booking is RentalRecord => !!booking && typeof booking === "object").slice(0, 50);
  if (matchingRentalReferences(records, latestContent).length > 0) return null;

  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = thread[index];
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") continue;
    const content = safeText((message as { content?: unknown }).content, 600);
    if (!content || acknowledgementPattern.test(content)) continue;
    const match = selectGafferCancellationBooking(bookings, content);
    if (match) return match;
    if (isBookingIntentText(content)) return null;
    if (isBookingContextFollowUp(content)) continue;
    return null;
  }
  return null;
}
