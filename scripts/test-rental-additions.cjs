const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
process.env.ADMIN_TOKEN = "fixture-owner";
const state = load("convex/rentalAdditionState.ts"),
  bookings = load("convex/bookings.ts"),
  ops = load("convex/rentalOperations.ts");
const ctx = { db, scheduler: { runAfter: async () => {} } },
  token = process.env.ADMIN_TOKEN;
const unit = put("inventory_units", { name: "Lens", quantityOwned: 10 });
const listing = put("listings", {
  title: "Lens kit",
  active: true,
  pricing: { daily: 30 },
  depositAmount: 100,
  components: [{ inventoryUnitId: unit._id, qty: 1 }],
});
const account = put("accounts", { email: "additions@rental-test.invalid" });
const start = Date.UTC(2030, 10, 1),
  end = start + 86400000;
function booking(status = "confirmed") {
  return put("bookings", {
    guestEmail: account.email,
    status,
    subtotal: 60,
    total: 110,
    depositAmount: 50,
    depositHoldAmount: 100,
    protection: "verify",
    stripePaymentIntentId: status === "confirmed" ? "pi_base" : undefined,
    stripeCheckoutSessionId: "cs_original",
    stripeDepositIntentId: status === "confirmed" ? "pi_old_hold" : undefined,
    depositHoldExpiresAt: Date.now() + 7 * 86400000,
    lineItems: [
      {
        listingId: listing._id,
        title: "Lens kit",
        qty: 1,
        start,
        end,
        lineTotal: 60,
      },
    ],
  });
}
const request = (b) => ({
  token,
  bookingId: b._id,
  requestId: `request-addition-${b._id}`,
  listingId: listing._id,
  qty: 1,
  reason: "Customer requested lens",
});
(async () => {
  const small=booking();Object.assign(small,{securityPolicyVersion:'2026-10-value-bands-v1',depositAmount:100,depositHoldAmount:0,total:160,stripeDepositIntentId:undefined});
  const proposed=await state.prepare.handler(ctx,{...request(small),qty:2});
  assert.equal(proposed.holdTotal,100,'Adding items across £300 requires the new £100 hold');
  assert.equal(proposed.securityCharge,0,'The paid £100 deposit is preserved, not charged again as half the hold');
  const modern=booking();Object.assign(modern,{securityPolicyVersion:'2026-10-ten-percent-hold-v2',depositAmount:100,depositHoldAmount:10});
  const extraUnit=put('inventory_units',{name:'Modern addition',quantityOwned:10});
  const extraListing=put('listings',{title:'Modern lens',active:true,pricing:{daily:30},depositAmount:200,components:[{inventoryUnitId:extraUnit._id,qty:1}]});
  const modernProposal=await state.prepare.handler(ctx,{...request(modern),listingId:extraListing._id,qty:2});
  assert.equal(modernProposal.holdTotal,50,'A new-policy addition uses 10% of the complete £500 equipment value');assert.equal(modernProposal.securityCharge,0,'The upfront payment is separate and already paid');
  const b = booking();
  await assert.rejects(
    state.prepare.handler(ctx, { ...request(b), token: "foreign" }),
    /unauthorized/,
  );
  const r = await state.prepare.handler(ctx, request(b));
  assert.equal(b.activeAdditionId, r._id);
  assert.equal(
    (await state.prepare.handler(ctx, { ...request(b), qty: 2 }))._id,
    r._id,
    "saved request wins on retry",
  );
  await assert.rejects(
    state.prepare.handler(ctx, {
      ...request(b),
      requestId: "second-addition-012345",
    }),
    /current item addition/,
  );
  await assert.rejects(state.apply.handler(ctx, { id: r._id }), /Payment/);
  await state.bindSession.handler(ctx, {
    id: r._id,
    sessionId: "cs_addition",
    url: "https://checkout.stripe.com/test",
  });
  await state.markPaid.handler(ctx, { id: r._id, paymentIntentId: "pi_added" });
  await assert.rejects(
    state.markPaid.handler(ctx, { id: r._id, paymentIntentId: "pi_foreign" }),
    /mismatch/,
  );
  await state.bindHold.handler(ctx, {
    id: r._id,
    intentId: "pi_new_hold",
    status: "held",
    expiresAt: Date.now() + 86400000,
  });
  await state.apply.handler(ctx, { id: r._id });
  const total = b.total,
    lines = b.lineItems.length;
  await state.apply.handler(ctx, { id: r._id });
  assert.equal(b.total, total);
  assert.equal(b.lineItems.length, lines);
  assert.equal(lines, 2);
  assert.equal(b.activeAdditionId, undefined);
  assert.equal(b.stripeDepositIntentId, "pi_new_hold");
  assert.deepEqual(b.depositHoldPreviousIntentIds, ["pi_old_hold"]);
  assert.equal(
    (tables.get("reservations") ?? []).filter(
      (x) => x.externalRef === `addition:${r._id}`,
    )[0].status,
    "confirmed",
  );
  const sources = await load(
    "convex/lib/rentalPaymentSources.ts",
  ).rentalPaymentSources(ctx, b);
  assert.deepEqual(
    sources.map((x) => x.paymentIntentId),
    ["pi_base", "pi_added"],
  );
  assert.equal(
    sources.reduce((n, x) => n + x.securityPence, 0),
    Math.round(b.depositAmount * 100),
  );
  const pending = booking("pending_payment");
  const draft = await state.prepare.handler(ctx, request(pending));
  await state.bindSession.handler(ctx, {
    id: draft._id,
    sessionId: "cs_replacement",
    url: "https://checkout.stripe.com/test",
  });
  await state.markPaid.handler(ctx, {
    id: draft._id,
    paymentIntentId: "pi_replacement",
  });
  await state.apply.handler(ctx, { id: draft._id });
  await bookings.confirm.handler(ctx, {
    bookingId: pending._id,
    paymentIntentId: "pi_replacement",
  });
  const reservations = (tables.get("reservations") ?? []).filter(
    (x) => x.bookingId === pending._id,
  );
  assert.equal(
    reservations.length,
    2,
    "confirmation replaces every draft hold exactly once",
  );
  assert.equal(
    reservations.reduce((n, x) => n + x.qty, 0),
    2,
  );
  assert.equal(
    (
      await bookings.confirm.handler(ctx, {
        bookingId: pending._id,
        paymentIntentId: "pi_duplicate_checkout",
      })
    ).duplicatePayment,
    true,
    "a different paid checkout is identified for its own refund",
  );
  assert.equal(
    (
      await load("convex/lib/rentalPaymentSources.ts").rentalPaymentSources(
        ctx,
        pending,
      )
    ).length,
    1,
    "replacement is original payment, never counted twice",
  );
  const preserve = booking("pending_payment");
  const old = put("reservations", {
    bookingId: preserve._id,
    inventoryUnitId: unit._id,
    listingId: listing._id,
    qty: 1,
    start,
    end,
    status: "hold",
    source: "site",
  });
  const abandoned = await state.prepare.handler(ctx, request(preserve));
  await state.close.handler(ctx, {
    id: abandoned._id,
    refunded: false,
    preserveBooking: true,
  });
  assert.equal(preserve.status, "pending_payment");
  assert.ok(await db.get(old._id));
  assert.equal(preserve.activeAdditionId, undefined);
  const blocked = booking();
  blocked.cancellationDecision = { kind: "full_refund", createdAt: Date.now() };
  await assert.rejects(
    state.prepare.handler(ctx, request(blocked)),
    /cannot accept/,
  );
  const bad = booking();
  unit.quantityOwned = undefined;
  await assert.rejects(state.prepare.handler(ctx, request(bad)), /capacity/);
  unit.quantityOwned = 10;
  const job = put("rental_refunds", {
    bookingId: b._id,
    status: "prepared",
    amountPence: 6000,
    reason: "Split payment refund",
    allocations: [
      { paymentIntentId: "pi_base", amountPence: 3000 },
      { paymentIntentId: "pi_added", amountPence: 3000 },
    ],
  });
  await ops.recordRefundPart.handler(ctx, {
    id: job._id,
    paymentIntentId: "pi_base",
    stripeRefundId: "re_base",
    status: "succeeded",
  });
  assert.equal(job.status, "prepared");
  await ops.recordRefundPart.handler(ctx, {
    id: job._id,
    paymentIntentId: "pi_added",
    stripeRefundId: "re_added",
    status: "pending",
  });
  assert.equal(job.status, "pending");
  await ops.recordRefundPart.handler(ctx, {
    id: job._id,
    paymentIntentId: "pi_added",
    stripeRefundId: "re_added",
    status: "succeeded",
  });
  assert.equal(job.status, "succeeded");
  await ops.recordRefundPart.handler(ctx, {
    id: job._id,
    paymentIntentId: "pi_added",
    stripeRefundId: "re_added",
    status: "pending",
  });
  assert.equal(job.status, "succeeded");
  const memberUnit=put("inventory_units",{name:"Member kit",quantityOwned:4}),memberListing=put("listings",{title:"Member lens",active:true,pricing:{daily:30},depositAmount:100,components:[{inventoryUnitId:memberUnit._id,qty:1}]});
  const memberBooking=booking("pending_payment");Object.assign(memberBooking,{subtotal:60,total:60,depositAmount:0,securityWaiverReason:"new_paid_membership",lineItems:[{listingId:memberListing._id,title:"Member lens",qty:1,start,end,lineTotal:60}]});
  const membership=put("membership_checkouts",{accountId:account._id,tier:"plus",intro:"credit",state:"open",bookingId:memberBooking._id,sessionId:"cs_original",sessionParams:JSON.stringify({mode:"subscription",customer:"cus_member",line_items:[{price_data:{unit_amount:6000,currency:"gbp"},quantity:1},{price:"price_starter",quantity:1}],metadata:{membershipTier:"plus",membershipFeePence:"1900"}})});memberBooking.membershipCheckoutId=membership._id;
  const edited=await state.prepare.handler(ctx,{...request(memberBooking),listingId:memberListing._id});assert.equal(edited.membershipFee,19);assert.equal(edited.membershipCheckoutId,membership._id);assert.equal(edited.securityCharge,0,"membership waiver survives owner additions while the full hold grows");assert.equal(edited.holdTotal,100);
  await state.bindSession.handler(ctx,{id:edited._id,sessionId:"cs_member_edit",url:"https://checkout.stripe.com/member-edit"});assert.equal(membership.sessionId,"cs_member_edit");assert.equal(memberBooking.stripeCheckoutSessionId,"cs_member_edit");
  await state.markPaid.handler(ctx,{id:edited._id,paymentIntentId:"pi_combined_invoice"});await state.apply.handler(ctx,{id:edited._id});
  assert.equal(memberBooking.total,120);assert.equal(memberBooking.rentalPaidPence,12000,"rental refund cap excludes the recurring fee");assert.equal(memberBooking.depositAmount,0);assert.equal(memberBooking.lineItems.length,2);
  console.log(
    "PASS actual addition handlers: owner-only; saved retries; payment/hold prerequisites; one attachment; promoted hold ledger; draft stock exactly once; payment sources; original-payment race preserves history; missing stock rejected; split refund webhooks monotonic.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
