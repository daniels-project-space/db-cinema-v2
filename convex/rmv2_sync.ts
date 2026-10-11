/**
 * Read-only feed of the storefront's OWN bookings for the upstream Rental
 * Manager (RMv2) to ingest as a "DB Cinema Web" profile (2026-06-25).
 *
 * RMv2 already syncs Hygglo availability DOWN into our `reservations`
 * (source="hygglo"); this is the reverse — it lets RMv2 pull our paid website
 * bookings UP so they show as ongoing rentals + availability + revenue there.
 *
 * Token-guarded (same ADMIN_TOKEN as bookings:adminList). Each booking's line
 * items are decomposed to the physical Hygglo product IDs (via
 * listings.components → inventory_units.hyggloProductId) so RMv2 can map them to
 * its own canonical items and unify availability against the shared stock.
 */
import { query, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { checkAdminToken } from "./adminAuth";
import { paginationOptsValidator } from "convex/server";
import { accountForRental } from "./lib/rentalAccount";
import { assertVerificationArchive } from "./verificationArchive";
import { requiresDroneLicence, droneLicenceStatusForRental } from "./lib/droneVerification";
import { securityReady } from "../shared/verificationProgress";
import { VERIFICATION_REUSE_DAYS } from "./lib/verificationReuse";
import { stockWindow } from "./lib/stockWindows";
import { bookingStockLines } from "../shared/rentalWindow";

const PAID_STATUSES = new Set(["confirmed", "active", "returned"]);

/**
 * Map ONE booking doc into the `SiteBooking` shape RMv2 ingests.
 *
 * Extracted from `forRmv2Sync`'s `.map()` body (2026-08-18) so the same
 * projection backs both the bulk feed (cron fallback) and the single-booking
 * webhook push (`forRmv2SyncOne` → rmv2_webhook:push). Keeping ONE mapper is
 * what guarantees the webhook and the poll can never disagree about a booking.
 *
 * Pure: all related docs are passed in via lookup maps, so the caller decides
 * whether to bulk-collect the tables or fetch just this booking's relations.
 */
export function mapBookingForSync(
  b: Doc<"bookings">,
  listingById: Map<string, Doc<"listings">>,
  unitById: Map<string, Doc<"inventory_units">>,
  custById: Map<string, Doc<"customers">>,
  reservations?: Doc<"reservations">[],
  damageCases?: Doc<"rental_damage_cases">[],
  verificationReadiness?: {archiveReady: boolean; requiresDroneLicence: boolean; droneLicenceStatus?: string; accountId: string | null; sessionId: string | null},
) {
  const lineItems = (b.lineItems ?? []).map((li) => {
    const listing = listingById.get(String(li.listingId));
    const unitsOut: Array<{ hyggloProductId: number; qty: number }> = [];
    if (listing) {
      for (const comp of listing.components ?? []) {
        const u = unitById.get(String(comp.inventoryUnitId));
        if (u && typeof u.hyggloProductId === "number") {
          unitsOut.push({
            hyggloProductId: u.hyggloProductId,
            qty: (comp.qty ?? 1) * (li.qty ?? 1),
          });
        }
      }
      // Fallback: a listing that carries its own hyggloProductId but no
      // component breakdown.
      if (
        unitsOut.length === 0 &&
        typeof (listing as { hyggloProductId?: number }).hyggloProductId === "number"
      ) {
        unitsOut.push({
          hyggloProductId: (listing as { hyggloProductId?: number }).hyggloProductId!,
          qty: li.qty ?? 1,
        });
      }
    }
    return {
      title: li.title,
      qty: li.qty ?? 1,
      start: li.start,
      end: li.end,
      pickupTime:li.pickupTime===undefined?b.pickupTime??null:li.pickupTime,
      returnTime: li.returnTime === undefined ? b.returnTime ?? null : li.returnTime,
      units: unitsOut,
    };
  });

  const cust = b.customerId ? custById.get(String(b.customerId)) : undefined;
  const starts = (b.lineItems ?? []).map((li) => li.start);
  const ends = (b.lineItems ?? []).map((li) => li.end);

  const documentsApproved = !!verificationReadiness?.accountId && b.idVerifyStatus === "verified" &&
    Math.min(b.verificationExpiresAt ?? ((b.idVerifiedAt ?? 0) + VERIFICATION_REUSE_DAYS * 86400000), b.documentExpiresAt ?? Infinity) > Date.now() &&
    verificationReadiness.archiveReady === true &&
    (!verificationReadiness.requiresDroneLicence || verificationReadiness.droneLicenceStatus === "approved");

  return {
    id: String(b._id),
    revision: b.rmv2Revision ?? 0,
    status: b.status,
    verification: {
      version: 1,
      provider: b.verificationProvider ?? "stripe",
      status: b.idVerifyStatus ?? "required",
      checks: b.verificationChecks ?? {identity:"waiting",selfie:"waiting",address:"waiting"},
      accountId: verificationReadiness?.accountId ?? null,
      sessionId: verificationReadiness?.sessionId ?? null,
      updatedAt: b.verificationUpdatedAt ?? null,
      securityReady: securityReady(b) && (!(b.depositHoldAmount ?? 0) || (b.depositHoldExpiresAt ?? 0) > Date.now()),
      archiveReady: verificationReadiness?.archiveReady ?? false,
      requiresDroneLicence: verificationReadiness?.requiresDroneLicence ?? true,
      droneLicenceStatus: verificationReadiness?.droneLicenceStatus ?? b.droneLicenceStatus ?? "required",
      documentsApproved,
      approved: documentsApproved && securityReady(b) &&
        (!(b.depositHoldAmount ?? 0) || (b.depositHoldExpiresAt ?? 0) > Date.now()),
    },
    customerName: cust?.name ?? b.guestName ?? null,
    customerEmail: cust?.email ?? b.guestEmail ?? null,
    fulfilment: b.fulfilment,
    pickupTime: b.pickupTime ?? null,
    returnTime: b.returnTime ?? null,
    start: starts.length ? Math.min(...starts) : b._creationTime,
    end: ends.length ? Math.max(...ends) : b._creationTime,
    subtotal: b.subtotal ?? 0,
    discount: b.discount ?? 0,
    deliveryFee: b.deliveryFee ?? 0,
    depositAmount: b.depositAmount ?? 0,
    total: b.total ?? 0,
    currency: b.currency ?? "GBP",
    createdAt: b._creationTime,
    lineItems,
    ...(damageCases ? { damageCases: damageCases.map(c => ({
      id: String(c._id), itemKey: c.itemKey, title: c.title, details: c.details,
      status: c.status, openedAt: c.openedAt, closedAt: c.closedAt ?? null,
      resolution: c.resolution ?? null, customerAccountId: c.accountId ? String(c.accountId) : null,
      rmv2ItemId: c.inventoryUnitId ? unitById.get(String(c.inventoryUnitId))?.rmv2ItemId ?? null : null,
    })) } : {}),
    // This ledger was allocated at confirmation/change time. Catalogue edits
    // must not re-decompose a booked kit or extend all components to one period.
    ...(reservations?.length ? { physicalReservations: reservations
      .filter(r => r.source === "site" && ["confirmed", "active", "returned"].includes(r.status))
      .map(r => {
        const unit = unitById.get(String(r.inventoryUnitId));
        const exportedEnd = r.end + (r.endExclusive && r.turnaroundBufferMinutes !== 60 ? 3600000 : 0);
        const matchingLines = bookingStockLines(b).filter(li => {
          if (!r.listingId || String(li.listingId) !== String(r.listingId)) return false;
          if (!r.endExclusive) return li.start === r.start && li.end === r.end;
          // Legacy unmarked exact rows lacked the turnaround buffer. Normalize
          // once, then compare the allocation against signed civil clocks. An
          // extension tail may begin after collection but must end exactly at
          // this line's allocation end; there is no approximate date matching.
          return [true, false].some(precise => {
            try { const w = stockWindow(li, precise); return w.end === exportedEnd && w.start <= r.start && r.start < w.end; }
            catch { return false; }
          });
        });
        const evidence = new Map(matchingLines.map(li => [JSON.stringify([li.start, li.end, li.pickupTime ?? null, li.returnTime ?? null]), li]));
        const signedLine = evidence.size === 1 ? [...evidence.values()][0] : undefined;
        const clock = (value:unknown):string|null => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
        const pickupClocks = matchingLines.map(li => clock(li.pickupTime));
        const commonPickup = pickupClocks.length && pickupClocks.every(Boolean) && pickupClocks.every(value => value === pickupClocks[0])
          ? pickupClocks[0] : null;
        const returnClocks = matchingLines.map(li => clock(li.returnTime));
        // When old rows lost their line reference, a common pickup plus several
        // confirmed returns can safely reserve through the latest deadline.
        // Conflicting or unconfirmed pickups/returns stay unknown and therefore
        // block the full day in Rental Manager instead of guessing.
        const conservativeReturn = commonPickup && returnClocks.length && returnClocks.every(Boolean)
          ? [...returnClocks].sort().at(-1) ?? null : null;
        const fallbackPickup = signedLine ? clock(signedLine.pickupTime) : commonPickup;
        const fallbackReturn = signedLine ? clock(signedLine.returnTime) : conservativeReturn;
        // Persisted reservation clocks identify the exact physical allocation;
        // use them before the legacy booking-line reconstruction.
        const pickupTime = r.pickupTime !== undefined ? clock(r.pickupTime) : fallbackPickup;
        const returnTime = r.returnTime !== undefined ? clock(r.returnTime) : fallbackReturn;
        return { reservationId: String(r._id), inventoryUnitId: String(r.inventoryUnitId),
          rmv2ItemId: unit?.rmv2ItemId ?? null, name: unit?.name ?? "Unmapped equipment",
          sku: unit?.sku ?? null, qty: r.qty, start: r.start, end: r.end,
          ...(r.endExclusive?{end:exportedEnd,endExclusive:true,stockWindowVersion:2,turnaroundBufferMinutes:60}:{}),
          pickupTime, returnTime,
          ...(signedLine ? { pickupDate: new Date(signedLine.start).toISOString().slice(0, 10), returnDate: new Date(signedLine.end).toISOString().slice(0, 10) } : {}),
          listingId: r.listingId ? String(r.listingId) : null,
          status: r.status, hyggloProductId: unit?.hyggloProductId ?? null };
      }) } : {}),
  };
}

export const forRmv2Sync = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) {
      return { authorized: false as const, bookings: [] };
    }

    const rows = await ctx.db.query("bookings").order("desc").take(1000);
    const paid = rows.filter((b) => PAID_STATUSES.has(b.status));

    const listings = await ctx.db.query("listings").collect();
    const listingById = new Map(listings.map((l) => [String(l._id), l]));
    const units = await ctx.db.query("inventory_units").collect();
    const unitById = new Map(units.map((u) => [String(u._id), u]));
    const customers = await ctx.db.query("customers").collect();
    const custById = new Map(customers.map((c) => [String(c._id), c]));

    const bookings = await Promise.all(paid.map(async b => mapBookingForSync(b, listingById, unitById, custById, undefined, undefined, await verificationReadiness(ctx,b))));

    return { authorized: true as const, bookings };
  },
});

/**
 * Single-booking projection for the event-driven push to RMv2 (2026-08-18).
 *
 * Deliberately NOT filtered by PAID_STATUSES: this is event-driven, so RMv2
 * must also hear about `cancelled` (to retire the reservation) and any other
 * transition. RMv2's own status map decides what is actionable — a booking
 * that never became payable (`pending_payment`) is skipped on that side.
 *
 * Fetches only THIS booking's relations rather than collecting whole tables,
 * so a push costs a handful of reads instead of a full-catalogue scan.
 */
export const forRmv2SyncOne = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return loadBookingProjection(ctx, b);
  },
});

async function loadBookingProjection(ctx: any, b: Doc<"bookings">) {
    const listingById = new Map<string, Doc<"listings">>();
    const unitById = new Map<string, Doc<"inventory_units">>();
    for (const li of b.lineItems ?? []) {
      const lKey = String(li.listingId);
      if (listingById.has(lKey)) continue;
      const listing = await ctx.db.get(li.listingId);
      if (!listing) continue;
      listingById.set(lKey, listing);
      for (const comp of listing.components ?? []) {
        const uKey = String(comp.inventoryUnitId);
        if (unitById.has(uKey)) continue;
        const unit = await ctx.db.get(comp.inventoryUnitId);
        if (unit) unitById.set(uKey, unit);
      }
    }

    const reservations: Doc<"reservations">[] = await ctx.db.query("reservations").withIndex("by_booking", (q: any) => q.eq("bookingId", b._id)).collect();
    for (const reservation of reservations) {
      const key = String(reservation.inventoryUnitId);
      if (!unitById.has(key)) {
        const unit = await ctx.db.get(reservation.inventoryUnitId);
        if (unit) unitById.set(key, unit);
      }
    }
    const custById = new Map<string, Doc<"customers">>();
    if (b.customerId) {
      const cust = await ctx.db.get(b.customerId);
      if (cust) custById.set(String(b.customerId), cust);
    }

    const damageCases = await ctx.db.query("rental_damage_cases").withIndex("by_booking", (q: any) => q.eq("bookingId", b._id)).collect();
    for (const record of damageCases) if (record.inventoryUnitId && !unitById.has(String(record.inventoryUnitId))) {
      const unit = await ctx.db.get(record.inventoryUnitId);
      if (unit) unitById.set(String(unit._id), unit);
    }
    return mapBookingForSync(b, listingById, unitById, custById, reservations, damageCases, await verificationReadiness(ctx,b));
}

async function verificationReadiness(ctx: any, b: Doc<"bookings">) {
  let archiveReady = false;
  if (b.idVerifyStatus === "verified") { try { await assertVerificationArchive(ctx,b); archiveReady = true; } catch {} }
  const account = await accountForRental(ctx,b);
  const source = b.verificationReusedFrom ? await ctx.db.get(b.verificationReusedFrom) : b;
  return {archiveReady, droneLicenceStatus: await droneLicenceStatusForRental(ctx,b), requiresDroneLicence: await requiresDroneLicence(ctx,b), accountId: account ? String(account._id) : null, sessionId: source?.diditSessionId ?? null};
}

/** Explicit lifecycle records in bounded pages; absence never means cancellation. */
export const forRmv2SyncPage = query({
  args: { token: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    if (!checkAdminToken(args.token)) throw Error("unauthorized");
    if (args.paginationOpts.numItems > 100) throw Error("Sync pages are limited to 100 rentals");
    const page = await ctx.db.query("bookings").order("desc").paginate(args.paginationOpts);
    const bookings = [];
    for (const booking of page.page) if (booking.status !== "pending_payment") bookings.push(await loadBookingProjection(ctx, booking));
    return { authorized: true, bookings, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const forRmv2SyncBooking = query({args:{token:v.string(),bookingId:v.id("bookings")},handler:async(ctx,args)=>{
  if(!checkAdminToken(args.token))throw Error("unauthorized");
  const booking=await ctx.db.get(args.bookingId);if(!booking)throw Error("Rental not found");
  return loadBookingProjection(ctx,booking);
} });
