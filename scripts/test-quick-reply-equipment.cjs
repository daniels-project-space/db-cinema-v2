const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
process.env.ADMIN_TOKEN = "fixture-equipment-owner";
const token = process.env.ADMIN_TOKEN,
  state = load("convex/rentalAdditionState.ts"),
  ops = load("convex/rentalOperations.ts");
const ctx = { db, scheduler: { runAfter: async () => {} } },
  start = Date.UTC(2031, 1, 4),
  end = start + 86400000;
const unit = put("inventory_units", {
  name: "Fixture lens",
  quantityOwned: 20,
});
const item = put("listings", {
  title: "Fixture lens kit",
  active: true,
  pricing: { daily: 30 },
  depositAmount: 100,
  sourceImages: ["https://fixture.invalid/lens.jpg"],
  components: [{ inventoryUnitId: unit._id, qty: 1 }],
});
const account = put("accounts", { email: "equipment@fixture.invalid" });
function booking() {
  return put("bookings", {
    guestEmail: account.email,
    status: "confirmed",
    subtotal: 60,
    total: 60,
    depositAmount: 100,
    depositHoldAmount: 100,
    depositHoldExpiresAt: Date.now() + 10 * 86400000,
    protection: "verify",
    stripePaymentIntentId: "fixture-paid",
    stripeDepositIntentId: "fixture-held",
    lineItems: [
      {
        listingId: item._id,
        title: item.title,
        qty: 1,
        start,
        end,
        lineTotal: 60,
      },
    ],
  });
}
const args = (b) => ({
  token,
  bookingId: b._id,
  listingId: item._id,
  qty: 1,
  reason: "Customer requested another lens",
  complimentary: false,
});
function snapshot() {
  return JSON.stringify(tables);
}
(async () => {
  const b = booking(),
    before = snapshot();
  const p = await state.preview.handler(ctx, args(b));
  assert.equal(p.ok, true);
  assert.equal(p.lineTotal, 60);
  assert.ok(p.snapshot);
  assert.ok(p.quoteSnapshot);
  assert.equal(
    snapshot(),
    before,
    "Preview must not write stock, rental, payment, audit, chat or notification data",
  );
  await assert.rejects(
    state.preview.handler(ctx, { ...args(b), token: "foreign" }),
    /unauthorized/,
  );
  assert.equal(snapshot(), before, "Unauthorized preview must not write");
  assert.equal(
    (await state.preview.handler(ctx, { ...args(b), qty: 0 })).ok,
    false,
  );
  assert.equal(snapshot(), before, "Rejected quantity preview must not write");
  const catalog = await ops.equipmentCatalog.handler(ctx, {
    token,
    search: "lens",
  });
  assert.equal(catalog[0].listingId, item._id);
  assert.equal(snapshot(), before);
  await assert.rejects(
    ops.equipmentCatalog.handler(ctx, { token: "foreign" }),
    /unauthorized/,
  );
  const reviewed = {
    ...args(b),
    requestId: "fixture-addition-reviewed-001",
    expectedSnapshot: p.snapshot,
    expectedQuote: p.quoteSnapshot,
  };
  b.total = 61;
  await assert.rejects(state.prepare.handler(ctx, reviewed), /rental changed/);
  assert.equal(b.activeAdditionId, undefined);
  b.total = 60;
  item.pricing.daily = 31;
  await assert.rejects(state.prepare.handler(ctx, reviewed), /quote changed/);
  assert.equal(b.activeAdditionId, undefined);
  item.pricing.daily = 30;
  const addition = await state.prepare.handler(ctx, reviewed);
  assert.equal(addition.reviewQuote, p.quoteSnapshot);
  assert.equal(b.activeAdditionId, addition._id);
  assert.equal(
    (await state.prepare.handler(ctx, reviewed))._id,
    addition._id,
    "Same confirmed request is reused",
  );
  await assert.rejects(
    state.prepare.handler(ctx, { ...reviewed, expectedQuote: "different" }),
    /request has changed/,
  );
  // A fresh removal review binds the entire rental, not just the selected line.
  const c = booking();
  c.lineItems.push({ ...c.lineItems[0], qty: 2, lineTotal: 120 });
  const removeReview = await ops.details.handler(ctx, {
    token,
    bookingId: c._id,
  });
  c.total += 1;
  await assert.rejects(
    ops.removeItem.handler(ctx, {
      token,
      bookingId: c._id,
      requestId: "fixture-remove-reviewed-001",
      lineIndex: 0,
      listingId: item._id,
      expectedQty: 1,
      expectedStart: start,
      expectedEnd: end,
      reason: "Customer needs fewer lenses",
      expectedSnapshot: removeReview.controlsSnapshot,
    }),
    /rental changed/,
  );
  assert.equal(
    c.lineItems.length,
    2,
    "Stale removal review cannot remove equipment",
  );
  console.log(
    "PASS readonly equipment catalog/quote, owner boundary, full-kit stock, unchanged preview state, stale rental/price rejection, confirmed-request identity, stale removal review.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
