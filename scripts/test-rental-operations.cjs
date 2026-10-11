const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
const operations = load("convex/rentalOperations.ts"),
  inventory = load("convex/lib/rentalInventory.ts");
process.env.ADMIN_TOKEN = "fixture-owner-only";
const token = process.env.ADMIN_TOKEN;
const ctx = { db, scheduler: { runAfter: async () => {} } };
const unit = put("inventory_units", { name: "Camera body", quantityOwned: 2 });
const listing = put("listings", {
  title: "Camera kit",
  active: true,
  components: [{ inventoryUnitId: unit._id, qty: 1 }],
  unavailableDates: [],
});
const start = Date.UTC(2030, 9, 1),
  end = Date.UTC(2030, 9, 2);
const line = {
  listingId: listing._id,
  start,
  end,
  qty: 1,
  title: "Camera kit",
  lineTotal: 100,
};
const b = put("bookings", {
  guestEmail: "owner-tests@rental-test.invalid",
  status: "confirmed",
  total: 120,
  depositAmount: 20,
  stripePaymentIntentId: "pi_fixture",
  lineItems: [line],
});
(async () => {
  await assert.rejects(
    operations.prepareRefund.handler(ctx, {
      token: "foreign",
      bookingId: b._id,
      requestId: "0123456789abcdef",
      reason: "Customer request",
    }),
    /unauthorized/,
  );
  const job = await operations.prepareRefund.handler(ctx, {
    token,
    bookingId: b._id,
    requestId: "0123456789abcdef",
    amountPence: 3000,
    reason: "Customer request",
  });
  assert.equal(job.amountPence, 3000);
  assert.equal(
    (
      await operations.prepareRefund.handler(ctx, {
        token,
        bookingId: b._id,
        requestId: "0123456789abcdef",
        amountPence: 3000,
        reason: "Customer request",
      })
    )._id,
    job._id,
  );
  for (const changed of [{amountPence:5000,reason:"Customer request"},{amountPence:3000,reason:"Different approved adjustment"}]) {
    await assert.rejects(operations.prepareRefund.handler(ctx,{token,bookingId:b._id,requestId:"0123456789abcdef",...changed}),/saved refund request changed/);
  }
  assert.equal((await operations.prepareRefund.handler(ctx,{token,bookingId:b._id,requestId:"0123456789abcdef",reason:"Customer request"}))._id,job._id,"resume without a new amount retains the original frozen refund");
  const crowded=put("bookings",{status:"active",total:120,depositAmount:20,stripePaymentIntentId:"pi_bounded_history"});
  for(let i=0;i<201;i++)put("rental_refunds",{bookingId:crowded._id,requestId:"history-refund-"+i,status:"failed",amountPence:1});
  const count=tables.get("rental_refunds").length;
  await assert.rejects(operations.prepareRefund.handler(ctx,{token,bookingId:crowded._id,requestId:"history-overflow-new-refund",amountPence:100,reason:"Owner rental adjustment"}),/full rental refund history/);
  assert.equal(tables.get("rental_refunds").length,count,"overflow cannot create an under-reconciled financial job");
  const overflow=tables.get("rental_refunds").find(r=>r.bookingId===crowded._id&&r.requestId==="history-refund-200");
  await db.delete(overflow._id);
  assert.equal((await operations.prepareRefund.handler(ctx,{token,bookingId:crowded._id,requestId:"history-exact-bound-refund",amountPence:100,reason:"Owner rental adjustment"})).amountPence,100,"exact 200-record complete ledger remains usable");
  await assert.rejects(
    operations.prepareRefund.handler(ctx, {
      token,
      bookingId: b._id,
      requestId: "another-request-0123",
      reason: "Concurrent request",
    }),
    /still processing/,
  );
  await operations.recordRefund.handler(ctx, {
    id: job._id,
    stripeRefundId: "re_fixture",
    status: "succeeded",
  });
  await operations.recordRefund.handler(ctx, {
    id: job._id,
    stripeRefundId: "re_fixture",
    status: "pending",
  });
  assert.equal(
    (await db.get(job._id)).status,
    "succeeded",
    "out-of-order provider event cannot revert settlement",
  );
  const rest = await operations.prepareRefund.handler(ctx, {
    token,
    bookingId: b._id,
    requestId: "remaining-request-0123",
    reason: "Refund remainder",
  });
  assert.equal(
    rest.amountPence,
    7000,
    "security payment excluded; previous refund deducted",
  );
  const late = put("bookings", {
    ...b,
    _id: "late-booking",
    lineItems: [
      { ...line, start: Date.now() + 3600000, end: Date.now() + 7200000 },
    ],
  });
  const discretionary = await operations.prepareRefund.handler(ctx, {
    token, bookingId: late._id, requestId: "late-request-012345", reason: "Owner discretionary refund",
  });
  assert.equal(discretionary.amountPence, 10000, "owner refunds remain available outside the customer cancellation window");
  await inventory.assertRentalInventory(ctx, [line, line]);
  await assert.rejects(
    inventory.assertRentalInventory(ctx, [line, line, line]),
    /already reserved/,
  );
  put("reservations", {
    inventoryUnitId: unit._id,
    bookingId: "someone-else",
    start,
    end,
    qty: 1,
    status: "confirmed",
  });
  await assert.rejects(
    inventory.assertRentalInventory(ctx, [{ ...line, qty: 2 }]),
    /already reserved/,
  );
  put("reservations", {
    inventoryUnitId: unit._id,
    bookingId: "expired-checkout",
    start,
    end,
    qty: 2,
    status: "hold",
    holdExpiresAt: Date.now() - 1,
  });
  await inventory.assertRentalInventory(ctx, [line]);
  listing.unavailableDates = [
    JSON.stringify({ from: "2030-10-01", to: "2030-10-02" }),
  ];
  await assert.rejects(
    inventory.assertRentalInventory(ctx, [line]),
    /unavailable/,
  );
  const bookings = load("convex/bookings.ts");
  const returning = put("bookings", {
    ...b,
    _id: "return-locked",
    returnDecision: {
      actualReturnedAt: Date.now(),
      damageKept: 0,
      chargeLate: false,
      startedAt: Date.now(),
    },
  });
  await assert.rejects(
    operations.prepareRefund.handler(ctx, {
      token,
      bookingId: returning._id,
      requestId: "return-refund-012345",
      reason: "Concurrent return refund",
    }),
    /Finish/,
  );
  await assert.rejects(
    bookings.prepareCancellation.handler(ctx, { bookingId: returning._id }),
    /Return settlement/,
  );
  await assert.rejects(
    bookings.beginReturnDecision.handler(ctx, {
      bookingId: b._id,
      actualReturnedAt: Date.now(),
      damageKept: 0,
      chargeLate: false,
    }),
    /refund to settle/,
  );
  assert.equal(
    load("convex/lib/rentalPaymentPlan.ts").confirmedRentalRefundPence([
      {
        amountPence: 10000,
        status: "failed",
        parts: [
          { status: "succeeded", amountPence: 3000 },
          { status: "failed", amountPence: 7000 },
        ],
      },
    ]),
    3000,
  );
  console.log(
    "PASS owner operations: unauthorized refunds denied; persistent retry identity; concurrent refunds blocked; out-of-order provider results; security excluded; remaining refund and owner discretionary access; shared components/quantities/expired holds/day blocks.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
