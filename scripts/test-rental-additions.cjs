const assert = require("node:assert/strict");
const { load, db, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");
process.env.ADMIN_TOKEN = "fixture-owner";
const state = load("convex/rentalAdditionState.ts"),
  bookings = load("convex/bookings.ts"),
  accounts = load("convex/accounts.ts"),
  ops = load("convex/rentalOperations.ts");
const {dateLabel,londonRentalInstant}=load("shared/rentalWindow.ts");
const ctx = { db, scheduler: { runAfter: async () => {} } },
  token = process.env.ADMIN_TOKEN;
const unit = put("inventory_units", { name: "Lens", quantityOwned: 10 });
const listing = put("listings", {
  title: "Lens kit",
  active: true,
  reviewedImageUrls: ["https://cdn.example.invalid/lens-kit-reviewed.jpg"],
  pricing: { daily: 30 },
  depositAmount: 100,
  components: [{ inventoryUnitId: unit._id, qty: 1 }],
});
const account = put("accounts", { email: "additions@rental-test.invalid" });
put("sessions", { accountId: account._id, token: "addition-renter", expiresAt: Date.now() + 86400000 });
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
  const originalInvoiceSnapshot = {
    number: `DBC-${String(b._id).slice(-8).toUpperCase()}`,
    issuedAt: Date.now(),
    lineItems: [{ title: "Lens kit", lineTotal: 60 }],
    subtotal: 60,
    total: 110,
  };
  Object.assign(b, {
    invoiceSnapshot: structuredClone(originalInvoiceSnapshot),
    verificationProvider: "didit",
    diditSessionId: "original-didit-session",
    idVerifyStatus: "verified",
    idVerificationSource: "didit",
  });
  await assert.rejects(
    state.prepare.handler(ctx, { ...request(b), token: "foreign" }),
    /unauthorized/,
  );
  const r = await state.prepare.handler(ctx, request(b));
  assert.equal(b.activeAdditionId, r._id);
  const renterCard = await state.customerState.handler(ctx, { token: "addition-renter", bookingId: b._id });
  assert.deepEqual(renterCard.imageSources, ["https://cdn.example.invalid/lens-kit-reviewed.jpg"], "the renter proposal uses the reviewed listing photo");
  assert.equal(renterCard.rentalCharge, r.lineTotal, "the renter card shows the saved net rental charge");
  assert.equal(renterCard.amount, renterCard.rentalCharge + r.securityCharge, "the amount due matches rental plus separately shown security");
  assert.equal(
    (await state.prepare.handler(ctx, { ...request(b), qty: 2 }))._id,
    r._id,
    "saved request wins on retry",
  );
  const durationUnit=put("inventory_units",{name:"Uplifted duration-tier addition",quantityOwned:20});
  const durationListing=put("listings",{title:"Uplifted duration-tier addition",active:true,pricing:{daily:29,day3:25,day7:20},depositAmount:100,components:[{inventoryUnitId:durationUnit._id,qty:1}]});
  for(const [days,total] of [[1,29],[3,79],[7,143]]){
    const durationBooking=booking();
    const prepared=await state.prepare.handler(ctx,{...request(durationBooking),requestId:`duration-addition-${days}-${durationBooking._id}`,listingId:durationListing._id,start,end:start+(days-1)*86400000});
    assert.equal(prepared.lineTotal,total,`${days}-day addition uses the shared uplifted duration tier`);
  }
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
  const initialAdditionAmount=Math.round((r.lineTotal+r.securityCharge+(r.membershipFee??0))*100);
  await state.markPaid.handler(ctx, { id: r._id, paymentIntentId: "pi_added", amountPence:initialAdditionAmount });
  await assert.rejects(
    state.markPaid.handler(ctx, { id: r._id, paymentIntentId: "pi_foreign", amountPence:initialAdditionAmount }),
    /mismatch/,
  );
  await state.bindHold.handler(ctx, {
    id: r._id,
    intentId: "pi_new_hold",
    status: "held",
    expiresAt: Date.now() + 86400000,
  });
  b.itemPaymentLedgerVersion=1;b.itemPaymentLedger=[{listingId:b.lineItems[0].listingId,qty:1,sources:[{paymentIntentId:'pi_base',amountPence:6000}]}];
  const unresolvedReceipt = put("swap_stock_applied_receipts", { bookingId: b._id, deliveryState: "pending" });
  await assert.rejects(state.apply.handler(ctx, { id: r._id }), /stock reconciliation/);
  assert.equal(b.activeAdditionId, r._id);
  await db.patch(unresolvedReceipt._id, { deliveryState: "acknowledged", stockRisk: false });
  await state.apply.handler(ctx, { id: r._id });
  if(r.securityCharge===0 && !(r.membershipFee??0))assert.deepEqual(b.itemPaymentLedger[1].sources,[{paymentIntentId:'pi_added',amountPence:Math.round(r.lineTotal*100)}],'a straightforward paid addition records its own provider source');
  else assert.equal(b.itemPaymentLedger,undefined,'an addition with ambiguous extra funding invalidates provenance rather than guessing');
  const total = b.total,
    lines = b.lineItems.length;
  await state.apply.handler(ctx, { id: r._id });
  assert.equal(b.total, total);
  assert.equal(b.lineItems.length, lines);
  assert.equal(lines, 2);
  assert.equal(b.activeAdditionId, undefined);
  assert.equal(r.bookingId, b._id, "a paid addition amends its original rental rather than creating another booking");
  assert.equal(b.diditSessionId, "original-didit-session", "an addition reuses the existing rental's verified Didit session without opening a duplicate");
  assert.deepEqual(b.invoiceSnapshot, originalInvoiceSnapshot, "an equipment addition never rewrites the original signed and paid invoice snapshot");
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
  assert.equal(sources[1].paymentIntentId, "pi_added", "the amendment payment remains a distinct, independently reconciled payment source");
  const renterBookings = await accounts.myBookings.handler(ctx, { token: "addition-renter" });
  const amendedRental = renterBookings.find((row) => row._id === b._id);
  assert.equal(amendedRental.lineItems.length, 2, "the renter booking list shows the added item on the existing rental");
  assert.equal(amendedRental.lineItems[1].title, r.title, "the new listing is presented as part of the amended rental");
  const originalRentalId = b._id;
  const freshCheckout = await bookings.createPending.handler(ctx, {
    customerEmail: account.email,
    fulfilment: "pickup",
    deliveryFee: 0,
    lineItems: [{ listingId: extraListing._id, title: extraListing.title, start, end, qty: 1, lineTotal: 1 }],
    subtotal: 1,
    depositAmount: 0,
    total: 1,
    expectedTotalDue: 1,
    currency: "GBP",
  });
  assert.notEqual(freshCheckout.bookingId, originalRentalId, "a fresh checkout is not silently merged into another rental's signed invoice and payment history");
  assert.equal((await db.get(originalRentalId)).lineItems.length, 2, "a fresh checkout leaves the explicit amendment unchanged");
  assert.equal((await db.get(freshCheckout.bookingId)).lineItems.length, 1, "the independent checkout retains its own item and rental record");
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
    amountPence:Math.round(((draft.baseTotal??0)+draft.lineTotal+draft.securityCharge+(draft.membershipFee??0))*100),
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
  const membershipPreview=await state.preview.handler(ctx,{...request(memberBooking),listingId:memberListing._id});assert.equal(membershipPreview.ok,true);assert.equal(membershipPreview.securityCharge,25,"a newly subscribed checkout cannot waive security before its first paid invoice");
  const edited=await state.prepare.handler(ctx,{...request(memberBooking),listingId:memberListing._id,expectedQuote:membershipPreview.quoteSnapshot});assert.equal(edited.membershipFee,19);assert.equal(edited.membershipCheckoutId,membership._id);assert.equal(edited.securityCharge,25,"admin prepare uses the same non-waiver quote as preview");assert.equal(edited.holdTotal,100);
  await state.bindSession.handler(ctx,{id:edited._id,sessionId:"cs_member_edit",url:"https://checkout.stripe.com/member-edit"});assert.equal(membership.sessionId,"cs_member_edit");assert.equal(memberBooking.stripeCheckoutSessionId,"cs_member_edit");
  await state.markPaid.handler(ctx,{id:edited._id,paymentIntentId:"pi_combined_invoice",amountPence:Math.round(((edited.baseTotal??0)+edited.lineTotal+edited.securityCharge+edited.membershipFee)*100)});await state.apply.handler(ctx,{id:edited._id});
  assert.equal(memberBooking.total,145);assert.equal(memberBooking.rentalPaidPence,14500,"rental refund cap excludes the recurring fee");assert.equal(memberBooking.depositAmount,25);assert.equal(memberBooking.lineItems.length,2);

  const legacyUnit=put("inventory_units",{name:"Legacy accepted kit",quantityOwned:3}),legacyListing=put("listings",{title:"Legacy accepted lens",active:true,pricing:{daily:40},depositAmount:600,components:[{inventoryUnitId:legacyUnit._id,qty:1}]});
  const legacyAccepted=booking("confirmed");Object.assign(legacyAccepted,{guestEmail:"legacy-waiver@rental-test.invalid",subtotal:80,total:80,depositAmount:0,depositHoldAmount:0,securityPolicyVersion:"2026-10-refundable-assessment-v2",securityWaiverReason:"paid_membership",lineItems:[{listingId:legacyListing._id,title:legacyListing.title,qty:1,start,end,lineTotal:80}],replacementValues:[{listingId:legacyListing._id,unitPence:60000}]});
  put("reservations",{bookingId:legacyAccepted._id,listingId:legacyListing._id,inventoryUnitId:legacyUnit._id,qty:1,start,end,status:"confirmed",source:"site"});
  const originalTerms={total:legacyAccepted.total,depositAmount:legacyAccepted.depositAmount,reason:legacyAccepted.securityWaiverReason,lineItems:JSON.stringify(legacyAccepted.lineItems)};
  const legacyPreview=await state.preview.handler(ctx,{...request(legacyAccepted),listingId:legacyListing._id});assert.equal(legacyPreview.ok,true);assert.equal(legacyPreview.securityCharge,50,"a new addition with a legacy waiver label quotes standard security for the new total");
  const legacyAddition=await state.prepare.handler(ctx,{...request(legacyAccepted),listingId:legacyListing._id,expectedQuote:legacyPreview.quoteSnapshot});assert.equal(legacyAddition.securityCharge,50);
  assert.deepEqual({total:legacyAccepted.total,depositAmount:legacyAccepted.depositAmount,reason:legacyAccepted.securityWaiverReason,lineItems:JSON.stringify(legacyAccepted.lineItems)},originalTerms,"new add-on security does not retroactively reprice or rewrite an accepted booking's signed line items");

  const earned=put("accounts",{email:"earned-addition@rental-test.invalid",membershipActive:true,membershipTier:"plus",membershipStatus:"active",membershipPaidThrough:Date.now()+30*86400000,stripeSubscriptionId:"sub_earned_addition"});
  const loyaltyCtx={...ctx,storage:{getUrl:async()=>null}};
  const assignedEncore=put("accounts",{email:"assigned-addition@rental-test.invalid",adminEncoreLevel:2});
  const assignedBooking=booking();Object.assign(assignedBooking,{accountId:assignedEncore._id,guestEmail:assignedEncore.email});
  const assignedPreview=await state.preview.handler(loyaltyCtx,{...request(assignedBooking),listingId:memberListing._id});
  assert.equal(assignedPreview.benefitKind,"loyalty","an admin-assigned Encore tier is recognized by the chat addition quote without a completed-rental marker");
  assert.equal(assignedPreview.benefitSaving,2.4);
  assert.equal(assignedPreview.lineTotal,57.6);
  const assignedProgress=await load("convex/lib/loyalty.ts").loyaltyProgress(ctx,assignedEncore);
  assert.equal(assignedProgress.completed,0,"granting a manual benefit does not fabricate earned rentals");
  for(let index=0;index<3;index++){
    const historicalEnd=dateLabel(Date.now()-(index+3)*86400000),actualReturnedAt=londonRentalInstant(historicalEnd,"20:00");
    const inspection=[{key:"legacy:0:0",title:memberListing.title,condition:"good",details:"",openCase:false}],paidAt=actualReturnedAt-2*86400000;
    const historical=put("bookings",{accountId:earned._id,guestEmail:earned.email,status:"returned",stripeCheckoutSessionId:`cs-earned-addition-${index}`,stripePaymentIntentId:`pi-earned-addition-${index}`,paidConfirmedAt:paidAt,checkoutPaidAt:paidAt,checkoutPaymentAmountPence:6000,checkoutExpectedAmountPence:6000,checkoutPaymentCurrency:"GBP",checkoutPaymentStatus:"paid",rentalPaidPence:6000,pickedUpAt:londonRentalInstant(historicalEnd-86400000,"09:00"),lineItems:[{listingId:memberListing._id,title:memberListing.title,qty:1,start:historicalEnd-86400000,end:historicalEnd,lineTotal:60}],idVerifyStatus:"verified",currency:"GBP",depositAmount:0,depositHoldAmount:0,total:60,subtotal:60,actualReturnedAt,returnDecision:{actualReturnedAt,chargeLate:false,damageKept:0,depositKept:0,inspection},returnStatement:{actualReturnedAt,inspection,rentalRefunded:0,securityPaid:0,securityRefunded:0,holdStatus:"not_applicable",damageTotal:0,damageFromHold:0,lateAssessed:0,lateWaived:0}});
    put("reviews",{source:"native",authorAccountId:earned._id,verifiedBookingId:historical._id,rating:5,text:"A clear review of this completed rental."});
  }
  const earnedBooking=booking();Object.assign(earnedBooking,{accountId:earned._id,guestEmail:earned.email});
  const earnedArgs={...request(earnedBooking),listingId:memberListing._id};
  const earnedPreview=await state.preview.handler(loyaltyCtx,earnedArgs);
  assert.equal(earnedPreview.ok,true);
  assert.equal(earnedPreview.benefitKind,"loyalty");
  assert.equal(earnedPreview.benefitSaving,6,"earned Encore beats an active Starter subscription with no rental discount after linked native reviews");
  assert.equal(earnedPreview.undiscountedLineTotal,60);
  assert.equal(earnedPreview.lineTotal,54,"the displayed add-on quote is net of Encore");
  const paidMember=put("accounts",{email:"paid-member-addition@rental-test.invalid",membershipActive:true,membershipTier:"pro",membershipStatus:"active",membershipPaidThrough:Date.now()+30*86400000,stripeSubscriptionId:"sub_paid_member_addition"});
  for(let index=0;index<3;index++){
    const historicalEnd=dateLabel(Date.now()-(index+3)*86400000),actualReturnedAt=londonRentalInstant(historicalEnd,"20:00");
    const inspection=[{key:"legacy:0:0",title:memberListing.title,condition:"good",details:"",openCase:false}],paidAt=actualReturnedAt-2*86400000;
    const historical=put("bookings",{accountId:paidMember._id,guestEmail:paidMember.email,status:"returned",stripeCheckoutSessionId:`cs-pro-earned-addition-${index}`,stripePaymentIntentId:`pi-pro-earned-addition-${index}`,paidConfirmedAt:paidAt,checkoutPaidAt:paidAt,checkoutPaymentAmountPence:6000,checkoutExpectedAmountPence:6000,checkoutPaymentCurrency:"GBP",checkoutPaymentStatus:"paid",rentalPaidPence:6000,pickedUpAt:londonRentalInstant(historicalEnd-86400000,"09:00"),lineItems:[{listingId:memberListing._id,title:memberListing.title,qty:1,start:historicalEnd-86400000,end:historicalEnd,lineTotal:60}],idVerifyStatus:"verified",currency:"GBP",depositAmount:0,depositHoldAmount:0,total:60,subtotal:60,actualReturnedAt,returnDecision:{actualReturnedAt,chargeLate:false,damageKept:0,depositKept:0,inspection},returnStatement:{actualReturnedAt,inspection,rentalRefunded:0,securityPaid:0,securityRefunded:0,holdStatus:"not_applicable",damageTotal:0,damageFromHold:0,lateAssessed:0,lateWaived:0}});
    put("reviews",{source:"native",authorAccountId:paidMember._id,verifiedBookingId:historical._id,rating:5,text:"A clear review of this completed rental."});
  }
  const paidMemberBooking=booking();Object.assign(paidMemberBooking,{accountId:paidMember._id,guestEmail:paidMember.email});
  const paidMemberPreview=await state.preview.handler(loyaltyCtx,{...request(paidMemberBooking),listingId:memberListing._id});
  assert.equal(paidMemberPreview.benefitKind,"weekend");
  assert.equal(paidMemberPreview.benefitSaving,30,"the Pro weekend saving beats earned 10% Encore (£6) on the same chat addition");
  assert.equal(paidMemberPreview.lineTotal,30);
  const unpaidMember=put("accounts",{email:"unpaid-member-addition@rental-test.invalid",membershipActive:true,membershipTier:"pro",membershipStatus:"incomplete",membershipPaidThrough:Date.now()+30*86400000,stripeSubscriptionId:"sub_unpaid_member_addition"});
  const unpaidMemberBooking=booking();Object.assign(unpaidMemberBooking,{accountId:unpaidMember._id,guestEmail:unpaidMember.email});
  const unpaidMemberPreview=await state.preview.handler(loyaltyCtx,{...request(unpaidMemberBooking),listingId:memberListing._id});
  assert.equal(unpaidMemberPreview.benefitKind,"none","an unpaid/incomplete subscription cannot unlock checkout perks");
  assert.equal(unpaidMemberPreview.lineTotal,60);
  const trialMember=put("accounts",{email:"trial-member-addition@rental-test.invalid",membershipActive:true,membershipTier:"pro",membershipStatus:"trialing",membershipTrialEnd:Date.now()+7*86400000,stripeSubscriptionId:"sub_trial_member_addition"});
  const trialBooking=booking("pending_payment");Object.assign(trialBooking,{accountId:trialMember._id,guestEmail:trialMember.email});trialMember.membershipPerksPendingBookingId=trialBooking._id;
  const trialPreview=await state.preview.handler(loyaltyCtx,{...request(trialBooking),listingId:memberListing._id});
  assert.equal(trialPreview.benefitKind,"none","the free starter trial cannot discount its first rental while checkout perks are pending");
  assert.equal(trialPreview.lineTotal,60);
  const earnedBookingTwoItems=booking();Object.assign(earnedBookingTwoItems,{accountId:earned._id,guestEmail:earned.email});
  const earnedArgsTwoItems={...request(earnedBookingTwoItems),listingId:memberListing._id,qty:2};
  const earnedTwoItemPreview=await state.preview.handler(loyaltyCtx,earnedArgsTwoItems);
  assert.equal(earnedTwoItemPreview.benefitKind,"loyalty");
  assert.equal(earnedTwoItemPreview.undiscountedLineTotal,120);
  assert.equal(earnedTwoItemPreview.benefitSaving,12,"Encore applies once to the aggregate quantity, without multiplying or losing the discount");
  assert.equal(earnedTwoItemPreview.lineTotal,108);
  const earnedPrepared=await state.prepare.handler(loyaltyCtx,{...earnedArgsTwoItems,expectedSnapshot:earnedTwoItemPreview.snapshot,expectedQuote:earnedTwoItemPreview.quoteSnapshot});
  assert.equal(earnedPrepared.qty,2);
  assert.equal(earnedPrepared.lineTotal,108,"the prepared payment record preserves the discounted multi-item total");
  assert.equal(earnedPrepared.benefitSaving,12);
  let stripeParams, simulateLostResponse=true, staleSession;const additionKeys=[];
  class StripeFixture{checkout={sessions:{create:async(params,options)=>{stripeParams=params;additionKeys.push(options.idempotencyKey);if(simulateLostResponse){simulateLostResponse=false;throw Error("Synthetic lost provider response");}return{id:"cs_earned_addition",url:"https://checkout.stripe.com/earned-addition",status:"open",payment_status:"unpaid",amount_total:params.line_items[0].price_data.unit_amount,metadata:params.metadata}},retrieve:async(id)=>{if(staleSession?.id===id)return staleSession;throw Error("Unexpected session retrieval")},list:async function*(){}}};}
  setMock("stripe",{__esModule:true,default:StripeFixture});
  const additionActions=load("convex/rentalAdditions.ts");
  const paymentCtx={...loyaltyCtx,runQuery:async(ref,args)=>{
    if(ref==="rentalAdditionState.existing")return state.existing.handler(loyaltyCtx,args);
    if(ref==="rentalAdditionState.context")return state.context.handler(loyaltyCtx,args);
    if(ref==="rentalOperations.refundContext")return ops.refundContext.handler(loyaltyCtx,args);
    throw Error("unexpected query "+ref);
  },runMutation:async(ref,args)=>{
    if(ref==="adminAuth.assertAdminInternal")return;
    if(ref==="rentalAdditionState.prepare")return state.prepare.handler(loyaltyCtx,args);
    if(ref==="rentalAdditionState.bindSession")return state.bindSession.handler(loyaltyCtx,args);
    if(ref==="rentalAdditionState.markSessionCreation")return state.markSessionCreation.handler(loyaltyCtx,args);
    throw Error("unexpected mutation "+ref);
  }};
  process.env.STRIPE_SECRET_KEY="sk_test_fixture";
  put("sessions",{accountId:earned._id,token:"earned-addition-renter",expiresAt:Date.now()+86400000});
  await assert.rejects(additionActions.start.handler(paymentCtx,{...earnedArgsTwoItems,expectedSnapshot:earnedTwoItemPreview.snapshot,expectedQuote:earnedTwoItemPreview.quoteSnapshot}),/lost provider response/);
  assert.equal(earnedPrepared.sessionCreationPending,true,"an uncertain provider response keeps the checkout-creation lock");
  await assert.rejects(state.selectAccountCredit.handler(loyaltyCtx,{token:"earned-addition-renter",bookingId:earnedBookingTwoItems._id,additionId:earnedPrepared._id}),/existing card payment is being checked/,"credit cannot be selected while the earlier card checkout may exist");
  const paymentLink=await additionActions.start.handler(paymentCtx,{...earnedArgsTwoItems,expectedSnapshot:earnedTwoItemPreview.snapshot,expectedQuote:earnedTwoItemPreview.quoteSnapshot});
  assert.deepEqual(additionKeys,[additionKeys[0],additionKeys[0]],"lost-response retry uses the same Stripe idempotency key");assert.equal(earnedPrepared.sessionCreationPending,false);
  assert.equal(paymentLink.url,"https://checkout.stripe.com/earned-addition");
  assert.equal(stripeParams.line_items[0].price_data.unit_amount,Math.round((earnedPrepared.lineTotal+earnedPrepared.securityCharge)*100),"Stripe authorizes exactly the net discounted rental amount plus separately quoted security");
  assert.match(stripeParams.line_items[0].price_data.product_data.description,/Encore · 10% rental saving/);
  assert.match(stripeParams.line_items[0].price_data.product_data.description,/£12.00/);
  const offerMessage=(tables.get("messages")??[]).find(message=>message.bookingId===earnedBookingTwoItems._id&&message.meta?.kind==="paylink");
  assert.equal(offerMessage.meta.amount,earnedPrepared.lineTotal+earnedPrepared.securityCharge);
  assert.equal(offerMessage.meta.benefitSaving,12,"the chat payment offer shows the same aggregate saving as the stored and charged quote");

  // Addition credit is an explicit reservation and is consumed only at the shared apply boundary.
  const {SETUP_INTENT_SECURITY_POLICY_VERSION}=load("shared/rentalSecurity.ts");
  const creditUnit=put("inventory_units",{name:"Account-credit add-on",quantityOwned:10});
  const creditListing=put("listings",{title:"Account-credit add-on",active:true,pricing:{daily:30},depositAmount:0,components:[{inventoryUnitId:creditUnit._id,qty:1}]});
  const partialAccount=put("accounts",{email:"addition-credit@rental-test.invalid"});put("sessions",{accountId:partialAccount._id,token:"addition-credit-renter",expiresAt:Date.now()+86400000});
  const partialBooking=booking();Object.assign(partialBooking,{accountId:partialAccount._id,guestEmail:partialAccount.email,securityPolicyVersion:SETUP_INTENT_SECURITY_POLICY_VERSION,depositAmount:0,depositHoldAmount:0,lineItems:[{listingId:listing._id,title:"Lens kit",qty:1,start,end,lineTotal:60}]});
  const partialCredit=put("credits",{accountId:partialAccount._id,kind:"refund",currency:"GBP",amount:5,remaining:5,reason:"rental_refund",createdAt:Date.now(),expiresAt:Date.now()+86400000,status:"active"});
  const partialArgs={token,bookingId:partialBooking._id,requestId:`request-addition-credit-${partialBooking._id}`,listingId:creditListing._id,qty:1,reason:"Renter requested an extra item"};
  const partialPrepared=await state.prepare.handler(ctx,partialArgs);
  const renterCreditChoice=await state.selectAccountCredit.handler(ctx,{token:"addition-credit-renter",bookingId:partialBooking._id,additionId:partialPrepared._id});
  staleSession={id:"cs_stale_card_only",status:"complete",payment_status:"paid",currency:"gbp",amount_total:Math.round(partialPrepared.lineTotal*100),metadata:{rentalAdditionId:partialPrepared._id}};
  await assert.rejects(additionActions.finalizePaid.handler(paymentCtx,{id:partialPrepared._id,sessionId:staleSession.id}),/payment has not completed/i,"a stale card-only link cannot apply after credit is selected");assert.equal(partialCredit.remaining,5);
  const partialCardDuePence=Math.round(partialPrepared.lineTotal*100)-500;
  assert.equal(renterCreditChoice.creditAppliedPence,500);assert.equal(renterCreditChoice.cardDuePence,partialCardDuePence,"card remainder is calculated from the saved add-on quote");assert.equal(partialCredit.remaining,5,"selected credit stays reserved until the payment and item attachment commit");
  await state.markPaid.handler(ctx,{id:partialPrepared._id,paymentIntentId:"pi_addition_credit_partial",amountPence:partialCardDuePence});
  await state.apply.handler(ctx,{id:partialPrepared._id});assert.equal(partialCredit.remaining,0,"the shared apply mutation consumes wallet credit after card payment");
  const partialCreditSources=await load("convex/lib/rentalPaymentSources.ts").rentalPaymentSources(ctx,partialBooking);
  assert(partialCreditSources.some(row=>row.paymentIntentId==="pi_addition_credit_partial"&&row.maxPaidPence===partialCardDuePence),"the add-on's refundable Stripe source is capped at cash actually paid");
  await state.apply.handler(ctx,{id:partialPrepared._id});assert.equal(partialCredit.remaining,0,"replayed item attachment cannot debit credit twice");

  const fullAccount=put("accounts",{email:"addition-full-credit@rental-test.invalid"});put("sessions",{accountId:fullAccount._id,token:"addition-full-credit-renter",expiresAt:Date.now()+86400000});
  const fullBooking=booking();Object.assign(fullBooking,{accountId:fullAccount._id,guestEmail:fullAccount.email,securityPolicyVersion:SETUP_INTENT_SECURITY_POLICY_VERSION,depositAmount:0,depositHoldAmount:0,lineItems:[{listingId:listing._id,title:"Lens kit",qty:1,start,end,lineTotal:60}]});
  const fullCredit=put("credits",{accountId:fullAccount._id,kind:"earned",currency:"GBP",amount:100,remaining:100,reason:"earned_credit",createdAt:Date.now(),expiresAt:Date.now()+86400000,status:"active"});
  const fullPrepared=await state.prepare.handler(ctx,{...partialArgs,bookingId:fullBooking._id,requestId:`request-addition-credit-${fullBooking._id}`});
  const fullChoice=await state.selectAccountCredit.handler(ctx,{token:"addition-full-credit-renter",bookingId:fullBooking._id,additionId:fullPrepared._id});
  assert.equal(fullChoice.cardDuePence,0,"full wallet coverage removes the card payment without changing the quoted rental value");
  await state.apply.handler(ctx,{id:fullPrepared._id});assert.equal((await db.get(fullPrepared._id)).status,"applied");assert.equal(fullCredit.remaining,100-fullPrepared.lineTotal,"only the exact item amount is spent; the excess balance stays available");
  await state.apply.handler(ctx,{id:fullPrepared._id});assert.equal(fullCredit.remaining,100-fullPrepared.lineTotal,"fully credit-funded retries are idempotent");

  const releasedAccount=put("accounts",{email:"addition-released-credit@rental-test.invalid"});put("sessions",{accountId:releasedAccount._id,token:"addition-released-credit-renter",expiresAt:Date.now()+86400000});
  const releasedBooking=booking();Object.assign(releasedBooking,{accountId:releasedAccount._id,guestEmail:releasedAccount.email,securityPolicyVersion:SETUP_INTENT_SECURITY_POLICY_VERSION,depositAmount:0,depositHoldAmount:0,lineItems:[{listingId:listing._id,title:"Lens kit",qty:1,start,end,lineTotal:60}]});
  const releasedCredit=put("credits",{accountId:releasedAccount._id,kind:"refund",currency:"GBP",amount:5,remaining:5,reason:"rental_refund",createdAt:Date.now(),expiresAt:Date.now()+86400000,status:"active"});
  const releasedPrepared=await state.prepare.handler(ctx,{...partialArgs,bookingId:releasedBooking._id,requestId:`request-addition-credit-${releasedBooking._id}`});
  await state.selectAccountCredit.handler(ctx,{token:"addition-released-credit-renter",bookingId:releasedBooking._id,additionId:releasedPrepared._id});
  await state.close.handler(ctx,{id:releasedPrepared._id,refunded:false});
  assert.equal(releasedCredit.remaining,5,"closing an unpaid add-on releases its reserved wallet credit");
  const releasedReservation=(tables.get("rental_credit_reservations")??[]).find(row=>row.operationType==="addition"&&row.operationId===String(releasedPrepared._id));assert.equal(releasedReservation.state,"released");

  const verifiedAt=Date.now()-86400000,passExpiresAt=verifiedAt+90*86400000,mulanStart=new Date().setUTCHours(0,0,0,0)+3*86400000,mulanEnd=mulanStart+86400000;
  const mulanAccount=put("accounts",{email:"mulan-overlap@rental-test.invalid",name:"Mulan Example",address:"25 Whitcomb Street WC2H 7ER",emailVerifiedAt:verifiedAt-60000,renterPersonKey:"mulan-person-key"});
  const baseUnit=put("inventory_units",{name:"Mulan existing rental",quantityOwned:2}),baseListing=put("listings",{title:"Mulan existing camera",active:true,pricing:{daily:50},depositAmount:8000,components:[{inventoryUnitId:baseUnit._id,qty:1}]});
  const addonUnit=put("inventory_units",{name:"Mulan overlapping addition",quantityOwned:2}),addonListing=put("listings",{title:"Mulan added lens",active:true,pricing:{daily:25},depositAmount:3000,components:[{inventoryUnitId:addonUnit._id,qty:1}]});
  const capUnit=put("inventory_units",{name:"Mulan over-cap addition",quantityOwned:2}),capListing=put("listings",{title:"Mulan over-cap light",active:true,pricing:{daily:25},depositAmount:2000,components:[{inventoryUnitId:capUnit._id,qty:1}]});
  const mulanBooking=put("bookings",{accountId:mulanAccount._id,guestEmail:mulanAccount.email,status:"confirmed",securityPolicyVersion:SETUP_INTENT_SECURITY_POLICY_VERSION,subtotal:50,total:50,depositAmount:0,depositHoldAmount:0,stripePaymentIntentId:"pi_mulan_original",stripeCheckoutSessionId:"cs_mulan_original",verificationProvider:"didit",idVerificationSource:"didit",idVerifyStatus:"verified",agreementName:mulanAccount.name,billingAddress:mulanAccount.address,verificationChecks:{identity:"approved",selfie:"approved",address:"approved"},idVerifiedAt:verifiedAt,verificationExpiresAt:passExpiresAt,diditSessionId:"didit-mulan-original",renterPersonKey:mulanAccount.renterPersonKey,lineItems:[{listingId:baseListing._id,title:baseListing.title,qty:1,start:mulanStart,end:mulanEnd,lineTotal:50}]});
  mulanAccount.rentalVerification={sourceBookingId:mulanBooking._id,name:"mulan example",address:"25 whitcomb street wc2h 7er",verifiedAt,expiresAt:passExpiresAt};
  const passBefore={...mulanAccount.rentalVerification},bookingCountBefore=(tables.get("bookings")??[]).length;
  const mulanArgs={token,bookingId:mulanBooking._id,requestId:`mulan-addition-${mulanBooking._id}`,listingId:addonListing._id,qty:1,reason:"Attach overlapping paid kit item",start:mulanStart,end:mulanEnd};
  const mulanPreview=await state.preview.handler(ctx,mulanArgs);assert.equal(mulanPreview.ok,true,"a compatible addition can be quoted against the existing verified rental");
  const mulanPrepared=await state.prepare.handler(ctx,{...mulanArgs,expectedSnapshot:mulanPreview.snapshot,expectedQuote:mulanPreview.quoteSnapshot});
  await state.markPaid.handler(ctx,{id:mulanPrepared._id,paymentIntentId:"pi_mulan_addition",amountPence:Math.round((mulanPrepared.lineTotal+mulanPrepared.securityCharge)*100)});
  await state.apply.handler(ctx,{id:mulanPrepared._id});await state.apply.handler(ctx,{id:mulanPrepared._id});
  assert.equal(mulanPrepared.bookingId,mulanBooking._id,"the added line stays attached to the original rental");
  assert.equal(mulanBooking.lineItems.length,2,"replaying paid addition attaches the item once");
  assert.equal(mulanBooking.diditSessionId,"didit-mulan-original");assert.equal(mulanBooking.idVerifyStatus,"verified");assert.equal(mulanBooking.verificationExpiresAt,passExpiresAt,"adding kit preserves the original 90-day verification pass");
  assert.deepEqual(mulanAccount.rentalVerification,passBefore,"an item addition cannot restart the account's 90-day verification window");
  assert.equal((tables.get("bookings")??[]).length,bookingCountBefore,"a paid overlapping addition does not create a duplicate rental or Didit workflow");
  const mulanSources=await load("convex/lib/rentalPaymentSources.ts").rentalPaymentSources(ctx,mulanBooking);
  assert.deepEqual(mulanSources.map(source=>source.paymentIntentId),["pi_mulan_original","pi_mulan_addition"],"the item addition remains a separate card payment source");
  const capArgs={...mulanArgs,requestId:`mulan-over-cap-${mulanBooking._id}`,listingId:capListing._id};
  const capPreview=await state.preview.handler(ctx,capArgs);assert.equal(capPreview.ok,false);assert.match(capPreview.reason,/£12,000/,"the original rental plus its overlapping addition still obeys the inclusive per-person cap");
  await assert.rejects(state.prepare.handler(ctx,capArgs),/£12,000/);
  console.log(
    "PASS actual addition handlers: owner-only; saved retries; payment/hold prerequisites; one attachment; promoted hold ledger; draft stock exactly once; separate payment sources; original-payment race preserves history; 90-day verification reuse; inclusive £12k overlapping-addition cap; missing stock rejected; split refund webhooks monotonic.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
