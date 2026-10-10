const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
const replacements = load("convex/rentalReplacements.ts");
process.env.ADMIN_TOKEN = "fixture-owner-only";
const token = process.env.ADMIN_TOKEN;
const ctx = { db, scheduler: { runAfter: async () => {} } };
const start = Date.UTC(2030, 1, 1),
  end = start + 86400000;
const oldUnit = put("inventory_units", {
    name: "Original body",
    quantityOwned: 1,
  }),
  newUnit = put("inventory_units", {
    name: "Replacement body",
    quantityOwned: 1,
  });
const common = {
  category: "Cameras",
  itemType: "camera-body",
  specs: { mount: "E" },
  stockMappingStatus: "complete",
  active: true,
  depositAmount: 1000,
  pricing: { daily: 40 },
};
const old = put("listings", {
    ...common,
    title: "Original body",
    unavailableDates: ["2030-02-01"],
    components: [{ inventoryUnitId: oldUnit._id, qty: 1 }],
  }),
  next = put("listings", {
    ...common,
    title: "Replacement body",
    components: [{ inventoryUnitId: newUnit._id, qty: 1 }],
  });
const b = put("bookings", {
  status: "confirmed",
  guestEmail: "fixture@rental-test.invalid",
  total: 80,
  depositAmount: 20,
  lineItems: [
    { listingId: old._id, title: old.title, start, end, qty: 1, lineTotal: 80 },
  ],
  replacementValues: [{ listingId: old._id, unitPence: 100000 }],
});
put("reservations", {
  bookingId: b._id,
  listingId: old._id,
  inventoryUnitId: oldUnit._id,
  start,
  end,
  qty: 1,
  source: "site",
  status: "confirmed",
});
const args = {
  token,
  bookingId: b._id,
  requestId: "fixture-replacement-1234",
  lineIndex: 0,
  oldListingId: old._id,
  newListingId: next._id,
  qty: 1,
  start,
  end,
};
(async () => {
  await assert.rejects(
    replacements.options.handler(ctx, {
      token: "foreign",
      bookingId: b._id,
      lineIndex: 0,
    }),
    /Unauthorized/,
  );
  let opts = await replacements.options.handler(ctx, {
    token,
    bookingId: b._id,
    lineIndex: 0,
  });
  assert.equal(opts.options.length, 1);
  assert.equal(opts.options[0].id, next._id);
  await assert.rejects(
    replacements.accept.handler(ctx, { ...args, qty: 2 }),
    /changed/,
  );
  assert.equal(b.lineItems[0].listingId, old._id);
  const race = put("reservations", {
    inventoryUnitId: newUnit._id,
    start,
    end,
    qty: 1,
    source: "site",
    status: "confirmed",
  });
  await assert.rejects(
    replacements.accept.handler(ctx, args),
    /already reserved/,
  );
  assert.equal(b.lineItems[0].listingId, old._id);
  await db.patch(race._id, { status: "cancelled" });
  const refund = put("rental_refunds", { bookingId: b._id, status: "pending" });
  await assert.rejects(replacements.accept.handler(ctx, args), /refund/);
  await db.patch(refund._id, { status: "succeeded" });
  await db.patch(b._id, { status: "active" });
  await assert.rejects(replacements.accept.handler(ctx, args), /upcoming/);
  await db.patch(b._id, { status: "confirmed" });
  assert.equal((await replacements.accept.handler(ctx, args)).ok, true);
  assert.equal(b.lineItems[0].listingId, next._id);
  assert.equal(b.total, 80);
  assert.equal(b.depositAmount, 20);
  const current = (tables.get("reservations") ?? []).filter(
    (r) => r.bookingId === b._id && r.status === "confirmed",
  );
  assert.equal(current.length, 1);
  assert.equal(current[0].inventoryUnitId, newUnit._id);
  assert.equal((await replacements.accept.handler(ctx, args)).replayed, true);
  assert.equal(
    (tables.get("reservations") ?? []).filter(
      (r) => r.bookingId === b._id && r.status === "confirmed",
    ).length,
    1,
  );
  await assert.rejects(
    replacements.accept.handler(ctx, { ...args, newListingId: old._id }),
    /changed/,
  );
  assert.equal(
    (tables.get("chat_messages") ?? []).length,
    0,
    "Acceptance never sends a message",
  );
  assert.equal(b.kitReplacements.length, 1);
  assert.equal(b.rmv2Revision, 1);
  const helper = load("convex/lib/quickReplyReplacement.ts");
  assert(!helper.replacementCompatible(old, { ...next, depositAmount: 2000 }));
  assert(
    !helper.replacementCompatible(old, { ...next, specs: { mount: "EF" } }),
  );
  assert(!helper.replacementCompatible(old, { ...next, marketingOnly: true }));
  console.log(
    "Quick Reply replacement handlers: auth, full-basket stock race, stale snapshot, open refund, active rental, atomic swap, idempotency, unchanged money and no sends PASS",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
