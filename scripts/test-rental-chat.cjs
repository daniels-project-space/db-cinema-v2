const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
const scheduled = [];
const ctx = {
  db,
  scheduler: {
    runAfter: async (_, ref, args) => scheduled.push({ ref, args }),
  },
};
const a = put("accounts", { _id: "account-a", email: "a@rental-test.invalid" }),
  other = put("accounts", { _id: "account-b", email: "b@rental-test.invalid" });
put("sessions", {
  token: "valid",
  accountId: a._id,
  expiresAt: Date.now() + 600000,
});
put("sessions", {
  token: "expired",
  accountId: a._id,
  expiresAt: Date.now() - 1,
});
put("sessions", {
  token: "foreign",
  accountId: other._id,
  expiresAt: Date.now() + 600000,
});
const item = put("listings", {
  title: "Camera",
  reviewedImageUrls: ["https://images.example.test/camera-reviewed.jpg"],
  r2Images: ["https://images.example.test/camera-r2.jpg"],
  sourceImages: ["https://images.example.test/camera-source.jpg"],
  rentalContents: {
    included: ["Camera body"],
    optional: [],
    excluded: [],
    notes: [],
    status: "documented",
    sources: [],
  },
});
const booking = put("bookings", {
  guestEmail: a.email,
  status: "pending_payment",
  fulfilment: "delivery",
  deliveryLegs: "one_way",
  subtotal: 100,
  discount: 0,
  deliveryFee: 30,
  creditApplied: 10,
  membershipCreditApplied: 5,
  total: 120,
  depositAmount: 20,
  agreementDocs: [{kind:"cancellation",version:"2026-11-v26"}],
  lineItems: [
    {
      listingId: item._id,
      title: "Camera",
      start: Date.now() + 86400000,
      end: Date.now() + 86400000,
      qty: 1,
      lineTotal: 100,
    },
  ],
});
const second = put("bookings", {
  ...booking,
  _id: "second-rental",
  status: "returned",
});
const helper = load("convex/lib/rentalChat.ts"),
  chat = load("convex/chat.ts"),
  rental = load("convex/rentalChat.ts");
const { TRAFALGAR_PICKUP_ADDRESS, TRAFALGAR_PICKUP_AREA, TRAFALGAR_PICKUP_INSTRUCTIONS } = load("shared/pickupLocation.ts");
process.env.ADMIN_TOKEN = "fixture-owner-only";
(async () => {
  await db.patch(a._id, { phone: "+44 20 1234 5678" });
  await db.patch(booking._id, { guestPhone: "+44 7700 900123" });
  const ownerThread = await rental.messages.handler(ctx, { token: "fixture-owner-only", admin: true, bookingId: booking._id, paginationOpts: { numItems: 10, cursor: null } });
  assert.equal(ownerThread.renter.phone, "+44 7700 900123", "the booking phone is visible to the owner");
  const renterThread = await rental.messages.handler(ctx, { token: "valid", bookingId: booking._id, paginationOpts: { numItems: 10, cursor: null } });
  assert.equal(renterThread.renter.phone, null, "the owner-only contact is never sent to renter clients");
  assert.equal(renterThread.caseArchivedAt, null, "the renter chat never receives the admin case-archive marker");
  const archivedAt=Date.now()-1000;put("chat_threads",{accountId:a._id,bookingId:booking._id,escalated:false,updatedAt:archivedAt,caseArchivedAt:archivedAt});
  const archivedOwner=await rental.messages.handler(ctx,{token:"fixture-owner-only",admin:true,bookingId:booking._id,paginationOpts:{numItems:10,cursor:null}});
  const archivedRenter=await rental.messages.handler(ctx,{token:"valid",bookingId:booking._id,paginationOpts:{numItems:10,cursor:null}});
  assert.equal(archivedOwner.caseArchivedAt,archivedAt,"Admins can see the permanent archive marker on the rental chat");
  assert.equal(archivedRenter.caseArchivedAt,null,"The archive marker is not exposed to renters");
  const renterBooking = await rental.getConversation.handler(ctx, { token: "valid", bookingId: booking._id });
  assert.deepEqual(renterBooking.items[0].imageSources, [
    "https://images.example.test/camera-reviewed.jpg",
    "https://images.example.test/camera-r2.jpg",
  ], "each rental chat item uses its exact listing's approved photo and catalog fallback");
  assert.equal(renterBooking.items[0].heroImage, "https://images.example.test/camera-reviewed.jpg");
  const contactBooking = put("bookings", {
    accountId: a._id,
    guestEmail: a.email,
    status: "pending_verification",
    fulfilment: "pickup",
    lineItems: [{ listingId: item._id, title: "Camera", start: Date.now() + 86400000, end: Date.now() + 172800000, qty: 1 }],
  });
  const pendingVerificationPage = await rental.adminPage.handler(ctx, {
    token: "fixture-owner-only",
    stage: "pending_verification",
    paginationOpts: { numItems: 10, cursor: null },
  });
  assert(pendingVerificationPage.page.some((rental) => rental._id === contactBooking._id), "the admin verification-pending filter returns paid rentals awaiting Didit instead of rejecting the visible stage");
  const pendingCard = pendingVerificationPage.page.find((rental) => rental._id === contactBooking._id);
  assert.equal(pendingCard.items[0].heroImage, "https://images.example.test/camera-reviewed.jpg", "the restored pending row carries the actual listing photo");
  assert.deepEqual(pendingCard.items[0].imageSources, [
    "https://images.example.test/camera-reviewed.jpg",
    "https://images.example.test/camera-r2.jpg",
  ], "pending verification cards retain approved photo and exact-listing fallback images");
  put("messages", {
    accountId: a._id,
    bookingId: contactBooking._id,
    sender: "owner",
    text: `Pickup address: ${TRAFALGAR_PICKUP_ADDRESS}\n${TRAFALGAR_PICKUP_INSTRUCTIONS}\nhttps://www.google.com/maps/search/The+Grand+Building`,
    at: Date.now(),
  });
  assert.equal((await rental.getConversation.handler(ctx, { token: "valid", bookingId: contactBooking._id })).handoverDetails, null, "pickup address and support contact stay hidden before payment, verification, and confirmation");
  const preGateGafferContext = await chat._gafferContext.handler(ctx, { accountId: a._id, focusBookingId: contactBooking._id });
  assert.equal(preGateGafferContext.pickupArea, TRAFALGAR_PICKUP_AREA, "Gaffer can share the public Trafalgar Square area before the booking passes its gates");
  assert.equal(preGateGafferContext.location, null);
  assert.doesNotMatch(JSON.stringify(preGateGafferContext.messages), /The Grand Building|Waterstones|WC2N\s*5EJ|google\.com\/maps\/search/i, "historical owner chat with exact pickup details is scrubbed before reaching Gaffer");
  await db.patch(contactBooking._id, { status: "confirmed", paidConfirmedAt: Date.now() });
  assert.equal((await rental.getConversation.handler(ctx, { token: "valid", bookingId: contactBooking._id })).handoverDetails, null, "payment and confirmation alone do not disclose handover details before verification");
  await db.patch(contactBooking._id, {
    status: "pending_verification",
    idVerifyStatus: "verified",
    idVerificationSource: "didit",
    verificationProvider: "didit",
    idVerifiedAt: Date.now(),
    verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
  });
  assert.equal((await rental.getConversation.handler(ctx, { token: "valid", bookingId: contactBooking._id })).handoverDetails, null, "a fully passed Didit result still does not disclose handover details while booking remains unconfirmed");
  await db.patch(contactBooking._id, { status: "confirmed" });
  const confirmedHandover = (await rental.getConversation.handler(ctx, { token: "valid", bookingId: contactBooking._id })).handoverDetails;
  assert.match(confirmedHandover.pickupAddress, /Trafalgar Square/);
  assert.equal(confirmedHandover.returnAddress, confirmedHandover.pickupAddress);
  assert.match(confirmedHandover.phone, /^\+44/);
  assert.match(confirmedHandover.pickupInstructions, /Waterstones bookstore/);
  await db.patch(contactBooking._id, { paidConfirmedAt: undefined });
  assert.equal((await rental.getConversation.handler(ctx, { token: "valid", bookingId: contactBooking._id })).handoverDetails, null, "the renter contact card closes if the paid-confirmation gate is absent");
  await db.patch(contactBooking._id, { paidConfirmedAt: Date.now(), status: "returned" });
  assert.equal((await rental.getConversation.handler(ctx, { token: "valid", bookingId: contactBooking._id })).handoverDetails, null, "handover details are not newly exposed after the rental is returned");
  const generalThread = await rental.messages.handler(ctx, { token: "fixture-owner-only", admin: true, accountId: a._id, paginationOpts: { numItems: 10, cursor: null } });
  assert.equal(generalThread.renter.phone, "+44 20 1234 5678", "general conversations use the account phone");
  assert.equal(await rental.messages.handler(ctx, { token: "invalid", admin: true, bookingId: booking._id, paginationOpts: { numItems: 10, cursor: null } }), null);
  assert.equal(await rental.messages.handler(ctx, { token: "valid", admin: true, accountId: other._id, paginationOpts: { numItems: 10, cursor: null } }), null, "a renter cannot request the admin view of another account");
  await assert.rejects(rental.setHandler.handler(ctx, { token: "valid", accountId: other._id, gaffer: false }), /unauthorized/, "a renter cannot take over another customer's conversation");
  await assert.rejects(rental.sendOwner.handler(ctx, { token: "valid", accountId: other._id, text: "Forged team reply" }), /unauthorized/, "a renter cannot send an owner message");
  assert.equal(await helper.accountForToken(ctx, "expired"), null);
  await assert.rejects(
    chat.send.handler(ctx, {
      token: "expired",
      bookingId: booking._id,
      text: "Denied",
    }),
    /unauthorized/,
  );
  await assert.rejects(
    chat.send.handler(ctx, {
      token: "foreign",
      bookingId: booking._id,
      text: "Denied",
    }),
    /not available/,
  );
  await chat.send.handler(ctx, {
    token: "valid",
    bookingId: booking._id,
    text: "What is included?",
    requestId: "chat-request-0001",
  });
  const first = tables.get("messages").find(message => message.clientRequestId === "chat-request-0001");
  assert.equal(first.clientRequestId, "chat-request-0001");
  const scheduledAfterFirstSend = scheduled.length;
  const duplicate = await chat.send.handler(ctx, {
    token: "valid",
    bookingId: booking._id,
    text: "What is included?",
    requestId: "chat-request-0001",
  });
  assert.deepEqual(duplicate, { messageId: first._id, duplicate: true }, "an ambiguous retry returns the original message");
  assert.equal(tables.get("messages").filter(message => message.clientRequestId === "chat-request-0001").length, 1, "an ambiguous retry cannot create a duplicate renter message");
  assert.equal(scheduled.length, scheduledAfterFirstSend, "an idempotent retry does not queue Gaffer twice");
  await assert.rejects(chat.send.handler(ctx, {
    token: "valid",
    bookingId: booking._id,
    text: "Different text",
    requestId: "chat-request-0001",
  }), /no longer matches/, "an idempotency key cannot be reused for changed content");
  await assert.rejects(chat.send.handler(ctx, {
    token: "valid",
    bookingId: second._id,
    text: "What is included?",
    requestId: "chat-request-0001",
  }), /no longer matches/, "an idempotency key cannot be replayed into another rental");
  assert.equal(scheduled[0].args.bookingId, booking._id);
  await helper.postRentalMessage(ctx, {
    accountId: a._id,
    bookingId: second._id,
    sender: "renter",
    text: "Another rental question",
  });
  put("messages", {
    accountId: other._id,
    bookingId: booking._id,
    sender: "renter",
    text: "Legacy forged foreign message",
    at: Date.now(),
    readByOwner: false,
  });
  const cx = await chat._gafferContext.handler(ctx, {
    accountId: a._id,
    focusBookingId: booking._id,
  });
  const creditExpiry=Date.now()+365*86400000;
  put('credits',{accountId:a._id,amount:10,remaining:10,kind:'earned',status:'active',createdAt:Date.now(),expiresAt:creditExpiry});
  put('credits',{accountId:other._id,amount:900,remaining:900,kind:'earned',status:'active',createdAt:Date.now(),expiresAt:creditExpiry});
  put('credits',{accountId:a._id,amount:300,remaining:300,kind:'earned',status:'active',createdAt:Date.now()-10000,expiresAt:Date.now()-1});
  await db.patch(booking._id,{guestAddress:'PRIVATE_ADDRESS_MARKER',stripePaymentMethodId:'PRIVATE_CARD_MARKER'});
  const offer=put('operator_cancellation_offers',{state:'offered',choice:undefined,decisionAfter:Date.now()+3600000,choiceDeadline:Date.now()+7*86400000,cashRemainingPence:12000,securityRemainingPence:2000,spentCreditPence:0,proof:'PRIVATE_PROOF_MARKER'});
  await db.patch(booking._id,{cancellationDecision:{operatorOfferId:offer._id}});
  const facts=await chat._gafferContext.handler(ctx,{accountId:a._id,focusBookingId:booking._id});
  assert.equal(facts.accountCredit.available,5,'owned, unexpired credit excludes the five pounds reserved by this pending checkout');
  assert.equal(facts.booking.verification.status,'required');
  assert.equal(facts.booking.items[0].listedRentalLineAmount,100,'rental-chat Gaffer receives the saved line price for the account-owned item');
  assert.deepEqual(facts.booking.rentalPrice,{listedSubtotal:100,discount:0,deliveryFee:30,creditApplied:10,membershipCreditApplied:5,checkoutTotalAfterCredit:120,includesDeliveryFee:true},'the rental-chat context supplies its recorded price and credits without mixing in security');
  assert.equal((await chat._gafferVerificationAccess.handler(ctx,{accountId:a._id,bookingId:booking._id}))._id,booking._id);
  await assert.rejects(chat._gafferVerificationAccess.handler(ctx,{accountId:other._id,bookingId:booking._id}),/not found|unauthorized|rental/i);
  assert.equal(facts.accountCredit.expiresAt,creditExpiry);
  assert.equal(facts.accountCredit.securityAndMembershipExcluded,true);
  assert.match(facts.accountCredit.selection,/not automatically spent/);
  assert.equal(facts.booking.operatorCancellation.creditPence,13000);
  assert.equal(facts.booking.operatorCancellation.cashRefundPence,12000);
  assert.equal(facts.booking.operatorCancellation.depositRefundPence,2000);
  await db.patch(a._id,{restrictionRevision:1,lastRestrictedAt:Date.now()});
  const restrictedCancellationFacts=await chat._gafferContext.handler(ctx,{accountId:a._id,focusBookingId:booking._id});
  assert.equal(restrictedCancellationFacts.booking.operatorCancellation.creditPence,null,'Gaffer does not suggest 130% cancellation credit to an account with a restriction history');
  assert.equal(restrictedCancellationFacts.booking.operatorCancellation.cashRefundPence,12000,'Restriction removes the bonus-credit option without hiding the original-payment refund');
  await db.patch(a._id,{restrictionRevision:undefined,lastRestrictedAt:undefined});
  for(const secret of ['PRIVATE_ADDRESS_MARKER','PRIVATE_CARD_MARKER','PRIVATE_PROOF_MARKER'])assert.ok(!JSON.stringify(facts).includes(secret),'Gaffer context excludes '+secret);
  assert.equal(facts.checkoutUi.cancellationProtectionEnabled,process.env.CANCELLATION_PROTECTION_POLICY_ENABLED==='true');
  await db.patch(booking._id,{cancellationDecision:undefined});
  assert.equal(cx.booking.stage, "pending_payment");
  assert.match(cx.booking.status, /payment has not yet been confirmed/i);
  assert.equal(cx.booking.payment.securityAmountOnBooking, 20);
  assert.equal(cx.booking.cancellation.termsVersion,"2026-11-v26");
  assert.match(cx.booking.cancellation.termsText,/48 hours or less before the scheduled pickup time gives no rental refund and no account credit/i);
  assert.match(cx.booking.cancellation.timingBasis,/48 hours or less before scheduled pickup/i);
  assert.equal(cx.booking.payment.securityPaid, undefined);
  assert.equal(cx.location, null, "unpaid rental cannot disclose pickup location");
  put("settings", { businessAddress: "Verified collection depot" });
  await db.patch(booking._id, { status: "confirmed", fulfilment: "pickup" });
  const confirmedContext = await chat._gafferContext.handler(ctx, { accountId: a._id, focusBookingId: booking._id });
  assert.equal(confirmedContext.pickupArea, TRAFALGAR_PICKUP_AREA);
  assert.equal(confirmedContext.location, null, "a paid but unverified renter cannot receive the pickup location");
  assert.match(confirmedContext.booking.status, /payment recorded.*verification is not yet approved/i);
  assert.equal(confirmedContext.booking.payment.securityAmountOnBooking, 20);
  assert.equal(confirmedContext.booking.payment.securityPaid, undefined, "booking status does not prove security was charged");
  assert.equal(confirmedContext.accountRentals[0].securityPaid, undefined, "account summaries must not infer a paid deposit");
  await db.patch(booking._id, { idVerifyStatus: "verified", idVerificationSource: "didit", verificationProvider: "didit", idVerifiedAt: Date.now(), verificationChecks: { identity: "approved", selfie: "approved", address: "approved" } });
  const unpaidVerifiedContext = await chat._gafferContext.handler(ctx, { accountId: a._id, focusBookingId: booking._id });
  assert.equal(unpaidVerifiedContext.location, null, "confirmed verification without recorded payment cannot disclose pickup location");
  await db.patch(booking._id, { paidConfirmedAt: Date.now() });
  const verifiedContext = await chat._gafferContext.handler(ctx, { accountId: a._id, focusBookingId: booking._id });
  assert.equal(verifiedContext.location, "Verified collection depot");
  assert.equal(verifiedContext.booking.status, "confirmed");
  await db.patch(booking._id,{agreementSnapshot:JSON.stringify({format:1,version:"2026-11-v26",acceptedAt:1,signer:"Test Renter",documents:[{kind:"cancellation",version:"2026-11-v26",text:{title:"Cancellation terms",updated:"November 2026",sections:[{h:"Cancellation and refunds",p:"Exact cancellation wording saved with this signed rental."},{h:"Free cancellation protection",p:"This separate company-cancellation wording must not be substituted."}]}}],particulars:{timeZone:"Europe/London",lineItems:[]}})});
  const snapshotContext=await chat._gafferContext.handler(ctx,{accountId:a._id,focusBookingId:booking._id});
  assert.equal(snapshotContext.booking.cancellation.termsText,"Exact cancellation wording saved with this signed rental.","the accepted snapshot text takes precedence over the later archived copy");
  await db.patch(booking._id, { idVerifiedAt: Date.now() - 91 * 86400000, verificationExpiresAt: Date.now() - 1 });
  const expiredContext = await chat._gafferContext.handler(ctx, { accountId: a._id, focusBookingId: booking._id });
  assert.equal(expiredContext.booking.status, "confirmed", "90-day badge expiry does not revoke an already-confirmed rental");
  assert.equal(expiredContext.location, "Verified collection depot", "the confirmed rental keeps its approved handover details after the account badge expires");
  await db.patch(booking._id, { verificationExpiresAt: undefined, status: "cancelled" });
  assert.equal((await chat._gafferContext.handler(ctx, { accountId: a._id, focusBookingId: booking._id })).booking.payment.securityPaid, undefined);
  await db.patch(booking._id, { idVerifyStatus: "required" });
  await db.patch(booking._id, { status: "pending_payment" });
  assert.equal(cx.messages.length, 1);
  assert.equal(cx.messages[0].text, "What is included?");
  assert.equal(
    await chat._postBot.handler(ctx, {
      accountId: a._id,
      bookingId: booking._id,
      replyTo: first._id,
      text: "Rental-specific answer",
    }),
    true,
  );
  assert.equal(
    await chat._postBot.handler(ctx, {
      accountId: a._id,
      bookingId: booking._id,
      replyTo: first._id,
      text: "Duplicate answer",
    }),
    false,
  );
  const bot = tables.get("messages").find((m) => m.sender === "bot");
  assert.equal(bot.bookingId, booking._id);
  const guardedBooking = put("bookings", {
    accountId: a._id, guestEmail: a.email, status: "pending_verification", fulfilment: "delivery",
    address: "Private QA drop-off address", lineItems: [],
  });
  const firstDisclosureQuestion = await helper.postRentalMessage(ctx, {
    accountId: a._id, bookingId: guardedBooking._id, sender: "renter", text: "Where do I meet you?",
  });
  await chat._postBot.handler(ctx, {
    accountId: a._id, bookingId: guardedBooking._id, replyTo: firstDisclosureQuestion, generation: 0,
    text: "Call Leo at 07933 019849. Meet at The Grand Building, Trafalgar Square, WC2N 5EJ; delivery is to Private QA drop-off address.",
    meta: { pickupMapUrl: "https://www.google.com/maps/search/The+Grand+Building", note: "Leo +44 7933 019849" },
  });
  const guardedBotReply = tables.get("messages").find((message) => message.bookingId === guardedBooking._id && message.sender === "bot");
  assert.doesNotMatch(JSON.stringify(guardedBotReply), /07933|Grand Building|WC2N|google\.com\/maps|Private QA drop-off address/i,
    "the authoritative Gaffer message write redacts address/contact details from both prose and metadata before all gates pass");
  await db.patch(guardedBooking._id, {
    status: "confirmed", paidConfirmedAt: Date.now(), idVerifyStatus: "verified", verificationProvider: "didit",
    idVerificationSource: "didit", idVerifiedAt: Date.now(),
    verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
  });
  const approvedDisclosureQuestion = await helper.postRentalMessage(ctx, {
    accountId: a._id, bookingId: guardedBooking._id, sender: "renter", text: "Now where is pickup?",
  });
  await chat._postBot.handler(ctx, {
    accountId: a._id, bookingId: guardedBooking._id, replyTo: approvedDisclosureQuestion, generation: 0,
    text: "Call Leo at +44 7933 019849. Meet at The Grand Building, Trafalgar Square, WC2N 5EJ.",
  });
  const approvedBotReply = tables.get("messages").find((message) => message.bookingId === guardedBooking._id && message.sender === "bot" && message.text.includes("+44"));
  assert.ok(approvedBotReply, "a paid, fully Didit-approved and confirmed rental can disclose exact contact and pickup details");
  await rental.markRead.handler(ctx, {
    token: "valid",
    bookingId: booking._id,
    through: bot._id,
  });
  assert.equal(
    (await helper.rentalThread(ctx, a._id, booking._id)).unreadRenter,
    0,
  );
  await rental.sendOwner.handler(ctx, {
    token: process.env.ADMIN_TOKEN,
    bookingId: booking._id,
    text: "I will help with this order.",
  });
  await rental.markRead.handler(ctx, {
    token: "valid",
    bookingId: booking._id,
    through: bot._id,
  });
  assert.equal(
    (await helper.rentalThread(ctx, a._id, booking._id)).unreadRenter,
    1,
  );
  assert.equal(
    await chat._postBot.handler(ctx, {
      accountId: a._id,
      bookingId: booking._id,
      replyTo: first._id,
      text: "After handoff",
    }),
    false,
  );
  assert.equal(
    (await helper.rentalThread(ctx, a._id, second._id)).escalated,
    false,
  );
  await assert.rejects(
    rental.markRead.handler(ctx, {
      token: "valid",
      bookingId: booking._id,
      through: tables.get("messages").find((m) => m.bookingId === second._id)
        ._id,
    }),
    /Invalid read/,
  );
  const migratedBooking = put("bookings", { ...booking, _id: "legacy-rental" });
  const legacy = put("messages", {
    accountId: a._id,
    bookingId: migratedBooking._id,
    sender: "renter",
    text: "Legacy unread",
    at: 1,
    readByOwner: false,
  });
  await rental.migrateLegacyUnread.handler(ctx, { cursor: null });
  const migrated = await helper.rentalThread(ctx, a._id, migratedBooking._id);
  assert.equal(migrated.unreadOwner, 1);
  await rental.migrateLegacyUnread.handler(ctx, { cursor: null });
  assert.equal(migrated.unreadOwner, 1, "migration does not double count");
  assert.equal(legacy.threadCounted, true);
  const scopedIndexes=[];
  const scopedCtx={...ctx,db:{...db,query(table){const query=db.query(table);if(table==='messages'){const withIndex=query.withIndex.bind(query);query.withIndex=(name,fn)=>{scopedIndexes.push(name);return withIndex(name,fn);};}return query;}}};
  const generalMessage=await helper.postRentalMessage(ctx,{accountId:a._id,sender:'renter',text:'Private support message'});
  for(let index=0;index<55;index++)put('messages',{accountId:other._id,sender:'renter',text:'Another account message',at:Date.now()+index});
  const ownGeneral=await rental.messages.handler(scopedCtx,{token:'valid',paginationOpts:{numItems:10,cursor:null}});
  assert(ownGeneral.page.some(message=>message.text==='Private support message'));assert(ownGeneral.page.every(message=>message.accountId===a._id));assert.equal(scopedIndexes.at(-1),'by_booking_account_at','General chat reads only the current account index');
  const forgedGeneral=await rental.messages.handler(scopedCtx,{token:'valid',accountId:other._id,paginationOpts:{numItems:10,cursor:null}});
  assert(forgedGeneral.page.every(message=>message.accountId===a._id),'A supplied account ID cannot select another customer in renter mode');
  assert.equal(forgedGeneral.replyState,null,'Owner reply insights are not returned in renter mode');
  assert.deepEqual(forgedGeneral.quickReplies,[],'Owner quick replies are not returned in renter mode');
  await assert.rejects(rental.messages.handler(scopedCtx,{token:'foreign',bookingId:booking._id,paginationOpts:{numItems:10,cursor:null}}),/not available/,'A different renter cannot read this booking conversation');
  await rental.markRead.handler(scopedCtx,{token:'valid',through:generalMessage});assert.equal(scopedIndexes.at(-1),'by_booking_account_at','Read markers count only the current conversation index');
  const tieAccount=put('accounts',{email:'tie@example.invalid'});put('sessions',{token:'tie-token',accountId:tieAccount._id,expiresAt:Date.now()+600000});
  const tieThread=put('chat_threads',{accountId:tieAccount._id,escalated:false,unreadOwner:2,unreadRenter:2,updatedAt:100});
  const olderRenter=put('messages',{accountId:tieAccount._id,sender:'renter',text:'Older',at:100}),newerRenter=put('messages',{accountId:tieAccount._id,sender:'renter',text:'Newer',at:100});
  await rental.markRead.handler(ctx,{token:'fixture-owner-only',admin:true,accountId:tieAccount._id,through:newerRenter._id});
  await rental.markRead.handler(ctx,{token:'fixture-owner-only',admin:true,accountId:tieAccount._id,through:olderRenter._id});
  assert.equal(tieThread.unreadOwner,0,'An older same-time admin marker cannot resurrect unread messages');
  const olderOwner=put('messages',{accountId:tieAccount._id,sender:'owner',text:'Older',at:101}),newerOwner=put('messages',{accountId:tieAccount._id,sender:'owner',text:'Newer',at:101});
  await rental.markRead.handler(ctx,{token:'tie-token',through:newerOwner._id});
  await rental.markRead.handler(ctx,{token:'tie-token',through:olderOwner._id});
  assert.equal(tieThread.unreadRenter,0,'An older same-time renter marker cannot resurrect unread messages');
  const generalContext=await chat._gafferContext.handler(scopedCtx,{accountId:a._id});assert(generalContext.messages.some(message=>message.text==='Private support message'));assert(generalContext.messages.every(message=>message.text!=='Another account message'));assert.equal(scopedIndexes.at(-1),'by_booking_account_at','Gaffer reads only the current conversation index');
  assert.equal(await chat._postBot.handler(scopedCtx,{accountId:a._id,replyTo:generalMessage,text:'I can help.'}),true);assert.equal(scopedIndexes.at(-1),'by_booking_account_at','Reply deduplication uses the same scoped history');
  console.log(
    "PASS rental chat handlers: expired/foreign sessions; legacy forged rows excluded; exact rental context; duplicate replies rejected; human handoff isolated; newer arrivals stay unread; invalid read markers rejected.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
