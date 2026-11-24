const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const { assertRentalInventory, rentalInventoryDemands, assertPhysicalRentalInventory } = load("convex/lib/rentalInventory.ts");
const { bookingClaimItems } = load("convex/lib/bookingStockClaim.ts");
const { assertRentalAllocation } = load("convex/lib/rentalAllocation.ts");
const { valueIntervals } = load("convex/lib/rentalExposure.ts");
const { assertComponentReplacementExtensionPricing } = load("convex/lib/componentReplacementPolicy.ts");
const unit = put("inventory_units", { active: true, quantityOwned: 2, name: "Camera" });
const listing = put("listings", { active: true, title: "Camera", components: [{ inventoryUnitId: unit._id, qty: 1 }] });
const start = Date.UTC(2031, 0, 1), end = start + 86400000;
const line = { listingId: listing._id, start, end, qty: 1 };
const ctx = { db };
async function check(lines, allowed) {
  const demands = await rentalInventoryDemands(ctx, lines);
  if (allowed) {
    await assertRentalInventory(ctx, lines);
    await assertPhysicalRentalInventory(ctx, demands);
  } else {
    await assert.rejects(assertRentalInventory(ctx, lines), /already reserved/i);
    await assert.rejects(assertPhysicalRentalInventory(ctx, demands), /already reserved/i);
  }
}
(async () => {
  await check([line, { ...line }], true);
  const booked = put("reservations", { inventoryUnitId: unit._id, source: "site", status: "confirmed", start, end, qty: 1 });
  await check([line], true);
  await check([line, { ...line }], false);
  await db.patch(booked._id, { status: "cancelled" });
  await check([line, { ...line }], true);
  await assert.rejects(rentalInventoryDemands(ctx, [{ ...line, end: start + 366 * 86400000 }]), /date/i);
  const original = put("inventory_units", { active: true, quantityOwned: 1, name: "Original", rmv2ItemId: "original" });
  const replacement = put("inventory_units", { active: true, quantityOwned: 1, name: "Replacement", rmv2ItemId: "replacement", replacementCost: 2000 });
  const kit = put("listings", { active: true, title: "Kit", components: [{ inventoryUnitId: original._id, qty: 1 }] });
  const savedLine = { listingId: kit._id, start, end, qty: 1, physicalAllocation: { version: "component-allocation-v1", id: "accepted-kit-1", replacementValuePence: 200000, components: [{ inventoryUnitId: replacement._id, qty: 1 }] } };
  const booking = put("bookings", { lineItems: [savedLine] });
  await assert.rejects(assertComponentReplacementExtensionPricing(ctx, booking), /no approved extension rate/i);
  await assert.doesNotReject(assertComponentReplacementExtensionPricing(ctx, { lineItems: [line] }));
  const frozen = await rentalInventoryDemands(ctx, [savedLine], undefined, booking._id);
  assert.deepEqual(frozen.map(row => row.inventoryUnitId), [replacement._id], "Saved stock uses the replacement, not the original listing BOM");
  assert.deepEqual((await bookingClaimItems(ctx, booking)).map(item => item.itemId), ["replacement"], "Manager claims use the same physical allocation");
  await db.patch(kit._id, { components: [{ inventoryUnitId: unit._id, qty: 2 }] });
  assert.deepEqual((await rentalInventoryDemands(ctx, [{ ...savedLine, end: end + 86400000 }], undefined, booking._id)).map(row => row.inventoryUnitId), [replacement._id], "Catalogue edits and extensions cannot rewrite the saved allocation");
  assert.equal(await assertRentalAllocation(ctx, booking, [{ listingId: kit._id, inventoryUnitId: replacement._id, start, end, qty: 1, status: "confirmed", source: "site" }]), "legacy");
  assert.equal((await valueIntervals(ctx, booking))[0].valuePence, 200000, "Exposure uses the actual saved component, not the old catalogue kit");
  await db.patch(replacement._id, { replacementCost: 2500 });
  assert.equal((await valueIntervals(ctx, booking))[0].valuePence, 250000, "Current physical replacement value may raise the exposure");
  await db.patch(replacement._id, { replacementCost: 2000 });
  await assert.rejects(rentalInventoryDemands(ctx, [savedLine]), /allocation needs review/i);
  await assert.rejects(rentalInventoryDemands(ctx, [{ ...savedLine, physicalAllocation: { ...savedLine.physicalAllocation, components: [{ inventoryUnitId: original._id, qty: 1 }] } }], undefined, booking._id), /allocation needs review/i);
  await assert.rejects(rentalInventoryDemands(ctx, [{ ...savedLine, qty: 2 }], undefined, booking._id), /allocation needs review/i);
  const competing = put("reservations", { inventoryUnitId: replacement._id, source: "site", status: "confirmed", start, end, qty: 1 });
  await assert.rejects(assertRentalInventory(ctx, [savedLine], booking._id), /already reserved/i);
  await db.patch(competing._id, { status: "cancelled" });
  console.log("PASS physical inventory parity: shared components, confirmed stock, cancellation and invalid windows");
})().catch(error => { console.error(error); process.exitCode = 1; });
