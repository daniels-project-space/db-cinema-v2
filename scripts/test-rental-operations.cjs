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
  assert.equal((await operations.prepareRefund.handler(ctx,{token,bookingId:b._id,requestId:"0123456789abcdef",amountPence:3000,reason:"Customer request"}))._id,job._id);
  await assert.rejects(operations.prepareRefund.handler(ctx,{token,bookingId:b._id,requestId:"0123456789abcdef",amountPence:5000,reason:"Customer request"}),/amount changed/);
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
  const lateRefund=await operations.prepareRefund.handler(ctx,{token,bookingId:late._id,requestId:"late-request-012345",reason:"Admin rental refund"});
  assert.equal(lateRefund.amountPence,10000,"owner refunds do not inherit the customer cancellation window");
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
  const priceLocked = put("bookings", {
    ...b,
    _id: "price-change-locked",
    status: "confirmed",
    activePriceAdjustmentId: "open-price-change",
  });
  await assert.rejects(
    bookings.prepareCancellation.handler(ctx, { bookingId: priceLocked._id }),
    /open rental change/,
  );
  await assert.rejects(
    bookings.adminSetStatus.handler(ctx, { token, bookingId: priceLocked._id, status: "active" }),
    /open rental change/,
  );
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
  const itemBooking=put("bookings",{
    guestEmail:"item-refund@rental-test.invalid",status:"active",total:120,depositAmount:20,
    stripePaymentIntentId:"pi_item_refund",lineItems:[
      {listingId:"camera-line",title:"Camera body",start,end,qty:1,lineTotal:60},
      {listingId:"lens-line",title:"Lens",start,end,qty:1,lineTotal:40},
    ],checkoutLineFunding:[
      {listingId:"camera-line",start,end,qty:1,gross:60,discount:0,membershipCredit:0,accountCredit:0,card:60},
      {listingId:"lens-line",start,end,qty:1,gross:40,discount:0,membershipCredit:0,accountCredit:0,card:40},
    ],
  });
  const cameraRefund=await operations.prepareRefund.handler(ctx,{token,bookingId:itemBooking._id,requestId:"item-camera-refund-01",lineIndex:0,reason:"Camera item returned"});
  assert.equal(cameraRefund.amountPence,6000,"item refund defaults to that line’s actual card-funded amount, not the full booking balance");
  assert.deepEqual(cameraRefund.lineAllocation,{lineIndex:0,listingId:"camera-line",start,end,qty:1,paymentIntentId:"pi_item_refund",amountPence:6000});
  await assert.rejects(operations.bindRefundAllocations.handler(ctx,{id:cameraRefund._id,allocations:[{paymentIntentId:"pi_other",amountPence:6000}]}),/recorded payment/);
  await operations.bindRefundAllocations.handler(ctx,{id:cameraRefund._id,allocations:[{paymentIntentId:"pi_item_refund",amountPence:6000}]});
  await operations.recordRefund.handler(ctx,{id:cameraRefund._id,stripeRefundId:"re_camera_item",status:"succeeded"});
  await assert.rejects(operations.prepareRefund.handler(ctx,{token,bookingId:itemBooking._id,requestId:"item-camera-refund-02",lineIndex:0,amountPence:1,reason:"Second item refund"}),/charged to this item/);
  const lensRefund=await operations.prepareRefund.handler(ctx,{token,bookingId:itemBooking._id,requestId:"item-lens-refund-01",lineIndex:1,reason:"Lens item returned"});
  assert.equal(lensRefund.amountPence,4000,"a completed refund for another item does not consume this item’s funding");
  const addedLine={listingId:"added-light",title:"Added light",start,end,qty:1,lineTotal:30};
  const additionBooking=put("bookings",{...itemBooking,_id:"addition-refund-booking",stripePaymentIntentId:"pi_addition_original",lineItems:[itemBooking.lineItems[0],addedLine],checkoutLineFunding:[itemBooking.checkoutLineFunding[0]]});
  const addition=put("rental_additions",{bookingId:additionBooking._id,...addedLine,status:"applied",paymentIntentId:"pi_added_light",cardPaidPence:3000,securityCharge:0,creditAppliedPence:0});
  const additionRefund=await operations.prepareRefund.handler(ctx,{token,bookingId:additionBooking._id,requestId:"added-item-refund-001",lineIndex:1,reason:"Refund added light"});
  assert.equal(additionRefund.lineAllocation.paymentIntentId,"pi_added_light","a separately paid item uses its own payment, not the original checkout");
  assert.equal(additionRefund.amountPence,3000);
  await assert.rejects(operations.bindRefundAllocations.handler(ctx,{id:additionRefund._id,allocations:[{paymentIntentId:"pi_addition_original",amountPence:3000}]}),/recorded payment/);
  await operations.bindRefundAllocations.handler(ctx,{id:additionRefund._id,allocations:[{paymentIntentId:"pi_added_light",amountPence:3000}]});
  await operations.recordRefund.handler(ctx,{id:additionRefund._id,stripeRefundId:"re_added_light",status:"succeeded"});
  await assert.rejects(operations.prepareRefund.handler(ctx,{token,bookingId:additionBooking._id,requestId:"added-item-refund-002",lineIndex:1,amountPence:1,reason:"Refund added light again"}),/charged to this item/);
  const uncertainAdditionBooking=put("bookings",{...additionBooking,_id:"uncertain-addition-booking"});
  put("rental_additions",{...addition,_id:"uncertain-addition",bookingId:uncertainAdditionBooking._id,cardPaidPence:undefined});
  await assert.rejects(operations.prepareRefund.handler(ctx,{token,bookingId:uncertainAdditionBooking._id,requestId:"uncertain-addition-01",lineIndex:1,reason:"Refund added light"}),/no reliable original card allocation/);
  const duplicateAdditionBooking=put("bookings",{...additionBooking,_id:"duplicate-addition-booking",lineItems:[itemBooking.lineItems[0],addedLine,{...addedLine}]});
  put("rental_additions",{...addition,_id:"duplicate-addition",bookingId:duplicateAdditionBooking._id});
  await assert.rejects(operations.prepareRefund.handler(ctx,{token,bookingId:duplicateAdditionBooking._id,requestId:"duplicate-addition-01",lineIndex:1,reason:"Refund added light"}),/no reliable original card allocation/,"duplicate item lines cannot be attributed to a single payment");
  const mixedAdditionBooking=put("bookings",{...additionBooking,_id:"mixed-addition-booking"});
  put("rental_additions",{...addition,_id:"mixed-addition",bookingId:mixedAdditionBooking._id,creditAppliedPence:500,cardPaidPence:2500});
  await assert.rejects(operations.prepareRefund.handler(ctx,{token,bookingId:mixedAdditionBooking._id,requestId:"mixed-addition-refund-01",lineIndex:1,reason:"Refund added light"}),/no reliable original card allocation/,"mixed account credit and card require a full funding allocation");
  const creditCheckoutBooking=put("bookings",{...additionBooking,_id:"credit-checkout-addition",stripePaymentIntentId:undefined,total:30,depositAmount:0,checkoutLineFunding:[{...itemBooking.checkoutLineFunding[0],card:0,accountCredit:60}]});
  put("rental_additions",{...addition,_id:"credit-checkout-added-payment",bookingId:creditCheckoutBooking._id,paymentIntentId:"pi_credit_checkout_addition"});
  const creditCheckoutRefund=await operations.prepareRefund.handler(ctx,{token,bookingId:creditCheckoutBooking._id,requestId:"credit-checkout-refund-01",lineIndex:1,reason:"Refund added light"});
  assert.equal(creditCheckoutRefund.lineAllocation.paymentIntentId,"pi_credit_checkout_addition", "an account-credit checkout can refund a later separately paid item without inventing an original payment");
  const changedBooking=put("bookings",{...itemBooking,_id:"changed-refund-booking",stripePaymentIntentId:"pi_original_changed",lineItems:[{listingId:"new-lens",title:"Replacement lens",start,end,qty:1,lineTotal:80}],checkoutLineFunding:[{listingId:"new-lens",start,end,qty:1,gross:80,discount:0,membershipCredit:0,accountCredit:0,card:80}]});
  const oldPrepared=await operations.prepareRefund.handler(ctx,{token,bookingId:changedBooking._id,requestId:"prepared-before-swap-01",lineIndex:0,amountPence:1000,reason:"Refund this item"});
  put("rental_item_swaps",{bookingId:changedBooking._id,status:"applied",paymentIntentId:"pi_swap_payment",quote:{deltaPence:2000}});
  await assert.rejects(operations.prepareRefund.handler(ctx,{token,bookingId:changedBooking._id,requestId:"prepared-before-swap-01",lineIndex:0,amountPence:1000,reason:"Refund this item"}),/payment source changed/ ,"an unexecuted earlier request cannot bypass the source check");
  oldPrepared.status="failed";
  await assert.rejects(operations.prepareRefund.handler(ctx,{token,bookingId:changedBooking._id,requestId:"refund-after-swap-0001",lineIndex:0,reason:"Refund this item"}),/payment source changed/,"a swapped item cannot be incorrectly attributed to the original card payment");
  const overallAfterSwap=await operations.prepareRefund.handler(ctx,{token,bookingId:changedBooking._id,requestId:"overall-after-swap-01",amountPence:1000,reason:"Rental adjustment"});
  assert.equal(overallAfterSwap.amountPence,1000,"a rental-total refund can still use the payment-source allocation path");
  const legacyItemBooking=put("bookings",{...itemBooking,_id:"legacy-unitemized-refund",stripePaymentIntentId:"pi_old_refund"});
  const legacyJob=await operations.prepareRefund.handler(ctx,{token,bookingId:legacyItemBooking._id,requestId:"legacy-total-refund-01",amountPence:1000,reason:"Earlier overall refund"});
  await operations.recordRefund.handler(ctx,{id:legacyJob._id,stripeRefundId:"re_legacy_total",status:"succeeded"});
  await assert.rejects(operations.prepareRefund.handler(ctx,{token,bookingId:legacyItemBooking._id,requestId:"legacy-item-refund-01",lineIndex:0,amountPence:1000,reason:"Target an item"}),/not itemized/);
  const presentation=load("shared/rentalRefundSummary.ts");
  assert.deepEqual(presentation.rentalRefundSummary(120,20,[{amountPence:3000,status:"failed",parts:[{status:"succeeded",amountPence:1000},{status:"pending",amountPence:500},{status:"failed",amountPence:1500}]}]),{rentalAmountPence:10000,confirmedRefundedPence:1000,pendingRefundPence:500,remainingRefundCapPence:8500},"pending provider refunds temporarily reserve the displayed remaining cap");
  const rentalToolsSource=require("node:fs").readFileSync(require("node:path").join(__dirname,"../src/components/admin/RentalOrderTools.tsx"),"utf8");
  assert.match(rentalToolsSource,/data-testid="refund-item-choice"/,"admin can target one booked item rather than only the whole rental");
  assert.match(rentalToolsSource,/data-testid="rental-financial-summary"/,"admin sees the readable rental refund totals");
  assert.match(rentalToolsSource,/data-testid="rental-price-adjustment-tools"[\s\S]*?The renter must accept and pay before the rental total changes/,"extra charges use the existing renter-approved price proposal, not an immediate arbitrary card charge");
  console.log(
    "PASS owner operations: item-bound refund cap and original-payment targeting; unitemized history guard; readable confirmed/pending refund totals; renter-approved extra charges; existing refund safety, concurrency, provider ordering, security, and inventory invariants.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
