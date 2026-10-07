import { londonStartOfDay } from "../../src/lib/cancellationPolicy";
import { peakRentalValue, RENTAL_VALUE_CAP_PENCE, type ValueInterval } from "../../shared/rentalExposure";
const statuses = ["pending_payment", "confirmed", "active"];
const BOUND = 200;
/** Bounded indexed reads; unknown/processing payments keep their allocation until closed. */
export async function renterValueBookings(ctx: any, renter: any) {
  const email = (renter.guestEmail ?? renter.customerEmail ?? "").trim().toLowerCase();
  if (!email) throw Error("Rental customer needs a team check.");
  const account = await ctx.db.query("accounts").withIndex("by_email", (q: any) => q.eq("email", email)).first();
  const personKey = renter.renterPersonKey ?? account?.renterPersonKey;
  const groups = await Promise.all(statuses.flatMap(status => [
    ctx.db.query("bookings").withIndex("by_guestEmail_status", (q: any) => q.eq("guestEmail", email).eq("status", status)).take(BOUND + 1),
    ...(personKey ? [ctx.db.query("bookings").withIndex("by_person_status", (q: any) => q.eq("renterPersonKey", personKey).eq("status", status)).take(BOUND + 1)] : []),
  ]));
  if (groups.some(rows => rows.length > BOUND)) throw Error("Your overlapping rentals need a team review before another booking.");
  return { personKey, rows: [...new Map(groups.flat().map((b: any) => [String(b._id), b])).values()] as any[] };
}
export async function valueIntervals(ctx: any, booking: any, lines = booking.lineItems): Promise<ValueInterval[]> {
  return Promise.all(lines.map(async (line: any) => {
    const listing = await ctx.db.get(line.listingId);
    const saved = booking.replacementValues?.find((v: any) => v.listingId === line.listingId)?.unitPence;
    const current = listing?.depositAmount;
    if (saved === undefined && (!Number.isFinite(current) || current < 0)) throw Error("Equipment replacement value needs a team check.");
    const unitPence = Math.max(saved ?? 0, Number.isFinite(current) && current >= 0 ? Math.round(current * 100) : 0);
    if (!Number.isSafeInteger(line.qty) || line.qty < 1) throw Error("Invalid rental quantity");
    // Collected equipment remains exposed until its return is recorded, including overdue kit.
    return { start: line.start, end: booking.status === "active" ? Math.max(line.end, londonStartOfDay(Date.now())) : line.end, valuePence: unitPence * line.qty };
  }));
}
export async function replacementValues(ctx: any, booking: any, lines = booking.lineItems) {
  const values = await valueIntervals(ctx, booking, lines);
  return [...new Map(lines.map((line: any, i: number) => [String(line.listingId), { listingId: line.listingId, unitPence: values[i].valuePence / line.qty }])).values()] as { listingId: any; unitPence: number }[];
}
export async function renterExposure(ctx: any, renter: any, lines = renter.lineItems) {
  const { rows, personKey } = await renterValueBookings(ctx, renter);
  const relevant = rows.filter(b => b._id !== renter._id);
  const all = await Promise.all(relevant.map(async b => {
    let proposed = b.lineItems;
    if (b.activeAdditionId) {
      const addition = await ctx.db.get(b.activeAdditionId);
      if (addition && !["applied", "applied_draft", "refunded", "expired"].includes(addition.status)) proposed = [...proposed, { listingId: addition.listingId, start: addition.start, end: addition.end, qty: addition.qty }];
    }
    if (b.activeExtensionId) {
      const extension = await ctx.db.get(b.activeExtensionId);
      if (extension?.quoteItems && ["approved", "awaiting_payment", "refund_pending"].includes(extension.status)) proposed = proposed.map((line: any, i: number) => { const extra = extension.quoteItems.find((q: any) => q.lineIndex === i); return extra ? { ...line, end: Math.max(line.end, extra.end) } : line; });
    }
    return valueIntervals(ctx, b, proposed);
  }));
  const own = await valueIntervals(ctx, renter, lines);
  const intervals = [...all.flat(), ...own];
  const now = Date.now();
  const currentPence = intervals.filter(i => i.start <= now && i.end + 86400000 > now).reduce((n, i) => n + i.valuePence, 0);
  return { personKey, currentPence, peakPence: peakRentalValue(intervals, now), bookingPeakPence: peakRentalValue(own), capPence: RENTAL_VALUE_CAP_PENCE };
}
export async function assertRenterExposure(ctx: any, renter: any, lines = renter.lineItems) {
  const exposure = await renterExposure(ctx, renter, lines);
  if (exposure.peakPence > RENTAL_VALUE_CAP_PENCE) throw Error("The £15,000 equipment replacement-value limit per renter would be exceeded across overlapping rentals. Reduce your kit or change the dates before paying.");
  return exposure;
}

/** Attach only provider-attested identity to this account's unresolved rental allocations. */
export async function attachRenterPerson(ctx: any, booking: any, personKey?: string) {
  if (!personKey) return;
  const { rows } = await renterValueBookings(ctx, booking);
  const email = (booking.guestEmail ?? "").trim().toLowerCase();
  const account = await ctx.db.query("accounts").withIndex("by_email", (q: any) => q.eq("email", email)).first();
  if ((account?.renterPersonKey && account.renterPersonKey !== personKey) || (booking.renterPersonKey && booking.renterPersonKey !== personKey))
    throw Error("Verified identity changed. A team identity review is required before handover.");
  if (account) await ctx.db.patch(account._id, { renterPersonKey: personKey });
  await ctx.db.patch(booking._id, { renterPersonKey: personKey });
  for (const row of rows) if (row.guestEmail === email && !row.renterPersonKey) await ctx.db.patch(row._id, { renterPersonKey: personKey });
}
