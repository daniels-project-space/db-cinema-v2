import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken, assertAdmin } from "./adminAuth";
import { bookingStockLines } from "../shared/rentalWindow";
import { assertRentalInventory } from "./lib/rentalInventory";
import { assertRentalAllocation } from "./lib/rentalAllocation";
import { assertRenterExposure, replacementValues } from "./lib/rentalExposure";
import { listingImages } from "./lib/catalogImages";
import { stockWindow } from "./lib/stockWindows";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import {
  replacementCompatible,
  assertReplacementSnapshot,
} from "./lib/quickReplyReplacement";

async function context(ctx: any, bookingId: any, lineIndex: number) {
  const b = await ctx.db.get(bookingId);
  if (
    !b ||
    !Number.isSafeInteger(lineIndex) ||
    lineIndex < 0 ||
    !b.lineItems[lineIndex]
  )
    throw Error("Refresh this rental and choose the item again.");
  const original = await ctx.db.get(b.lineItems[lineIndex].listingId);
  if (!original) throw Error("Original item unavailable.");
  return { b, original, line: b.lineItems[lineIndex] };
}
/** Bounded, category-indexed candidates; every result checks the entire proposed basket. */
export const options = query({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    lineIndex: v.number(),
  },
  handler: async (ctx, a) => {
    if (!checkAdminToken(a.token)) throw Error("Unauthorized");
    const { b, original, line } = await context(ctx, a.bookingId, a.lineIndex);
    // The affordance is only for a verified stock problem, never unknown capacity.
    try {
      await assertRentalInventory(ctx, bookingStockLines(b), b._id);
      return { options: [], reason: "The requested kit is available." };
    } catch {}
    const candidates = await ctx.db
      .query("listings")
      .withIndex("by_category", (q) => q.eq("category", original.category))
      .take(64);
    const cache = { records: new Map(), reservations: new Map() };
    const options = [];
    for (const candidate of candidates) {
      if (
        !replacementCompatible(original, candidate) ||
        b.lineItems.some((l: any) => l.listingId === candidate._id)
      )
        continue;
      const lines = bookingStockLines(b).map((l, i) =>
        i === a.lineIndex
          ? { ...l, listingId: candidate._id, title: candidate.title }
          : l,
      );
      try {
        await assertRentalInventory(ctx, lines, b._id, cache);
      } catch {
        continue;
      }
      options.push({
        id: candidate._id,
        name: candidate.title,
        image_url: listingImages(candidate)[0] ?? null,
        available: true,
        original: {
          lineIndex: a.lineIndex,
          listingId: line.listingId,
          qty: line.qty,
          start: line.start,
          end: line.end,
        },
        can_apply:
          b.status === "confirmed" &&
          !b.cancellationDecision &&
          !b.activeAdditionId &&
          !b.activeExtensionId &&
          !b.returnDecision,
        price_note:
          "Agreed rental charges stay unchanged. No refund or extra payment is made.",
      });
      if (options.length === 6) break;
    }
    return {
      options,
      reason: options.length
        ? null
        : "No suitable replacement with verified stock was found.",
    };
  },
});
/** One transaction: verify stock and version, replace the line and reservations, or do nothing. */
export const accept = mutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    requestId: v.string(),
    lineIndex: v.number(),
    oldListingId: v.id("listings"),
    newListingId: v.id("listings"),
    qty: v.number(),
    start: v.number(),
    end: v.number(),
  },
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "rentalReplacements.accept");
    const b = await ctx.db.get(a.bookingId);
    if (!b) throw Error("Rental unavailable.");
    const prior = b.kitReplacements?.find((r) => r.requestId === a.requestId);
    if (prior) {
      assertReplacementSnapshot(prior, a);
      return { ok: true, replayed: true };
    }
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(a.requestId))
      throw Error("Invalid replacement request.");
    if (
      b.status !== "confirmed" ||
      b.cancellationDecision ||
      b.activeAdditionId ||
      b.activeExtensionId ||
      b.returnDecision
    )
      throw Error(
        "Finish the open operation first. Only an upcoming confirmed rental can be changed here.",
      );
    const { original, line } = await context(ctx, a.bookingId, a.lineIndex);
    assertReplacementSnapshot(
      {
        lineIndex: a.lineIndex,
        oldListingId: line.listingId,
        newListingId: a.newListingId,
        qty: line.qty,
        start: line.start,
        end: line.end,
      },
      a,
    );
    const replacement = await ctx.db.get(a.newListingId);
    if (
      !replacementCompatible(original, replacement) ||
      b.lineItems.some((l: any) => l.listingId === a.newListingId)
    )
      throw Error("Replacement needs a separate price or equipment review.");
    const refunds = await ctx.db
      .query("rental_refunds")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    if (refunds.some((r) => ["prepared", "pending"].includes(r.status)))
      throw Error("Wait for the open refund to settle.");
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    if (
      reservations.some(
        (r) => r.source !== "site" || ["active", "hold"].includes(r.status),
      )
    )
      throw Error(
        "Resolve collected kit or an open hold through its original flow.",
      );
    await assertRentalAllocation(ctx, b, reservations);
    let originalUnavailable = false;
    try {
      await assertRentalInventory(ctx, bookingStockLines(b), b._id);
    } catch {
      originalUnavailable = true;
    }
    if (!originalUnavailable)
      throw Error(
        "The requested kit is now available. Refresh the replacement choices.",
      );
    const lines = bookingStockLines(b).map((l, i) =>
      i === a.lineIndex
        ? { ...l, listingId: a.newListingId, title: replacement!.title }
        : l,
    );
    await assertRentalInventory(ctx, lines, b._id);
    await assertRenterExposure(ctx, b, lines);
    for (const r of reservations)
      if (r.status === "confirmed")
        await ctx.db.patch(r._id, { status: "cancelled" });
    for (const l of lines) {
      const listing = await ctx.db.get(l.listingId);
      for (const component of listing!.components)
        await ctx.db.insert("reservations", {
          bookingId: b._id,
          listingId: l.listingId,
          inventoryUnitId: component.inventoryUnitId,
          ...stockWindow(l, true),
          qty: component.qty * l.qty,
          source: "site",
          status: "confirmed",
        });
    }
    await ctx.db.patch(b._id, {
      lineItems: lines,
      replacementValues: await replacementValues(ctx, b, lines),
      kitReplacements: [
        ...(b.kitReplacements ?? []),
        {
          requestId: a.requestId,
          lineIndex: a.lineIndex,
          oldListingId: a.oldListingId,
          newListingId: a.newListingId,
          qty: a.qty,
          start: a.start,
          end: a.end,
          appliedAt: Date.now(),
        },
      ],
    });
    await queueRmv2Sync(ctx, b._id);
    // No chat, email, money or verification change. Operator sends the separate reviewed draft.
    return { ok: true, replayed: false };
  },
});
