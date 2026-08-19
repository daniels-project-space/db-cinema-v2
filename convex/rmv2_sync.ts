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
      units: unitsOut,
    };
  });

  const cust = b.customerId ? custById.get(String(b.customerId)) : undefined;
  const starts = (b.lineItems ?? []).map((li) => li.start);
  const ends = (b.lineItems ?? []).map((li) => li.end);

  return {
    id: String(b._id),
    status: b.status,
    customerName: cust?.name ?? null,
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

    const bookings = paid.map((b) =>
      mapBookingForSync(b, listingById, unitById, custById),
    );

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

    const custById = new Map<string, Doc<"customers">>();
    if (b.customerId) {
      const cust = await ctx.db.get(b.customerId);
      if (cust) custById.set(String(b.customerId), cust);
    }

    return mapBookingForSync(b, listingById, unitById, custById);
  },
});
