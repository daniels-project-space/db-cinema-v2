import { londonStartOfDay } from "../../src/lib/cancellationPolicy";
import { storedBookingAllocation, transactionComponentAllocation } from "./bookingComponentAllocation";
import { peakRentalValue, RENTAL_VALUE_CAP_PENCE, type ValueInterval } from "../../shared/rentalExposure";
const statuses = ["pending_payment", "pending_verification", "confirmed", "active"];
const BOUND = 200;
const DAY = 86400000;
type ExposureWindow = { start: number; end: number };
function normalizedWindows(windows?: ExposureWindow[]) {
  if (!windows) return undefined;
  const sorted = windows.map(window => {
    if (!Number.isSafeInteger(window.start) || !Number.isSafeInteger(window.end) || window.end < window.start)
      throw Error("Rental exposure dates need a team check.");
    return { ...window };
  }).sort((a, b) => a.start - b.start);
  if (!sorted.length) throw Error("Rental exposure dates need a team check.");
  const merged: ExposureWindow[] = [];
  for (const window of sorted) {
    const last = merged.at(-1);
    if (last && window.start <= last.end + DAY) last.end = Math.max(last.end, window.end);
    else merged.push(window);
  }
  return merged;
}
function overlapsWindows(line: any, windows?: ExposureWindow[]) {
  return !windows || !!line && windows.some(window => line.start <= window.end && line.end >= window.start);
}
function clipIntervals(intervals: ValueInterval[], windows?: ExposureWindow[]) {
  if (!windows) return intervals;
  return intervals.flatMap(interval => windows.flatMap(window => {
    const start = Math.max(interval.start, window.start);
    const endExclusive = Math.min(interval.end + DAY, window.end + DAY);
    return endExclusive > start ? [{ ...interval, start, end: endExclusive - DAY }] : [];
  }));
}
/** Bounded indexed reads; unknown/processing payments keep their allocation until closed. */
export async function renterValueBookings(ctx: any, renter: any) {
  const email = (renter.guestEmail ?? renter.customerEmail ?? "").trim().toLowerCase();
  if (!email) throw Error("Rental customer needs a team check.");
  const account = renter.accountId ? await ctx.db.get(renter.accountId) : await ctx.db.query("accounts").withIndex("by_email", (q: any) => q.eq("email", email)).first();
  if (renter.accountId && !account) throw Error("The rental account needs a team check.");
  const personKey = renter.renterPersonKey ?? account?.renterPersonKey;
  const currentEmail = (account?.email ?? email).trim().toLowerCase();
  const groups = await Promise.all(statuses.flatMap(status => [
    ...[...new Set([email, currentEmail])].map(address => ctx.db.query("bookings").withIndex("by_guestEmail_status", (q: any) => q.eq("guestEmail", address).eq("status", status)).take(BOUND + 1).then((rows: any[]) => { if (rows.length > BOUND) throw Error("Your overlapping rentals need a team review before another booking."); return rows.filter(row => row.accountId ? !!account && row.accountId === account._id : row.guestEmail === currentEmail); })),
    ...(account ? [ctx.db.query("bookings").withIndex("by_account_status", (q: any) => q.eq("accountId", account._id).eq("status", status)).take(BOUND + 1)] : []),
    ...(personKey ? [ctx.db.query("bookings").withIndex("by_person_status", (q: any) => q.eq("renterPersonKey", personKey).eq("status", status)).take(BOUND + 1)] : []),
  ]));
  if (groups.some(rows => rows.length > BOUND)) throw Error("Your overlapping rentals need a team review before another booking.");
  return { personKey, rows: [...new Map(groups.flat().map((b: any) => [String(b._id), b])).values()] as any[] };
}
export async function physicalAllocationValuePence(ctx: any, allocation: { replacementValuePence: number; components: {inventoryUnitId:any;qty:number}[] }, quantity: number) {
  let currentPence = 0;
  for (const component of allocation.components) {
    const unit = await ctx.db.get(component.inventoryUnitId);
    if (!unit || !Number.isFinite(unit.replacementCost) || unit.replacementCost <= 0 || !Number.isSafeInteger(component.qty) || component.qty < 1) throw Error("The substituted equipment security value needs a team check.");
    currentPence += Math.round(unit.replacementCost * 100) * component.qty;
    if (!Number.isSafeInteger(currentPence)) throw Error("The substituted equipment security value needs a team check.");
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw Error("Invalid rental quantity");
  const valuePence = Math.max(allocation.replacementValuePence, currentPence) * quantity;
  if (!Number.isSafeInteger(valuePence)) throw Error("The substituted equipment security value needs a team check.");
  return valuePence;
}

export async function valueIntervals(ctx: any, booking: any, lines = booking.lineItems, transactionAllocation?: object, originalIndexes?: number[]): Promise<ValueInterval[]> {
  if (transactionAllocation && (booking._id || originalIndexes && originalIndexes.length !== lines.length)) throw Error("Invalid transaction component allocation.");
  return Promise.all(lines.map(async (line: any, index: number) => {
    const allocation = transactionAllocation ? transactionComponentAllocation(ctx, transactionAllocation, originalIndexes?.[index] ?? index, line) : await storedBookingAllocation(ctx, line, booking._id);
    if (allocation) {
      const valuePence = await physicalAllocationValuePence(ctx, allocation, line.qty);
      return { start: line.start, end: booking.status === "active" ? Math.max(line.end, londonStartOfDay(Date.now())) : line.end, valuePence };
    }
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
export async function replacementValues(ctx: any, booking: any, lines = booking.lineItems, transactionAllocation?: object) {
  const values = await valueIntervals(ctx, booking, lines, transactionAllocation);
  return [...new Map(lines.map((line: any, i: number) => [String(line.listingId), { listingId: line.listingId, unitPence: values[i].valuePence / line.qty }])).values()] as { listingId: any; unitPence: number }[];
}
export async function renterExposure(ctx: any, renter: any, lines = renter.lineItems, requestedWindows?: ExposureWindow[], transactionAllocation?: object) {
  const windows = normalizedWindows(requestedWindows);
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
    const scopedEntries: { line: any; index: number }[] = proposed.map((line: any, index: number) => ({ line, index })).filter(({ line }: any) => overlapsWindows(line, windows));
    const intervals = await valueIntervals(ctx, b, scopedEntries.map(({ line }: any) => line));
    if (b.activeItemSwapId) {
      const swap = await ctx.db.get(b.activeItemSwapId);
      if (!swap) {
        if (scopedEntries.length) throw Error("The pending equipment change needs review.");
      } else if (Array.isArray(swap.changes) && swap.changes.length) {
        const applied = swap.status === "applied";
        for (const change of swap.changes) {
          const proposedIndex = Number.isSafeInteger(change.lineIndex) ? change.lineIndex : -1;
          const isRelevant = !windows || overlapsWindows(change.oldLine, windows) || overlapsWindows(change.newLine, windows)
            || proposedIndex >= 0 && overlapsWindows(proposed[proposedIndex], windows);
          if (!isRelevant) continue;
          if (!change.oldLine || !Number.isSafeInteger(change.lineIndex) || !["replace", "remove"].includes(change.action ?? "replace"))
            throw Error("The pending equipment change needs review.");
          const oldValue = (await valueIntervals(ctx, b, [change.oldLine]))[0];
          if ((change.action ?? "replace") === "remove") {
            // Until Rental Manager acknowledges the stock conversion, keep
            // removed equipment in the exposure total as well.
            if (applied) intervals.push(oldValue);
            continue;
          }
          if (!change.newLine) throw Error("The pending equipment change needs review.");
          const nextValue = (await valueIntervals(ctx, b, [change.newLine]))[0];
          const index = applied
            ? proposed.findIndex((line: any) => String(line.listingId) === String(change.newLine.listingId) && line.start === change.newLine.start && line.end === change.newLine.end && line.qty === change.newLine.qty)
            : change.lineIndex;
          const line = proposed[index];
          if (!line || !applied && String(line.listingId) !== String(change.oldLine.listingId))
            throw Error("The pending equipment change needs review.");
          const scopedIndex = scopedEntries.findIndex(entry => entry.index === index);
          if (scopedIndex >= 0) intervals[scopedIndex] = { ...intervals[scopedIndex], valuePence: Math.max(intervals[scopedIndex].valuePence, oldValue.valuePence, nextValue.valuePence) };
        }
      } else {
        const proposedIndex = Number.isSafeInteger(swap.lineIndex) ? swap.lineIndex : -1;
        const isRelevant = !windows || overlapsWindows(proposed[proposedIndex], windows) || overlapsWindows(swap.newLine, windows);
        if (isRelevant) {
          if (!swap.newLine || proposedIndex < 0 || !proposed[proposedIndex]) throw Error("The pending equipment change needs review.");
          const replacement = await valueIntervals(ctx, b, [swap.newLine]);
          const scopedIndex = scopedEntries.findIndex(entry => entry.index === proposedIndex);
          if (scopedIndex >= 0) intervals[scopedIndex] = { ...intervals[scopedIndex], valuePence: Math.max(intervals[scopedIndex].valuePence, replacement[0].valuePence) };
        }
      }
    }
    return intervals;
  }));
  const ownEntries = lines.map((line: any, index: number) => ({ line, index })).filter(({ line }: any) => overlapsWindows(line, windows));
  const own = await valueIntervals(ctx, renter, ownEntries.map(({ line }: any) => line), transactionAllocation, ownEntries.map(({ index }: any) => index));
  const scopedOther = all.flat().flatMap(interval => clipIntervals([interval], windows));
  const scopedOwn = clipIntervals(own, windows);
  const intervals = [...scopedOther, ...scopedOwn];
  const now = Date.now();
  const currentPence = intervals.filter(i => i.start <= now && i.end + DAY > now).reduce((n, i) => n + i.valuePence, 0);
  return { personKey, currentPence, peakPence: peakRentalValue(intervals, windows ? undefined : now), bookingPeakPence: peakRentalValue(scopedOwn), capPence: RENTAL_VALUE_CAP_PENCE };
}
export async function assertRenterExposure(ctx: any, renter: any, lines = renter.lineItems, windows?: ExposureWindow[], transactionAllocation?: object) {
  const exposure = await renterExposure(ctx, renter, lines, windows, transactionAllocation);
  if (exposure.peakPence > RENTAL_VALUE_CAP_PENCE) throw Error("The £12,000 equipment replacement-value limit per renter would be exceeded across overlapping rentals. Reduce your kit or change the dates before paying.");
  return exposure;
}

/** Attach only provider-attested identity to this account's unresolved rental allocations. */
export async function attachRenterPerson(ctx: any, booking: any, personKey?: string) {
  if (!personKey) return;
  const { rows } = await renterValueBookings(ctx, booking);
  const email = (booking.guestEmail ?? "").trim().toLowerCase();
  const account = booking.accountId ? await ctx.db.get(booking.accountId) : await ctx.db.query("accounts").withIndex("by_email", (q: any) => q.eq("email", email)).first();
  if (booking.accountId && !account) throw Error("The rental account needs a team check.");
  if ((account?.renterPersonKey && account.renterPersonKey !== personKey) || (booking.renterPersonKey && booking.renterPersonKey !== personKey))
    throw Error("Verified identity changed. A team identity review is required before handover.");
  if (account) await ctx.db.patch(account._id, { renterPersonKey: personKey });
  await ctx.db.patch(booking._id, { renterPersonKey: personKey });
  const currentEmail = (account?.email ?? email).trim().toLowerCase();
  for (const row of rows) if (!row.renterPersonKey && (row.accountId ? !!account && row.accountId === account._id : row.guestEmail === currentEmail)) await ctx.db.patch(row._id, { renterPersonKey: personKey });
}
