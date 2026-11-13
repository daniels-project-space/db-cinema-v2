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
const cheaperUnit = put("inventory_units", { name: "Lower-priced replacement", quantityOwned: 1 });
const cheaper = put("listings", {
  ...common,
  title: "Lower-priced replacement",
  pricing: { daily: 30 },
  components: [{ inventoryUnitId: cheaperUnit._id, qty: 1 }],
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
  assert(!opts.options.some(option => option.id === cheaper._id), "A free replacement cannot silently change the agreed rental charge");
  // Admin authorization intentionally appends an audit row; compare all
  // business state while leaving that security record intact.
  const snapshot = () => JSON.stringify([...tables].filter(([name]) => name !== "admin_audit_log").map(([name, rows]) => [name, [...rows.values()]]));
  const beforeLegacyAttempt = snapshot();
  await assert.rejects(replacements.accept.handler(ctx, args), /legacy replacement is closed.*renter-approved equipment-change proposal/i);
  assert.equal(snapshot(), beforeLegacyAttempt, "A new direct replacement cannot change the booking, ledger, payment record, or receipt");

  // A retry for a replacement applied before this endpoint was retired remains
  // idempotent, but it must not repeat any booking or stock writes.
  await db.patch(b._id, {
    lineItems: [{ listingId: next._id, title: next.title, start, end, qty: 1, lineTotal: 80 }],
    kitReplacements: [{ requestId: args.requestId, lineIndex: 0, oldListingId: old._id, newListingId: next._id, qty: 1, start, end, appliedAt: Date.now() }],
  });
  await db.patch([...tables.get("reservations").values()][0]._id, { status: "cancelled" });
  put("reservations", { bookingId: b._id, listingId: next._id, inventoryUnitId: newUnit._id, start, end, qty: 1, source: "site", status: "confirmed" });
  const beforeReplay = snapshot();
  assert.deepEqual(await replacements.accept.handler(ctx, args), { ok: true, replayed: true });
  assert.equal(snapshot(), beforeReplay, "Legacy replay is read-only");
  await assert.rejects(replacements.accept.handler(ctx, { ...args, newListingId: old._id }), /changed/);
  assert.equal(snapshot(), beforeReplay, "A mismatched legacy replay cannot write");
  assert.equal(
    (tables.get("chat_messages") ?? []).length,
    0,
    "Acceptance never sends a message",
  );
  assert.equal(b.kitReplacements.length, 1);
  assert.equal(b.rmv2Revision, undefined, "A replay does not enqueue a second Rental Manager sync");
  const helper = load("convex/lib/quickReplyReplacement.ts");
  assert(!helper.replacementCompatible(old, { ...next, depositAmount: 2000 }));
  assert(
    !helper.replacementCompatible(old, { ...next, specs: { mount: "EF" } }),
  );
  assert(!helper.replacementCompatible(old, { ...next, marketingOnly: true }));
  console.log(
    "Legacy replacement endpoint: new direct writes blocked, exact old receipt replay preserved, mismatched replay rejected; replacement suggestions remain read-only",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
