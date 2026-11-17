const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
const { reserveSwapStock, applySwapStock } = load("convex/lib/rentalSwapStock.ts");
const { assertRentalInventory } = load("convex/lib/rentalInventory.ts");
const { reservationOccupancy } = load("convex/lib/reservationOccupancy.ts");
const { stockWindow } = load("convex/lib/stockWindows.ts");
const { listingAvailability } = load("convex/availability.ts");
const stockOperations = load("convex/swapStockOperations.ts");
const ctx = { db, scheduler: { runAfter: async () => null } };
const start = Date.UTC(2030, 1, 1), end = start + 86400000;
const shared = put("inventory_units", { name: "Shared body", quantityOwned: 1 });
const extra = put("inventory_units", { name: "Extra lens", quantityOwned: 1 });
const old = put("listings", { title: "Body", active: true, components: [{ inventoryUnitId: shared._id, qty: 1 }] });
const replacement = put("listings", { title: "Body and lens", active: true, components: [{ inventoryUnitId: shared._id, qty: 1 }, { inventoryUnitId: extra._id, qty: 1 }] });
const lensOnly = put("listings", { title: "Lens only", active: true, components: [{ inventoryUnitId: extra._id, qty: 1 }] });
const oldLine = { listingId: old._id, title: old.title, start, end, pickupTime: "10:00", returnTime: "12:00", qty: 1, lineTotal: 20 };
const newLine = { ...oldLine, listingId: replacement._id, title: replacement.title };
const booking = put("bookings", { status: "confirmed", lineItems: [oldLine] });
put("reservations", { bookingId: booking._id, listingId: old._id, inventoryUnitId: shared._id, start, end, qty: 1, source: "site", status: "confirmed" });
const swap = put("rental_item_swaps", { bookingId: booking._id, status: "awaiting_payment" });
(async () => {
  const requested = { listingId: lensOnly._id, start, end };
  assert.equal((await listingAvailability(ctx, requested)).available, 1, "the extra item starts available");
  await reserveSwapStock(ctx, booking, oldLine, newLine, [newLine], swap._id, Date.now() - 1);
  const held = tables.get("reservations").filter(row => row.externalRef === `swap:${swap._id}`);
  assert.equal(held.length, 1);
  assert.equal(held[0].inventoryUnitId, extra._id, "shared components are not reserved twice");
  assert(await reservationOccupancy(ctx, held[0]), "unresolved payment keeps an expired hold occupied");
  assert.equal((await listingAvailability(ctx, requested)).available, 0, "storefront availability includes the accepted swap hold");
  await assert.rejects(assertRentalInventory(ctx, [newLine]), /already reserved/);
  held[0].status = "cancelled";
  assert.equal((await listingAvailability(ctx, requested)).available, 1, "a released swap hold restores storefront availability");
  held[0].status = "hold";
  await applySwapStock(ctx, booking, oldLine, newLine, [newLine], swap._id);
  assert.equal((await listingAvailability(ctx, requested)).available, 0, "the completed rental keeps its replacement stock unavailable");
  assert.equal(tables.get("reservations").filter(row => row.status === "confirmed" && row.bookingId === booking._id).length, 2);
  assert.equal(held[0].status, "cancelled");
  for (const row of tables.get("reservations").filter(row => row.status === "confirmed" && row.bookingId === booking._id)) {
    assert.equal(row.start, stockWindow(newLine, false).start, "without verified timed stock, the swap keeps the whole-day start");
    assert.equal(row.end, stockWindow(newLine, false).end, "without verified timed stock, the swap keeps the whole-day end");
  }
  const deniedUnit = put("inventory_units", { name: "Unavailable swap unit", quantityOwned: 1 });
  const deniedListing = put("listings", { title: "Unavailable swap", active: true, components: [{ inventoryUnitId: deniedUnit._id, qty: 1 }] });
  const deniedBooking = put("bookings", { status: "confirmed" });
  const deniedSwap = put("rental_item_swaps", { bookingId: deniedBooking._id, status: "accepted" });
  const deniedHold = put("reservations", { bookingId: deniedBooking._id, listingId: deniedListing._id, inventoryUnitId: deniedUnit._id, start, end, qty: 1, source: "site", status: "hold", externalRef: `swap:${deniedSwap._id}` });
  const deniedRequest = { operation: "acquire", args: {} };
  const deniedOperation = put("swap_stock_operations", { swapId: deniedSwap._id, operation: "acquire", request: deniedRequest, state: "pending", leaseToken: "capacity-conflict-test" });
  assert.equal((await listingAvailability(ctx, { listingId: deniedListing._id, start, end })).available, 0, "a pending manager claim hides its local projection");
  await stockOperations.record.handler(ctx, { id: deniedOperation._id, token: "capacity-conflict-test", request: deniedRequest, receipt: { state: "capacity_conflict" } });
  assert.equal(deniedHold.status, "cancelled", "a definitive manager capacity conflict releases the local projection");
  assert.equal((await listingAvailability(ctx, { listingId: deniedListing._id, start, end })).available, 1, "released stock becomes visible again after a confirmed conflict");
  for (const deltaPence of [1250, 0, -1250]) {
    const account = put("accounts", { email: `swap-conflict-${deltaPence}@example.invalid`, name: "Swap conflict test" });
    const booking = put("bookings", { accountId: account._id, status: "confirmed", lineItems: [] });
    const swap = put("rental_item_swaps", { bookingId: booking._id, accountId: account._id, status: "accepted", acceptedAt: Date.now(), quote: { deltaPence }, ...(deltaPence > 0 ? { paymentSessionState: "not_started" } : {}) });
    booking.activeItemSwapId = swap._id;
    const hold = put("reservations", { bookingId: booking._id, listingId: deniedListing._id, inventoryUnitId: deniedUnit._id, start, end, qty: 1, source: "site", status: "hold", externalRef: `swap:${swap._id}` });
    const request = { operation: "acquire", args: { requestId: `swap-${deltaPence}` } };
    const operation = put("swap_stock_operations", { swapId: swap._id, operation: "acquire", request, state: "pending", leaseToken: `capacity-conflict-${deltaPence}` });
    const messagesBefore = (tables.get("messages") ?? []).length;
    const args = { id: operation._id, token: `capacity-conflict-${deltaPence}`, request, receipt: { state: "capacity_conflict" } };
    assert.equal(await stockOperations.record.handler(ctx, args), "capacity_conflict");
    assert.equal(swap.status, "expired", `a pre-payment ${deltaPence}p quote closes after a definitive stock conflict`);
    assert.equal(swap.paymentSessionState, "closed", "the unpaid quote is explicitly closed");
    assert.equal(booking.activeItemSwapId, undefined, "the stale accepted quote no longer locks the original rental");
    assert.equal(hold.status, "cancelled", "the failed replacement projection is released");
    assert.equal(booking.rmv2SyncStatus, "pending", "the unlocked original booking is queued for manager sync");
    assert.equal((tables.get("messages") ?? []).filter(row => row.meta?.kind === "rental_item_swap_unavailable" && String(row.meta?.swapId) === String(swap._id)).length, 1, "the renter is told the original kit remains unchanged");
    assert.equal((tables.get("messages") ?? []).length, messagesBefore + 1, "one chat update is written atomically with closure");
    assert.equal(await stockOperations.record.handler(ctx, args), "capacity_conflict");
    assert.equal((tables.get("messages") ?? []).length, messagesBefore + 1, "duplicate conflict acknowledgements do not duplicate chat updates");
  }
  const ambiguousSettlements = [
    { key: "session", status: "awaiting_payment", sessionId: "cs_maybe_paid", paymentSessionState: "open", deltaPence: 1250 },
    { key: "session-create", status: "accepted", paymentSessionState: "creating", deltaPence: 1250 },
    { key: "payment", status: "review", paymentIntentId: "pi_maybe_paid", deltaPence: 1250 },
    { key: "refund", status: "review", refundJobId: "refund_maybe_created", deltaPence: -1250 },
  ];
  for (const settlement of ambiguousSettlements) {
    const account = put("accounts", { email: `swap-conflict-${settlement.key}@example.invalid`, name: "Swap conflict ambiguity test" });
    const booking = put("bookings", { accountId: account._id, status: "confirmed", lineItems: [] });
    const swap = put("rental_item_swaps", { bookingId: booking._id, accountId: account._id, acceptedAt: Date.now(), quote: { deltaPence: settlement.deltaPence }, ...settlement });
    booking.activeItemSwapId = swap._id;
    const hold = put("reservations", { bookingId: booking._id, listingId: deniedListing._id, inventoryUnitId: deniedUnit._id, start, end, qty: 1, source: "site", status: "hold", externalRef: `swap:${swap._id}` });
    const request = { operation: "acquire", args: { requestId: `swap-${settlement.key}` } }, token = `capacity-conflict-${settlement.key}`;
    const operation = put("swap_stock_operations", { swapId: swap._id, operation: "acquire", request, state: "pending", leaseToken: token });
    await stockOperations.record.handler(ctx, { id: operation._id, token, request, receipt: { state: "capacity_conflict" } });
    assert.equal(swap.status, settlement.status, `${settlement.key} ambiguity keeps the settlement state locked`);
    assert.equal(booking.activeItemSwapId, swap._id, `${settlement.key} ambiguity preserves the rental lock`);
    assert.equal(hold.status, "cancelled", "only the manager-denied local projection is released");
  }
  const preciseUnit = put("inventory_units", { name: "Precise kit", quantityOwned: 1 });
  const preciseOld = put("listings", { title: "Precise original", active: true, components: [{ inventoryUnitId: preciseUnit._id, qty: 1 }] });
  const preciseNew = put("listings", { title: "Precise replacement", active: true, components: [{ inventoryUnitId: preciseUnit._id, qty: 1 }] });
  const preciseLine = { ...oldLine, listingId: preciseOld._id, title: preciseOld.title, start: start + 10 * 86400000, end: end + 10 * 86400000 };
  const preciseReplacement = { ...preciseLine, listingId: preciseNew._id, title: preciseNew.title };
  const preciseBooking = put("bookings", { status: "confirmed", lineItems: [preciseLine] });
  put("reservations", { bookingId: preciseBooking._id, listingId: preciseOld._id, inventoryUnitId: preciseUnit._id, ...stockWindow(preciseLine, true), qty: 1, source: "site", status: "confirmed" });
  const preciseSwap = put("rental_item_swaps", { bookingId: preciseBooking._id, status: "awaiting_payment" });
  put("rmv2_sync_state", { key: "shared-stock-v1", status: "ok", cursor: JSON.stringify({ version: 2, turnaroundBufferMinutes: 60, checkedAt: Date.now() }) });
  await reserveSwapStock(ctx, preciseBooking, preciseLine, preciseReplacement, [preciseReplacement], preciseSwap._id, Date.now() + 60000);
  await applySwapStock(ctx, preciseBooking, preciseLine, preciseReplacement, [preciseReplacement], preciseSwap._id);
  const preciseRow = tables.get("reservations").find(row => row.status === "confirmed" && row.bookingId === preciseBooking._id);
  assert.equal(preciseRow.start, stockWindow(preciseReplacement, true).start, "verified timed stock uses the pickup time");
  assert.equal(preciseRow.end, stockWindow(preciseReplacement, true).end, "verified timed stock uses the return time and buffer");
  const exposure=load("convex/lib/rentalExposure.ts");
  const expensive=put("listings",{title:"High value replacement",active:true,depositAmount:14900,components:[{inventoryUnitId:extra._id,qty:1}]});
  const inexpensive=put("listings",{title:"Other kit",active:true,depositAmount:200,components:[{inventoryUnitId:shared._id,qty:1}]});
  const renter=put("accounts",{email:"swap-exposure@example.invalid"});
  const pendingBooking=put("bookings",{guestEmail:renter.email,status:"confirmed",lineItems:[oldLine],replacementValues:[{listingId:old._id,unitPence:10000}]});
  const pendingSwap=put("rental_item_swaps",{bookingId:pendingBooking._id,status:"awaiting_payment",lineIndex:0,newLine:{...oldLine,listingId:expensive._id}});
  pendingBooking.activeItemSwapId=pendingSwap._id;
  await assert.rejects(exposure.assertRenterExposure(ctx,{guestEmail:renter.email,status:"pending_payment",lineItems:[{...oldLine,listingId:inexpensive._id}]}),/£15,000/);
  console.log("PASS swap stock: whole-kit availability, shared component delta, unresolved expiry and atomic reservation conversion.");
})().catch(error => { console.error(error); process.exitCode = 1; });
