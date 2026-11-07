type RentalLine = {
  title?: unknown;
  qty?: unknown;
  start?: unknown;
  end?: unknown;
  returnTime?: unknown;
};

type RentalRecord = {
  status?: unknown;
  idVerifyStatus?: unknown;
  lineItems?: unknown;
  pickupTime?: unknown;
  returnTime?: unknown;
  at?: unknown;
};

const bookingIntentPattern = /\b(?:my|our)\s+(?:current\s+)?(?:booking|rental|reservation|order|invoice|verification|deposit|payment|refund|pickup|return)\b|\b(?:booking|rental|reservation)\s+(?:status|reference|confirmation|details|date|dates|extension|pickup|return)\b|\b(?:extend|change|cancel|check)\s+(?:my|our)\s+(?:booking|rental|reservation)\b/i;

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
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function rentalStatus(value: unknown): string {
  const status = safeText(value, 48).toLowerCase();
  return bookingStatusLabels[status] ?? (status ? `recorded as ${status}` : "not available");
}

function verificationStatus(value: unknown): string {
  const status = safeText(value, 48).toLowerCase();
  if (status === "verified") return "passed";
  if (status === "required" || status === "not_started") return "required or not started";
  if (status === "pending" || status === "in_progress") return "in progress";
  if (status === "rejected" || status === "declined") return "did not pass";
  if (status === "review" || status === "awaiting_review") return "awaiting review";
  return status || "not available";
}

export function gafferNeedsRenterBookingContext(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.slice(-8).some((message) => {
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") return false;
    return bookingIntentPattern.test(safeText((message as { content?: unknown }).content, 600));
  });
}

export function buildGafferRenterBookingFacts(bookings: unknown): string[] {
  if (!Array.isArray(bookings)) return [];
  const records = bookings
    .filter((booking): booking is RentalRecord => !!booking && typeof booking === "object")
    .slice()
    .sort((left, right) => Number((right as RentalRecord).at ?? 0) - Number((left as RentalRecord).at ?? 0))
    .slice(0, 5);

  return records.map((booking, index) => {
    const status = rentalStatus(booking.status);
    const lines = Array.isArray(booking.lineItems)
      ? booking.lineItems.filter((line): line is RentalLine => !!line && typeof line === "object").slice(0, 8)
      : [];
    const items = lines.map((line) => {
      const title = safeText(line.title, 120);
      if (!title) return null;
      const quantity = Number.isSafeInteger(line.qty) && Number(line.qty) > 0 ? Number(line.qty) : 1;
      const start = safeDate(line.start);
      const end = safeDate(line.end);
      const dates = start ? ` (${start}${end && end !== start ? ` to ${end}` : ""})` : "";
      return `${quantity} × ${title}${dates}`;
    }).filter((item): item is string => !!item);
    const pickupTime = safeTime(booking.pickupTime);
    const returnTime = safeTime(booking.returnTime);
    const times = pickupTime || returnTime
      ? ` Times: pickup ${pickupTime ?? "not listed"}; return ${returnTime ?? "not listed"}.`
      : "";
    const identity = ` Verification state: ${verificationStatus(booking.idVerifyStatus)}.`;
    return `Signed-in renter's rental record ${index + 1}: status ${status}.${items.length ? ` Items: ${items.join("; ")}.` : " Items are not listed in this record."}${times}${identity} Do not infer payment, refund, or deposit outcomes from this record.`;
  });
}
