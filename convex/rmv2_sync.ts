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
import { query } from "./_generated/server";
import { v } from "convex/values";

const PAID_STATUSES = new Set(["confirmed", "active", "returned"]);

export const forRmv2Sync = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
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

    const bookings = paid.map((b) => {
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
    });

    return { authorized: true as const, bookings };
  },
});
