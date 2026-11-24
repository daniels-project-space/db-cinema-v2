import {ASSESSMENT_SECURITY_POLICY_VERSION,depositForBookingPolicy} from "../shared/rentalSecurity";
import { replacementSets } from "./lib/replacementSets";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken, assertAdmin } from "./adminAuth";
import { bookingStockLines } from "../shared/rentalWindow";
import { rentalPricingDays } from "../shared/rentalDuration";
import { quote } from "./lib/pricing";
import { assertRentalInventory } from "./lib/rentalInventory";
import { assertRenterExposure, replacementValues } from "./lib/rentalExposure";
import { listingImages } from "./lib/catalogImages";
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
function preservesAgreedCharge(line:any,candidate:any):boolean{
 if(!line||!candidate?.pricing||!Number.isSafeInteger(line.qty)||line.qty<1||!Number.isFinite(line.lineTotal)||line.lineTotal<0)return false;
 try{
  const days=rentalPricingDays(line.start,line.end,line.pickupTime,line.returnTime);
  const replacementTotal=quote(candidate.pricing,days).total*line.qty;
  const originalPence=Math.round(line.lineTotal*100),replacementPence=Math.round(replacementTotal*100);
  return Math.abs(line.lineTotal*100-originalPence)<0.000001&&Number.isSafeInteger(replacementPence)&&originalPence===replacementPence;
 }catch{return false;}
}
async function assertReplacementDeposit(ctx:any,b:any,lines:any[]){
 if(b.securityPolicyVersion!==ASSESSMENT_SECURITY_POLICY_VERSION)return;
 const values=await replacementValues(ctx,b,lines);
 const value=lines.reduce((sum:number,line:any)=>sum+values.find(v=>v.listingId===line.listingId)!.unitPence*line.qty/100,0);
 if(depositForBookingPolicy(b,value)>b.depositAmount)throw Error("This equipment upgrade needs a reviewed deposit update before it can be applied.");
}
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
        !replacementCompatible(original, candidate,b) ||
        !preservesAgreedCharge(line,candidate) ||
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
          !b.activeDeliveryQuoteId &&
          !b.activeExtensionId &&
          !b.activePriceAdjustmentId &&
          !b.activeItemSwapId &&
          !b.returnDecision,
        price_note:
          "Same agreed charge. No refund or extra payment.",
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
/** Legacy compatibility endpoint. New equipment changes must use the renter-approved priced flow. */
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
    throw Error("This legacy replacement is closed. Use the renter-approved equipment-change proposal.");
  },
});

/** The same category/type/mount and complete-basket stock rules as website replacements. */
async function basketContext(ctx: any, bookingId: any) {
  const b = await ctx.db.get(bookingId);
  if (!b?.lineItems?.length || b.lineItems.length > 100)
    throw Error("Rental basket unavailable.");
  const lines: any[] = bookingStockLines(b);
  const listings = await Promise.all(
    lines.map((line: any) => ctx.db.get(line.listingId)),
  );
  const cache = { records: new Map(), reservations: new Map() };
  const unavailable: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const source = listings[index];
    if (!source) throw Error("Original equipment identity is missing.");
    const units = new Set(
      source.components?.map((component: any) =>
        String(component.inventoryUnitId),
      ) ?? [],
    );
    const relevant = lines.filter(
      (_: any, i: number) =>
        i === index ||
        listings[i]?.components?.some((component: any) =>
          units.has(String(component.inventoryUnitId)),
        ),
    );
    try {
      await assertRentalInventory(ctx, relevant, b._id, cache);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        !/already reserved|unavailable on those dates|no longer available/.test(
          message,
        )
      )
        throw error;
      unavailable.push(index);
    }
  }
  return { b, lines, listings, cache, unavailable };
}
async function completeBasketOptions(ctx: any, bookingId: any): Promise<any> {
  const { b, lines, listings, cache, unavailable } = await basketContext(
    ctx,
    bookingId,
  );
  if (!unavailable.length)
    return {
      options: [],
      originals: [],
      reason: "The requested kit is available.",
    };
  const originals = unavailable.map((index) => ({
    lineIndex: index,
    listingId: lines[index].listingId,
    name: listings[index].title,
    image_url: listingImages(listings[index])[0] ?? null,
    image_urls: listingImages(listings[index]),
    qty: lines[index].qty,
    start: lines[index].start,
    end: lines[index].end,
  }));
  if (unavailable.length > 8)
    return {
      options: [],
      originals,
      reason: "This basket needs a manual equipment review.",
    };
  const groups: any[][] = [];
  for (const index of unavailable) {
    const source = listings[index];
    const candidates = await ctx.db
      .query("listings")
      .withIndex("by_category", (q: any) => q.eq("category", source.category))
      .take(64);
    const viable = [];
    for (const candidate of candidates
      .filter(
        (candidate: any) =>
          replacementCompatible(source, candidate,b) &&
          preservesAgreedCharge(lines[index],candidate) &&
          !lines.some((line: any) => line.listingId === candidate._id),
      )
      .sort(
        (a: any, b: any) =>
          Math.abs(a.pricing.daily - source.pricing.daily) -
            Math.abs(b.pricing.daily - source.pricing.daily) ||
          String(a._id).localeCompare(String(b._id)),
      )) {
      try {
        await assertRentalInventory(
          ctx,
          [
            {
              ...lines[index],
              listingId: candidate._id,
              title: candidate.title,
            },
          ],
          b._id,
          cache,
        );
        viable.push(candidate);
      } catch {}
      if (viable.length === 6) break;
    }
    groups.push(viable);
  }
  const { sets, limited } = await replacementSets(
    groups,
    (item: any) => String(item._id),
    async (set: any[]) => {
      const proposed = lines.map((line: any, index: number) => {
        const position = unavailable.indexOf(index);
        return position < 0
          ? line
          : {
              ...line,
              listingId: set[position]._id,
              title: set[position].title,
            };
      });
      try {
        await assertRentalInventory(ctx, proposed, b._id, cache);
        await assertReplacementDeposit(ctx,b,proposed);
        await assertRenterExposure(ctx, b, proposed);
        return true;
      } catch {
        return false;
      }
    },
  );
  const original = {
    lines: originals.map(({ lineIndex, listingId, qty, start, end }) => ({
      lineIndex,
      listingId,
      qty,
      start,
      end,
    })),
    items: lines.map((line: any) => ({
      name: line.title,
      product_id: String(line.listingId),
      qty: line.qty,
    })),
    start: b.start,
    end: b.end,
  };
  return {
    originals,
    options: sets.map((set: any[], index: number) => ({
      id: set.map((item: any) => String(item._id)).join("|"),
      name: `Replacement set ${index + 1}`,
      image_url: null,
      available: true,
      original,
      items: set.map((item: any, i: number) => ({
        id: String(item._id),
        name: item.title,
        image_url: listingImages(item)[0] ?? null,
        image_urls: listingImages(item),
        qty: originals[i].qty,
        replaces: originals[i].name,
        lineIndex: originals[i].lineIndex,
      })),
      can_apply:
        b.status === "confirmed" &&
        !b.cancellationDecision &&
        !b.activeAdditionId &&
        !b.activeDeliveryQuoteId &&
        !b.activeExtensionId &&
        !b.activePriceAdjustmentId &&
        !b.activeItemSwapId &&
        !b.returnDecision,
      price_note:
        "All replacements were checked together with the retained kit. Agreed rental charges stay unchanged; no refund or extra payment is made.",
    })),
    reason: sets.length
      ? null
      : limited
        ? "No complete set found within the bounded search. Review equipment manually."
        : "No compatible complete set with verified stock was found.",
  };
}
export const basketOptions = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, a): Promise<any> => {
    if (!checkAdminToken(a.token)) throw Error("Unauthorized");
    return completeBasketOptions(ctx, a.bookingId);
  },
});
export const acceptBasket = mutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    requestId: v.string(),
    replacementId: v.string(),
    original: v.any(),
  },
  handler: async (ctx, a): Promise<any> => {
    await assertAdmin(ctx, a.token, "rentalReplacements.acceptBasket");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(a.requestId))
      throw Error("Invalid replacement request.");
    const b = await ctx.db.get(a.bookingId);
    if (!b) throw Error("Rental unavailable.");
    const prior =
      b.kitReplacements?.filter((item: any) =>
        item.requestId.startsWith(a.requestId + ":"),
      ) ?? [];
    const ids = a.replacementId.split("|");
    if (
      !Array.isArray(a.original?.lines) ||
      !ids.length ||
      ids.length !== a.original.lines.length ||
      ids.length > 8
    )
      throw Error("Invalid replacement set.");
    if (prior.length) {
      if (prior.length !== ids.length)
        throw Error("Replacement receipt is incomplete.");
      for (let i = 0; i < ids.length; i++) {
        const line = a.original.lines[i];
        const saved = prior.find(
          (item: any) => item.requestId === `${a.requestId}:${line.lineIndex}`,
        );
        if (!saved) throw Error("Replacement request changed.");
        assertReplacementSnapshot(saved, {
          lineIndex: line.lineIndex,
          oldListingId: line.listingId,
          newListingId: ids[i],
          qty: line.qty,
          start: line.start,
          end: line.end,
        });
      }
      return { ok: true, replayed: true };
    }
    throw Error("This legacy replacement is closed. Use the renter-approved equipment-change proposal.");
  },
});
