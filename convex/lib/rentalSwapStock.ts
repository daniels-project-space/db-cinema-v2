import { assertRentalInventory } from "./rentalInventory";
import { assertRentalAllocation } from "./rentalAllocation";
import { stockTimePrecision, stockWindow } from "./stockWindows";

function componentTotals(listing: any, quantity: number) {
  if (!listing?.components?.length || !Number.isSafeInteger(quantity) || quantity < 1) throw Error("The equipment stock mapping needs review.");
  const totals = new Map<string, { id: any; qty: number }>();
  for (const component of listing.components) {
    if (!component.inventoryUnitId || !Number.isSafeInteger(component.qty) || component.qty < 1) throw Error("The equipment stock mapping needs review.");
    const key = String(component.inventoryUnitId), current = totals.get(key);
    totals.set(key, { id: component.inventoryUnitId, qty: (current?.qty ?? 0) + component.qty * quantity });
  }
  return totals;
}

async function basketComponentTotals(ctx: any, lines: any[], precise: boolean) {
  const totals = new Map<string, { inventoryUnitId: any; listingId: any; qty: number; window: any }>();
  for (const line of lines) {
    const listing = await ctx.db.get(line.listingId);
    if (!listing?.components?.length || !Number.isSafeInteger(line.qty) || line.qty < 1) throw Error("The equipment stock mapping needs review.");
    const window = stockWindow(line, precise);
    for (const component of listing.components) {
      if (!component.inventoryUnitId || !Number.isSafeInteger(component.qty) || component.qty < 1) throw Error("The equipment stock mapping needs review.");
      const key = JSON.stringify([String(component.inventoryUnitId), window.start, window.end, window.endExclusive, window.turnaroundBufferMinutes]);
      const current = totals.get(key);
      totals.set(key, { inventoryUnitId: component.inventoryUnitId, listingId: current?.listingId ?? listing._id, qty: (current?.qty ?? 0) + component.qty * line.qty, window });
    }
  }
  return totals;
}

function positiveBasketDelta(previous: Map<string, any>, next: Map<string, any>) {
  return [...next.entries()].map(([key, value]) => ({ ...value, qty: value.qty - (previous.get(key)?.qty ?? 0) })).filter(row => row.qty > 0).sort((a, b) => String(a.inventoryUnitId).localeCompare(String(b.inventoryUnitId)) || a.window.start - b.window.start || a.window.end - b.window.end);
}

export async function reserveSwapBasketStock(ctx: any, booking: any, oldLines: any[], newLines: any[], swapId: any, expiresAt: number) {
  const reservations = await ctx.db.query("reservations").withIndex("by_booking", (query: any) => query.eq("bookingId", booking._id)).collect();
  if (reservations.some((row: any) => row.source !== "site" || ["active", "hold"].includes(row.status))) throw Error("The existing equipment allocation needs review before it can be changed.");
  await assertRentalAllocation(ctx, booking, reservations);
  await assertRentalInventory(ctx, newLines, booking._id);
  const precise = await stockTimePrecision(ctx), previous = await basketComponentTotals(ctx, oldLines, precise), next = await basketComponentTotals(ctx, newLines, precise);
  for (const component of positiveBasketDelta(previous, next)) await ctx.db.insert("reservations", { bookingId: booking._id, listingId: component.listingId, inventoryUnitId: component.inventoryUnitId, ...component.window, qty: component.qty, source: "site", status: "hold", externalRef: `swap:${swapId}`, holdExpiresAt: expiresAt });
}

export async function applySwapBasketStock(ctx: any, booking: any, oldLines: any[], newLines: any[], swapId: any) {
  const reservations = await ctx.db.query("reservations").withIndex("by_booking", (query: any) => query.eq("bookingId", booking._id)).collect();
  if (reservations.some((row: any) => row.source !== "site" || row.status === "active" || row.status === "hold" && row.externalRef !== `swap:${swapId}`)) throw Error("The equipment allocation changed during settlement.");
  await assertRentalAllocation(ctx, booking, reservations);
  const precise = await stockTimePrecision(ctx), previous = await basketComponentTotals(ctx, oldLines, precise), next = await basketComponentTotals(ctx, newLines, precise);
  const expected = positiveBasketDelta(previous, next).map(row => [String(row.inventoryUnitId), row.window.start, row.window.end, row.window.endExclusive, row.window.turnaroundBufferMinutes, String(row.listingId), row.qty]);
  const holds = reservations.filter((row: any) => row.status === "hold" && row.externalRef === `swap:${swapId}`);
  const actual = holds.map((row: any) => [String(row.inventoryUnitId), row.start, row.end, row.endExclusive, row.turnaroundBufferMinutes, String(row.listingId), row.qty]).sort((a: any[], b: any[]) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (holds.length && JSON.stringify(expected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))) !== JSON.stringify(actual)) throw Error("The reserved replacement stock needs review.");
  await assertRentalInventory(ctx, newLines, booking._id);
  for (const row of reservations) if (row.status === "confirmed" || row.status === "hold" && row.externalRef === `swap:${swapId}`) await ctx.db.patch(row._id, { status: "cancelled" });
  for (const line of newLines) {
    const listing = await ctx.db.get(line.listingId);
    if (!listing?.components?.length) throw Error("The replacement equipment stock mapping needs review.");
    for (const component of listing.components) await ctx.db.insert("reservations", { bookingId: booking._id, listingId: line.listingId, inventoryUnitId: component.inventoryUnitId, ...stockWindow(line, precise), qty: component.qty * line.qty, source: "site", status: "confirmed" });
  }
}

export async function reserveSwapStock(ctx: any, booking: any, oldLine: any, newLine: any, lines: any[], swapId: any, expiresAt: number) {
  const reservations = await ctx.db.query("reservations").withIndex("by_booking", (query: any) => query.eq("bookingId", booking._id)).collect();
  if (reservations.some((row: any) => row.source !== "site" || ["active", "hold"].includes(row.status))) throw Error("The existing equipment allocation needs review before it can be changed.");
  await assertRentalAllocation(ctx, booking, reservations);
  await assertRentalInventory(ctx, lines, booking._id);
  const oldListing = await ctx.db.get(oldLine.listingId), newListing = await ctx.db.get(newLine.listingId);
  const previous = componentTotals(oldListing, oldLine.qty), next = componentTotals(newListing, newLine.qty);
  const window = stockWindow(newLine, await stockTimePrecision(ctx));
  for (const [key, component] of next) {
    const extra = component.qty - (previous.get(key)?.qty ?? 0);
    if (extra > 0) await ctx.db.insert("reservations", { bookingId: booking._id, listingId: newLine.listingId, inventoryUnitId: component.id, ...window, qty: extra, source: "site", status: "hold", externalRef: `swap:${swapId}`, holdExpiresAt: expiresAt });
  }
}

export async function applySwapStock(ctx: any, booking: any, oldLine: any, newLine: any, lines: any[], swapId: any) {
  const reservations = await ctx.db.query("reservations").withIndex("by_booking", (query: any) => query.eq("bookingId", booking._id)).collect();
  if (reservations.some((row: any) => row.source !== "site" || row.status === "active" || row.status === "hold" && row.externalRef !== `swap:${swapId}`)) throw Error("The equipment allocation changed during settlement.");
  await assertRentalAllocation(ctx, booking, reservations);
  const oldListing = await ctx.db.get(oldLine.listingId), newListing = await ctx.db.get(newLine.listingId);
  const previous = componentTotals(oldListing, oldLine.qty), next = componentTotals(newListing, newLine.qty);
  const expected = [...next].map(([key, value]) => [key, Math.max(0, value.qty - (previous.get(key)?.qty ?? 0))]).filter(([, qty]) => Number(qty) > 0).sort();
  const holds = reservations.filter((row: any) => row.status === "hold" && row.externalRef === `swap:${swapId}`);
  const validWindows = [stockWindow(newLine, true), stockWindow(newLine, false)];
  if (holds.some((row: any) => String(row.listingId) !== String(newLine.listingId) || !validWindows.some(window => row.start === window.start && row.end === window.end && row.endExclusive === window.endExclusive && row.turnaroundBufferMinutes === window.turnaroundBufferMinutes))) throw Error("The reserved replacement dates need review.");
  const actual = holds.map((row: any) => [String(row.inventoryUnitId), row.qty]).sort();
  if (holds.length && JSON.stringify(expected) !== JSON.stringify(actual)) throw Error("The reserved replacement stock needs review.");
  await assertRentalInventory(ctx, lines, booking._id);
  const precise = await stockTimePrecision(ctx);
  for (const row of reservations) if (row.status === "confirmed" || row.status === "hold" && row.externalRef === `swap:${swapId}`) await ctx.db.patch(row._id, { status: "cancelled" });
  for (const line of lines) {
    const listing = await ctx.db.get(line.listingId);
    for (const component of listing.components) await ctx.db.insert("reservations", { bookingId: booking._id, listingId: line.listingId, inventoryUnitId: component.inventoryUnitId, ...stockWindow(line, precise), qty: component.qty * line.qty, source: "site", status: "confirmed" });
  }
}
