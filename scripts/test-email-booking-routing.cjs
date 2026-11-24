const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { db, docs, load, put, setMock } = require("./lib/rentalTestHarness.cjs");

const mirrored = [];
setMock("./adminAuth", { assertAdmin: async () => {}, checkAdminToken: () => true });
setMock("./lib/rentalChat", {
  postRentalMessage: async (_ctx, message) => {
    const row = put("messages", { ...message, at: Date.now(), readByOwner: message.sender !== "renter", threadCounted: true });
    mirrored.push(row);
    return row._id;
  },
  accountForToken: async (_ctx, token) => [...docs.values()].find(row => row._id === token) ?? null,
  rentalThread: async (ctx, accountId, bookingId) => ctx.db.query("chat_threads")
    .withIndex("by_account_booking", q => q.eq("accountId", accountId).eq("bookingId", bookingId))
    .first(),
});
process.env.INBOUND_EMAIL_SECRET = "fixture-inbound-secret";

const inbox = load("convex/emailInbox.ts");
const { LEO_SUPPORT_PHONE, TRAFALGAR_PICKUP_ADDRESS } = load("shared/pickupLocation.ts");
function emailInput(from, providerId, extra = {}) {
  return {
    secret: "fixture-inbound-secret",
    providerId,
    references: [],
    from,
    to: "rentals@dbcinemarentals.com",
    subject: `Rental enquiry ${providerId}`,
    text: "Could you help with my rental?",
    ...extra,
  };
}
function rentalRef(booking) {
  return `DBC-${String(booking._id).slice(-8).toUpperCase()}`;
}
function putBooking(account, suffix, at) {
  return put("bookings", { _id: `bookings-${suffix}`, accountId: account._id, guestEmail: account.email, at, status: "confirmed", lineItems: [{ listingId: "listings-camera", start: at, end: at + 1, qty: 1 }] });
}
function storedThread(email, subject, extra = {}) {
  return put("email_threads", {
    email,
    subject,
    status: "open",
    createdAt: 100,
    updatedAt: 100,
    lastAt: 100,
    lastDirection: "in",
    lastText: "Historic email",
    unreadOwner: 0,
    ...extra,
  });
}

(async () => {
  const newLeadEmail = "new-renter@example.com";
  const initialLead = await inbox.ingest.handler({ db }, emailInput(newLeadEmail, "booking-mail-lead-before-signup", {
    name: "New renter",
    subject: "Can I rent a camera?",
    text: "I am interested in renting a camera.",
  }));
  assert.equal(initialLead.accountId, null, "a plain email creates a contact thread, not a credential-less renter login");
  assert.equal([...docs.values()].some(row => row._id.startsWith("accounts-") && row.email === newLeadEmail), false);
  const leadThread = docs.get(initialLead.threadId);
  assert.equal(leadThread.name, "New renter");
  assert.equal(leadThread.accountId, undefined);

  const leadBooking = put("bookings", {
    _id: "bookings-LEAD0001",
    guestEmail: newLeadEmail,
    status: "confirmed",
    lineItems: [{ listingId: "listings-lead", start: 10, end: 20, qty: 1 }],
  });
  const newLeadAccount = put("accounts", { email: newLeadEmail, emailVerifiedAt: 9, name: "New renter" });
  const accountLinkJobs = [];
  const accountLinkScheduler = { runAfter: async (_delay, refName, args) => accountLinkJobs.push({ refName: String(refName), args }) };
  await inbox.claimForAccount.handler({ db, scheduler: accountLinkScheduler }, { token: newLeadAccount._id });
  for (const job of accountLinkJobs.splice(0)) {
    if (job.refName.endsWith("linkVerifiedHistory")) await inbox.linkVerifiedHistory.handler({ db, scheduler: accountLinkScheduler }, job.args);
    for (const copyJob of accountLinkJobs.splice(0)) {
      if (copyJob.refName.endsWith("copyVerifiedHistory")) await inbox.copyVerifiedHistory.handler({ db, scheduler: accountLinkScheduler }, copyJob.args);
    }
  }
  assert.equal(leadThread.accountId, newLeadAccount._id, "verified signup safely claims the pre-account email thread");
  const leadInbound = docs.get(initialLead.inboundId);
  const leadHistoryCopy = docs.get(leadInbound.profileMessageId);
  assert.equal(leadHistoryCopy.accountId, newLeadAccount._id, "lead email history is copied into the new renter profile");
  assert.equal(leadHistoryCopy.bookingId, undefined, "pre-booking general email history keeps its original support attribution");
  assert.equal(leadBooking.guestEmail, newLeadEmail, "the guest booking remains joinable through the exact verified email address");
  const leadBookingEmail = await inbox.ingest.handler({ db }, emailInput(newLeadEmail, "booking-mail-lead-after-booking", {
    subject: "Question about my rental",
    text: "Can you help with my upcoming rental?",
  }));
  assert.equal(leadBookingEmail.accountId, null, "an existing account email alone does not prove control of the mailbox");
  assert.equal(leadBookingEmail.bookingId, null, "an unsigned sender cannot resolve private rental details from an active booking");
  assert.equal(docs.get(leadBookingEmail.inboundId).profileMessageId, undefined, "unproven email stays out of the renter account chat");

  const account = put("accounts", { email: "booking-owner@example.com", emailVerifiedAt: 10, name: "Booking owner" });
  const booking = putBooking(account, "F58HCFWE", 20);
  const verifiedAt = Date.now() - 1_000;
  const acceptedCancellationText = "The signed rental cancellation terms for this synthetic booking.";
  Object.assign(booking, {
    paidConfirmedAt: Date.now() - 500,
    idVerifyStatus: "verified",
    verificationProvider: "didit",
    idVerificationSource: "didit",
    idVerifiedAt: verifiedAt,
    verificationExpiresAt: verifiedAt + 90 * 86_400_000,
    verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
    agreementDocs: [{ kind: "cancellation", version: "2026-11-v26" }],
    agreementSnapshot: JSON.stringify({
      format: 1,
      version: "2026-11-v26",
      acceptedAt: verifiedAt,
      signer: "Booking owner",
      documents: [{ kind: "cancellation", version: "2026-11-v26", text: { title: "Cancellation", updated: "November 2026", sections: [{ h: "Your cancellation", p: acceptedCancellationText }] } }],
      particulars: { timeZone: "Europe/London", lineItems: [] },
    }),
    fulfilment: "pickup",
    pickupTime: "10:00",
    returnTime: "18:00",
    lineItems: [{ listingId: "listings-camera", title: "Synthetic cinema camera", start: Date.now() + 86_400_000, end: Date.now() + 2 * 86_400_000, qty: 1, lineTotal: 100, returnTime: "18:00" }],
  });
  const ref = rentalRef(booking);
  const capabilityKey = "abcdef0123456789abcdef01";
  const privateThread = storedThread(account.email, "Renter email thread", {
    accountId: account._id,
    bookingId: booking._id,
    verifiedRenterEmail: account.email,
    replyKey: capabilityKey,
  });
  const historicalHandoverEmail = put("email_messages", {
    threadId: privateThread._id,
    bookingId: booking._id,
    direction: "out",
    sender: "dbcinemarentals@gmail.com",
    recipient: account.email,
    subject: privateThread.subject,
    text: `Pickup address: ${TRAFALGAR_PICKUP_ADDRESS}\nCall Leo: ${LEO_SUPPORT_PHONE}\nhttps://www.google.com/maps/search/The+Grand+Building`,
    at: 1,
    providerId: "out:email-owner:handover-details:historic",
    state: "sent",
  });

  const forgedFrom = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-forged-from", {
    inReplyTo: "<forged-rfc-reference@example.com>",
    references: ["<forged-rfc-reference@example.com>"],
    subject: `Booking ${ref} · collection question`,
    text: "Can you tell me the collection address?",
  }));
  assert.equal(forgedFrom.accountId, null, "a matching From address and forged RFC reply headers cannot bind to the verified account");
  assert.equal(forgedFrom.bookingId, null, "a forged sender cannot retrieve rental context from a booking reference");
  assert.equal(docs.get(forgedFrom.inboundId).profileMessageId, undefined, "forged From/Reply-To continuity is not mirrored into account chat");
  const forgedClaim = await inbox.claimInbound.handler({ db }, {
    secret: "fixture-inbound-secret",
    inboundId: forgedFrom.inboundId,
    humanRequested: false,
  });
  assert.equal(forgedClaim.rentalContext, null, "Resend authentication plus a matching From is not mailbox proof");

  const live = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-1", {
    replyThreadId: privateThread._id,
    replyCapabilityKey: capabilityKey,
    subject: `Booking ${ref} · collection question`,
    text: "Can we confirm collection for this rental?",
  }));
  assert.equal(live.accountId, account._id);
  assert.equal(live.bookingId, booking._id, "live inbound email resolves the exact owned rental reference");
  assert.equal(mirrored.at(-1).bookingId, booking._id, "live email appears in the booking-specific rental chat");
  assert.equal(docs.get(live.inboundId).bookingId, booking._id, "the resolved context is stored for retries and history repair");
  assert(live.history.some(row => row.content.includes(TRAFALGAR_PICKUP_ADDRESS)), "current paid, verified, confirmed rentals may provide their approved handover details to Gaffer");
  assert(live.history.some(row => row.content.includes(LEO_SUPPORT_PHONE)));

  const exactClaim = await inbox.claimInbound.handler({ db }, {
    secret: "fixture-inbound-secret",
    inboundId: live.inboundId,
    humanRequested: false,
  });
  assert.equal(exactClaim.state, "claimed");
  assert.equal(docs.get(live.inboundId).state, "processing", "rental facts are returned only from the active inbound claim");
  assert.equal(exactClaim.rentalContext.customerName, "Booking owner");
  assert.equal(exactClaim.rentalContext.booking._id, booking._id);
  assert.equal(exactClaim.rentalContext.booking.status, "confirmed");
  assert.equal(exactClaim.rentalContext.booking.fulfilment, "pickup", "verified email context includes the actual fulfilment method");
  assert.deepEqual(exactClaim.rentalContext.booking.lineItems, [{
    title: "Synthetic cinema camera",
    qty: 1,
    start: booking.lineItems[0].start,
    end: booking.lineItems[0].end,
    returnTime: "18:00",
  }]);
  assert.equal(exactClaim.rentalContext.booking.paidConfirmedAt, booking.paidConfirmedAt);
  assert.equal(exactClaim.rentalContext.booking.cancellation.termsText, acceptedCancellationText, "Gaffer receives the booking's accepted cancellation snapshot");
  assert.equal(exactClaim.rentalContext.booking.handoverDetails.pickupAddress, TRAFALGAR_PICKUP_ADDRESS, "handover location is included only after payment, current verification, and confirmation gates pass");
  assert.equal("address" in exactClaim.rentalContext.booking, false, "raw booking addresses are not exposed outside the gated handover details");
  const busyClaim = await inbox.claimInbound.handler({ db }, {
    secret: "fixture-inbound-secret",
    inboundId: live.inboundId,
    humanRequested: false,
  });
  assert.equal(busyClaim.state, "busy");
  assert.equal(busyClaim.rentalContext, undefined, "a competing claim cannot read booking prompt facts while another lease is active");

  booking.status = "pending_verification";
  booking.fulfilment = "delivery";
  booking.deliveryLegs = "one_way";
  booking.deliveryFee = 25.5;
  const closedGateEmail = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-closed-handover-gate", {
    replyThreadId: privateThread._id,
    replyCapabilityKey: capabilityKey,
    subject: `Booking ${ref} · verification follow-up`,
    text: "I have a question about verification.",
  }));
  const closedGateHistory = closedGateEmail.history.map(row => row.content).join("\n");
  assert(!closedGateHistory.includes(TRAFALGAR_PICKUP_ADDRESS), "historical pickup address is hidden as soon as the shared handover gate closes");
  assert(!closedGateHistory.includes(LEO_SUPPORT_PHONE), "historical support phone is hidden as soon as the shared handover gate closes");
  assert(!closedGateHistory.includes("google.com/maps"), "historical map link is hidden as soon as the shared handover gate closes");
  assert(closedGateHistory.includes("hidden until rental is ready"));
  const closedGateClaim = await inbox.claimInbound.handler({ db }, {
    secret: "fixture-inbound-secret",
    inboundId: closedGateEmail.inboundId,
    humanRequested: false,
  });
  const claimedClosedGateHistory = closedGateClaim.history.map(row => row.content).join("\n");
  assert(!claimedClosedGateHistory.includes(TRAFALGAR_PICKUP_ADDRESS));
  assert(!claimedClosedGateHistory.includes(LEO_SUPPORT_PHONE));
  assert(!claimedClosedGateHistory.includes("google.com/maps"));
  assert.equal(closedGateClaim.rentalContext.booking.handoverDetails, undefined, "Gaffer receives no historical or current handover details while verification is pending");
  assert.equal(closedGateClaim.rentalContext.booking.fulfilment, "delivery");
  assert.equal(closedGateClaim.rentalContext.booking.deliveryLegs, "one_way");
  assert.equal(closedGateClaim.rentalContext.booking.deliveryFee, 25.5);
  assert.equal("address" in closedGateClaim.rentalContext.booking, false, "the delivery address remains protected while handover is locked");
  booking.status = "confirmed";
  booking.fulfilment = "pickup";
  delete booking.deliveryLegs;
  delete booking.deliveryFee;

  const messageCountAfterFirstDelivery = mirrored.length;
  const replay = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-1", {
    replyThreadId: privateThread._id,
    replyCapabilityKey: capabilityKey,
    subject: `Booking ${ref} · collection question`,
    text: "Can we confirm collection for this rental?",
  }));
  assert.equal(replay.duplicate, true);
  assert.equal(mirrored.length, messageCountAfterFirstDelivery, "provider webhook replay does not duplicate the renter chat message");

  const noReference = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-no-ref", {
    replyThreadId: privateThread._id,
    replyCapabilityKey: capabilityKey,
    subject: "A question about my upcoming rental",
    text: "Could you help me with my upcoming rental?",
  }));
  assert.equal(noReference.bookingId, booking._id, "an unreferenced email from a verified renter with one current rental joins that rental");
  assert.equal(mirrored.at(-1).bookingId, booking._id, "the inferred rental context reaches the booking chat");
  const repeatedRentalEmail = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-no-ref-follow-up", {
    replyThreadId: privateThread._id,
    replyCapabilityKey: capabilityKey,
    subject: "Re: A question about my upcoming rental",
    text: "One more detail about my rental.",
  }));
  assert.equal(repeatedRentalEmail.threadId, noReference.threadId, "same-subject messages stay in one rental email thread without needing a provider reference");
  assert.equal(repeatedRentalEmail.bookingId, booking._id);

  const generalSupportThread = storedThread(account.email, "Existing general support", {
    accountId: account._id,
    verifiedRenterEmail: account.email,
    replyKey: "abcdef0123456789abcdef02",
  });
  const generalSupportAnchor = put("email_messages", {
    threadId: generalSupportThread._id,
    direction: "out",
    sender: "dbcinemarentals@gmail.com",
    recipient: account.email,
    subject: generalSupportThread.subject,
    text: "Please reply if you need any other general help.",
    at: 35,
    providerId: "out:email-owner:general-support:reply-1",
    messageId: "<general-support-message@example.com>",
    state: "sent",
  });
  const supportReply = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-general-support-reply", {
    replyThreadId: generalSupportThread._id,
    replyCapabilityKey: generalSupportThread.replyKey,
    inReplyTo: generalSupportAnchor.messageId,
    subject: `Re: ${generalSupportThread.subject}`,
    text: "Thanks, I have one more general question.",
  }));
  assert.equal(supportReply.threadId, generalSupportThread._id, "a correlated general-support reply remains in its original thread");
  assert.equal(supportReply.bookingId, null, "a current rental never overwrites a known general-support email context");
  const generalClaim = await inbox.claimInbound.handler({ db }, {
    secret: "fixture-inbound-secret",
    inboundId: supportReply.inboundId,
    humanRequested: false,
  });
  assert.equal(generalClaim.rentalContext, null, "an exact account-owned general email thread receives no guessed rental facts");

  const unownedCurrent = put("accounts", { email: "support-only@example.com", emailVerifiedAt: 15, name: "Support-only renter" });
  const supportOnlyEmail = await inbox.ingest.handler({ db }, emailInput(unownedCurrent.email, "booking-mail-support-only", {
    subject: "A general account question",
    text: "Could you help me with my account?",
  }));
  assert.equal(supportOnlyEmail.bookingId, null, "an account without a rental stays in general support");
  assert.equal(docs.get(supportOnlyEmail.inboundId).profileMessageId, undefined, "unproven general email is not mirrored into account chat");

  const correlatedAnchor = put("email_messages", {
    threadId: privateThread._id,
    bookingId: booking._id,
    direction: "out",
    sender: "dbcinemarentals@gmail.com",
    recipient: account.email,
    subject: privateThread.subject,
    text: "Please reply if you need help with this rental.",
    at: 29,
    providerId: "out:email-owner:existing-rental-thread:reply-1",
    messageId: "<rental-owner-message@example.com>",
    state: "sent",
  });
  const correlatedReply = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-correlated-reply", {
    inReplyTo: correlatedAnchor.messageId,
    references: [correlatedAnchor.messageId],
    subject: `Re: ${privateThread.subject}`,
    text: "Thanks, that answers my question.",
  }));
  assert.notEqual(correlatedReply.threadId, privateThread._id, "sender-controlled RFC headers cannot impersonate the private reply capability");
  assert.equal(correlatedReply.accountId, null, "RFC correlation alone does not attach an email to an account");
  assert.equal(correlatedReply.bookingId, null, "RFC correlation alone does not inherit booking facts");
  assert.equal(docs.get(correlatedReply.inboundId).profileMessageId, undefined, "unproven email stays out of account chat");

  const standaloneSupportThread = storedThread(account.email, "Standalone support", { replyKey: "abcdef0123456789abcdef03" });
  const standaloneSupportAnchor = put("email_messages", {
    threadId: standaloneSupportThread._id,
    direction: "out",
    sender: "dbcinemarentals@gmail.com",
    recipient: account.email,
    subject: standaloneSupportThread.subject,
    text: "Let us know if you have another general question.",
    at: 37,
    providerId: "out:email-owner:standalone-support:reply-1",
    messageId: "<standalone-support-message@example.com>",
    state: "sent",
  });
  const standaloneReply = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-standalone-rfc-reply", {
    inReplyTo: standaloneSupportAnchor.messageId,
    references: [standaloneSupportAnchor.messageId],
    subject: `Re: ${standaloneSupportThread.subject}`,
    text: "Thanks, I have one more general question.",
  }));
  assert.equal(standaloneReply.threadId, standaloneSupportThread._id, "a unique RFC reference from the same sender continues an unlinked general-support thread");
  assert.equal(standaloneReply.accountId, null, "RFC continuation does not authenticate or link an account");
  assert.equal(standaloneReply.bookingId, null, "RFC continuation does not inherit rental context");
  assert.equal(docs.get(standaloneReply.inboundId).replyCapabilityVerified, undefined, "RFC continuation is not treated as a private reply capability");
  assert.equal(docs.get(standaloneReply.inboundId).profileMessageId, undefined, "RFC continuation stays out of renter chat");
  const standaloneClaim = await inbox.claimInbound.handler({ db }, {
    secret: "fixture-inbound-secret",
    inboundId: standaloneReply.inboundId,
    humanRequested: false,
  });
  assert.equal(standaloneClaim.rentalContext, null, "RFC continuation cannot reveal private rental data to Gaffer");

  const wrongSenderRfcReply = await inbox.ingest.handler({ db }, emailInput("impostor@example.com", "booking-mail-wrong-sender-rfc-reply", {
    inReplyTo: standaloneSupportAnchor.messageId,
    references: [standaloneSupportAnchor.messageId],
    text: "I found this message ID.",
  }));
  assert.notEqual(wrongSenderRfcReply.threadId, standaloneSupportThread._id, "a matching RFC header from a different sender cannot join the thread");

  const ambiguousSupportThread = storedThread(account.email, "Duplicate message ID support");
  put("email_messages", {
    threadId: ambiguousSupportThread._id,
    direction: "out",
    sender: "dbcinemarentals@gmail.com",
    recipient: account.email,
    subject: ambiguousSupportThread.subject,
    text: "A duplicate provider ID fixture.",
    at: 38,
    providerId: "out:email-owner:duplicate-message-id:reply-1",
    messageId: standaloneSupportAnchor.messageId,
    state: "sent",
  });
  const ambiguousRfcReply = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-ambiguous-rfc-reply", {
    inReplyTo: standaloneSupportAnchor.messageId,
    references: [standaloneSupportAnchor.messageId],
    text: "This header matches more than one stored message.",
  }));
  assert.notEqual(ambiguousRfcReply.threadId, standaloneSupportThread._id, "ambiguous Message-ID matches fail closed instead of choosing a thread");
  assert.notEqual(ambiguousRfcReply.threadId, ambiguousSupportThread._id);

  const wrongCapability = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-wrong-capability", {
    replyThreadId: privateThread._id,
    replyCapabilityKey: "000000000000000000000000",
    subject: "Re: Renter email thread",
    text: "I found this old message; please tell me the rental details.",
  }));
  assert.equal(wrongCapability.accountId, null, "a forged or stale reply alias cannot attach to the account");
  assert.equal(wrongCapability.bookingId, null, "a wrong capability cannot inherit the thread booking");
  assert.equal(docs.get(wrongCapability.inboundId).profileMessageId, undefined, "wrong-capability messages remain outside rental chat");

  const sameAccountSecondBooking = putBooking(account, "OTHER001", 25);
  const ambiguousCurrentRental = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-multiple-current", {
    subject: "A question without a booking reference",
    text: "I have a question about one of my rentals.",
  }));
  assert.equal(ambiguousCurrentRental.bookingId, null, "multiple current rentals are not guessed; the message remains general support");
  assert.equal(docs.get(ambiguousCurrentRental.inboundId).profileMessageId, undefined, "unproven ambiguous rental mail stays outside account chat");
  const conflictingReference = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-correlated-conflicting-reference", {
    replyThreadId: privateThread._id,
    replyCapabilityKey: capabilityKey,
    inReplyTo: correlatedAnchor.messageId,
    subject: `Re: ${privateThread.subject}`,
    text: `This is about ${rentalRef(sameAccountSecondBooking)} instead.`,
  }));
  assert.notEqual(conflictingReference.threadId, privateThread._id, "a reference to a different rental cannot override the correlated rental thread");
  assert.equal(conflictingReference.bookingId, null, "a different booking reference cannot borrow another rental thread's mailbox capability");

  const privateReply = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-private-reply", {
    replyThreadId: privateThread._id,
    replyCapabilityKey: capabilityKey,
    subject: "Re: Renter email thread",
    text: "Thanks, that answers my question.",
  }));
  assert.equal(privateReply.bookingId, booking._id, "a validated private reply capability can safely continue its existing booking thread");
  assert.equal(mirrored.at(-1).bookingId, booking._id);

  const privateInbound = put("email_messages", {
    threadId: privateThread._id,
    bookingId: booking._id,
    direction: "in",
    sender: account.email,
    recipient: "rentals@dbcinemarentals.com",
    subject: privateThread.subject,
    text: "Could you confirm the return time?",
    at: 40,
    providerId: "booking-reply-inbound",
    state: "received",
    messageId: "booking-reply-inbound@example.com",
    references: [],
  });
  const automaticReply = await inbox.claimAutomaticReply.handler({ db }, {
    threadId: privateThread._id,
    inboundId: privateInbound._id,
    text: "Your booking return time is confirmed.",
    humanRequested: false,
  });
  assert.equal(docs.get(automaticReply.outboundId).bookingId, booking._id, "Gaffer email replies preserve validated booking context in the outbox");
  assert.equal(docs.get(automaticReply.outboundId).chatSender, "bot", "Gaffer email outbox rows preserve the assistant identity");
  await inbox.finishAutomaticReply.handler({ db }, {
    threadId: privateThread._id,
    inboundId: privateInbound._id,
    outboundId: automaticReply.outboundId,
    text: "Your booking return time is confirmed.",
    messageId: "booking-reply-outbound@example.com",
    humanRequested: false,
  });
  assert.equal(mirrored.at(-1).bookingId, booking._id, "Gaffer email replies return to the same rental conversation");
  assert.equal(mirrored.at(-1).sender, "bot", "Gaffer email replies render as Gaffer in the renter conversation");

  const ownerReply = await inbox.reserveOwnerReply.handler({ db }, {
    threadId: privateThread._id,
    replyId: "booking-owner-reply-001",
    text: "The return time is 8pm.",
    references: [],
  });
  assert.equal(docs.get(ownerReply.outboundId).bookingId, booking._id, "admin email replies preserve validated booking context in the outbox");
  await inbox.finishOwnerReply.handler({ db }, {
    threadId: privateThread._id,
    outboundId: ownerReply.outboundId,
    text: "The return time is 8pm.",
    messageId: "booking-owner-reply-001@example.com",
    references: [],
  });
  assert.equal(mirrored.at(-1).bookingId, booking._id, "admin email replies return to the same rental conversation");

  const collidingBooking = put("bookings", { _id: "bookings-second-F58HCFWE", accountId: account._id, guestEmail: account.email, at: 25 });
  const collision = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-reference-collision", {
    subject: `Booking ${ref}`,
    text: "Could you check the booking?",
  }));
  assert.equal(collision.accountId, null, "an unsigned sender cannot attach a reference collision to a renter account");
  assert.equal(collision.bookingId, null, "booking references do not replace mailbox proof");
  assert.notEqual(collidingBooking._id, booking._id);

  const legacyBooking = put("bookings", { _id: "bookings-LEGACY01", guestEmail: account.email, at: 26 });
  const legacyReference = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-legacy-reference", {
    subject: `Booking ${rentalRef(legacyBooking)}`,
  }));
  assert.equal(legacyReference.accountId, null, "a legacy guest email still needs proof of mailbox control");
  assert.equal(legacyReference.bookingId, null, "an exact DBC reference alone cannot expose a legacy rental");

  const otherAccount = put("accounts", { email: "another-renter@example.com", emailVerifiedAt: 11, name: "Another renter" });
  const otherBooking = putBooking(otherAccount, "ABCDEFG2", 21);
  const foreignReference = await inbox.ingest.handler({ db }, emailInput(otherAccount.email, "booking-mail-foreign-ref", {
    subject: `Booking ${ref} question`,
    text: "Please change this booking.",
  }));
  assert.equal(foreignReference.accountId, null, "a verified account with a different email cannot be selected from a forged From");
  assert.equal(foreignReference.bookingId, null, "a copied DBC reference without mailbox proof is not routed to any rental");
  assert.notEqual(otherBooking._id, booking._id);

  const mixedReferences = await inbox.ingest.handler({ db }, emailInput(account.email, "booking-mail-mixed-refs", {
    subject: `Booking ${rentalRef(legacyBooking)} and ${rentalRef(otherBooking)}`,
    text: "I am comparing these two references.",
  }));
  assert.equal(mixedReferences.bookingId, null, "multiple booking references are ambiguous and fail closed");
  assert.equal(docs.get(mixedReferences.inboundId).profileMessageId, undefined, "ambiguous unproven mail is not mirrored into account chat");

  const unverified = put("accounts", { email: "unverified-owner@example.com", name: "Unverified owner" });
  const unverifiedBooking = putBooking(unverified, "UNVER123", 22);
  const mirroredBeforeUnverified = mirrored.length;
  const unverifiedMail = await inbox.ingest.handler({ db }, emailInput(unverified.email, "booking-mail-unverified", {
    subject: `Booking ${rentalRef(unverifiedBooking)}`,
  }));
  assert.equal(unverifiedMail.accountId, null);
  assert.equal(unverifiedMail.bookingId, null, "an unverified account email cannot bind a booking email to a renter chat");
  assert.equal(mirrored.length, mirroredBeforeUnverified, "the unverified message is not mirrored into any existing customer profile");

  const pendingAccount = put("accounts", { email: "pending-renter@example.com", emailVerifiedAt: 22, name: "Pending renter" });
  const pendingBooking = put("bookings", {
    _id: "bookings-PENDING1",
    accountId: pendingAccount._id,
    guestEmail: pendingAccount.email,
    status: "pending_verification",
    lineItems: [{ listingId: "listings-pending", start: 10, end: 20, qty: 1 }],
  });
  const pendingEmail = await inbox.ingest.handler({ db }, emailInput(pendingAccount.email, "booking-mail-pending-rental", {
    subject: "Verification question",
    text: "I need help with verification for my rental.",
  }));
  assert.equal(pendingEmail.accountId, null, "a sender cannot use a pending rental email address as identity proof");
  assert.equal(pendingEmail.bookingId, null, "paid pending-verification rentals require the private reply capability before exposing context");

  const pendingPaymentAccount = put("accounts", { email: "checkout-renter@example.com", emailVerifiedAt: 25, name: "Checkout renter" });
  const pendingPaymentBooking = put("bookings", {
    _id: "bookings-CHECKOUT1",
    accountId: pendingPaymentAccount._id,
    guestEmail: pendingPaymentAccount.email,
    status: "pending_payment",
    stockHoldFingerprint: "synthetic-fingerprint",
    lineItems: [{ listingId: "listings-checkout", start: 10, end: 20, qty: 1 }],
  });
  put("reservations", { bookingId: pendingPaymentBooking._id, status: "hold", holdExpiresAt: Date.now() + 60_000 });
  const pendingPaymentEmail = await inbox.ingest.handler({ db }, emailInput(pendingPaymentAccount.email, "booking-mail-open-checkout", {
    subject: "Checkout question",
    text: "I am having trouble completing this rental.",
  }));
  assert.equal(pendingPaymentEmail.bookingId, null, "live checkout holds do not bypass mailbox proof");

  const expiredCheckoutAccount = put("accounts", { email: "expired-checkout@example.com", emailVerifiedAt: 26, name: "Expired checkout" });
  const expiredCheckoutBooking = put("bookings", {
    _id: "bookings-EXPIRED1",
    accountId: expiredCheckoutAccount._id,
    guestEmail: expiredCheckoutAccount.email,
    status: "pending_payment",
    stockHoldFingerprint: "synthetic-expired-fingerprint",
    lineItems: [{ listingId: "listings-expired", start: 10, end: 20, qty: 1 }],
  });
  put("reservations", { bookingId: expiredCheckoutBooking._id, status: "hold", holdExpiresAt: Date.now() - 60_000 });
  const expiredCheckoutEmail = await inbox.ingest.handler({ db }, emailInput(expiredCheckoutAccount.email, "booking-mail-expired-checkout", {
    subject: "A general checkout question",
  }));
  assert.equal(expiredCheckoutEmail.bookingId, null, "expired or live stock holds do not bypass mailbox proof");

  const ambiguousEmail = "duplicate-verified@example.com";
  put("accounts", { email: ambiguousEmail, emailVerifiedAt: 23, name: "Duplicate verified one" });
  put("accounts", { email: ambiguousEmail, emailVerifiedAt: 24, name: "Duplicate verified two" });
  const ambiguousSender = await inbox.ingest.handler({ db }, emailInput(ambiguousEmail, "booking-mail-ambiguous-sender", {
    subject: `Booking ${ref}`,
  }));
  assert.equal(ambiguousSender.accountId, null, "duplicate verified profiles make the sender ambiguous, so no account is selected");
  assert.equal(ambiguousSender.bookingId, null);

  const mergeEmail = "duplicate-merge@example.com";
  const preSignupEmail = await inbox.ingest.handler({ db }, emailInput(mergeEmail, "duplicate-merge-before-signup", {
    subject: "A question before signup",
    text: "Please keep this support question with my account.",
  }));
  const mergeAccount = put("accounts", { email: mergeEmail, emailVerifiedAt: 25, name: "First verified profile" });
  const mergeJobs = [];
  const mergeScheduler = { runAfter: async (_delay, refName, args) => mergeJobs.push({ refName: String(refName), args }) };
  assert.deepEqual(await inbox.claimForAccount.handler({ db, scheduler: mergeScheduler }, { token: mergeAccount._id }), { ok: true });
  await inbox.linkVerifiedHistory.handler({ db, scheduler: mergeScheduler }, mergeJobs.shift().args);
  const pendingCopy = mergeJobs.find(job => job.refName.endsWith("copyVerifiedHistory"));
  assert.ok(pendingCopy, "unique verified ownership schedules the existing history copy");
  const duplicateMergeAccount = put("accounts", { email: mergeEmail, emailVerifiedAt: 26, name: "Second verified profile" });
  await inbox.copyVerifiedHistory.handler({ db, scheduler: mergeScheduler }, pendingCopy.args);
  const preSignupThread = docs.get(preSignupEmail.threadId);
  assert.equal(docs.get(preSignupEmail.inboundId).profileMessageId, undefined, "a queued merge copy rechecks identity uniqueness before exposing email history");
  const ambiguousNewEmail = await inbox.ingest.handler({ db }, emailInput(mergeEmail, "duplicate-merge-after-signup", {
    subject: "A later support question",
    text: "This message must remain unclaimed while profiles are ambiguous.",
  }));
  const ambiguousClaimJobs = [];
  const ambiguousClaim = await inbox.claimForAccount.handler({ db, scheduler: { runAfter: async (...args) => ambiguousClaimJobs.push(args) } }, { token: mergeAccount._id });
  assert.deepEqual(ambiguousClaim, { ok: false }, "duplicate verified addresses cannot claim new standalone email history");
  assert.equal(ambiguousClaimJobs.length, 0);
  const directLinkJobs = [];
  await inbox.linkVerifiedHistory.handler({ db, scheduler: { runAfter: async (...args) => directLinkJobs.push(args) } }, { accountId: mergeAccount._id, cursor: null });
  assert.equal(docs.get(ambiguousNewEmail.threadId).accountId, undefined, "the internal backfill path also fails closed for duplicate verified addresses");
  assert.equal(directLinkJobs.length, 0);
  await inbox.copyVerifiedHistory.handler({ db, scheduler: mergeScheduler }, { accountId: mergeAccount._id, threadId: preSignupThread._id, cursor: null });
  assert.equal(docs.get(preSignupEmail.inboundId).profileMessageId, undefined, "direct and delayed copy paths both respect ambiguous ownership");
  assert.ok(duplicateMergeAccount._id);

  const delayedEmail = "delayed-booking-contact@example.com";
  const delayedReference = rentalRef({ _id: "bookings-LATE0001" });
  const earlyMessage = await inbox.ingest.handler({ db }, emailInput(delayedEmail, "delayed-booking-contact", {
    subject: `Booking ${delayedReference} · rental question`,
    text: "I have a question about this booking.",
  }));
  const generalContactMessage = await inbox.ingest.handler({ db }, emailInput(delayedEmail, "delayed-general-contact", {
    subject: "General support question",
    text: "Could you help me with my account?",
  }));
  const delayedAccount = put("accounts", { email: delayedEmail, emailVerifiedAt: 26, name: "Delayed booking renter" });
  const delayedJobs = [];
  const delayedScheduler = { runAfter: async (_delay, refName, args) => delayedJobs.push({ refName: String(refName), args }) };
  await inbox.claimForAccount.handler({ db, scheduler: delayedScheduler }, { token: delayedAccount._id });
  for (let index = 0; index < delayedJobs.length; index++) {
    const job = delayedJobs[index];
    if (job.refName.endsWith("linkVerifiedHistory")) await inbox.linkVerifiedHistory.handler({ db, scheduler: delayedScheduler }, job.args);
    if (job.refName.endsWith("copyVerifiedHistory")) await inbox.copyVerifiedHistory.handler({ db, scheduler: delayedScheduler }, job.args);
  }
  const earlyMessageRow = docs.get(earlyMessage.inboundId);
  const earlyProfileMessage = docs.get(earlyMessageRow.profileMessageId);
  assert.equal(earlyProfileMessage.accountId, delayedAccount._id, "the verified email contact is merged into its owner's profile");
  assert.equal(earlyProfileMessage.bookingId, undefined, "an unknown booking reference stays in general support until an owned booking exists");
  const generalMessageRow = docs.get(generalContactMessage.inboundId);
  const generalProfileMessage = docs.get(generalMessageRow.profileMessageId);
  assert.equal(generalProfileMessage.accountId, delayedAccount._id, "no-reference contact history is retained on the verified renter account");
  assert.equal(generalProfileMessage.bookingId, undefined, "general support does not get guessed onto the renter's only rental");
  const delayedBooking = put("bookings", {
    _id: "bookings-LATE0001",
    accountId: delayedAccount._id,
    guestEmail: delayedEmail,
    status: "confirmed",
    lineItems: [{ listingId: "listings-delayed", start: 27, end: 28, qty: 1 }],
  });
  const bookingsSource = fs.readFileSync(path.resolve(__dirname, "../convex/bookings.ts"), "utf8");
  const pendingBookingSource = bookingsSource.slice(bookingsSource.indexOf("export const createPending"), bookingsSource.indexOf("function stockAllocationFingerprint"));
  assert.match(pendingBookingSource, /internal\.emailInbox\.linkVerifiedHistory/, "creating an account-linked booking rechecks verified email history");
  await inbox.linkVerifiedHistory.handler({ db, scheduler: delayedScheduler }, { accountId: delayedAccount._id, cursor: null });
  for (let index = 0; index < delayedJobs.length; index++) {
    const job = delayedJobs[index];
    if (job.refName.endsWith("copyVerifiedHistory")) await inbox.copyVerifiedHistory.handler({ db, scheduler: delayedScheduler }, job.args);
  }
  assert.equal(earlyMessageRow.bookingId, delayedBooking._id, "booking creation relinks a previously general exact-reference email");
  assert.equal(earlyProfileMessage.bookingId, delayedBooking._id, "the existing profile message is moved without being duplicated");
  assert.equal(generalMessageRow.bookingId, undefined, "the booking sweep leaves no-reference general support unassigned");
  assert.equal(generalProfileMessage.bookingId, undefined, "general support remains account-level after a rental is linked");
  assert.equal([...docs.values()].filter(row => row._id.startsWith("chat_threads-") && row.accountId === delayedAccount._id && row.bookingId === undefined).length, 1, "general history retains one canonical account-support thread");
  assert.ok([...docs.values()].some(row => row._id.startsWith("chat_threads-") && row.accountId === delayedAccount._id && row.bookingId === delayedBooking._id), "the historical email becomes visible in the linked rental conversation");

  const historyAccount = put("accounts", { email: "history-owner@example.com", emailVerifiedAt: 30, name: "History owner" });
  const historyBooking = putBooking(historyAccount, "HIST0001", 31);
  const history = storedThread(historyAccount.email, `Booking ${rentalRef(historyBooking)} · old thread`);
  const oldBookingEmail = put("email_messages", {
    threadId: history._id,
    direction: "in",
    sender: historyAccount.email,
    recipient: "rentals@dbcinemarentals.com",
    subject: history.subject,
    text: "Please confirm the rental details.",
    at: 32,
    providerId: "history-booking-message",
    state: "received",
  });
  const oldBookingMirror = put("messages", {
    accountId: historyAccount._id,
    sender: "renter",
    text: oldBookingEmail.text,
    at: oldBookingEmail.at,
    readByOwner: true,
    threadCounted: true,
    meta: { channel: "email", emailThreadId: String(history._id), emailMessageId: String(oldBookingEmail._id) },
  });
  oldBookingEmail.profileMessageId = oldBookingMirror._id;
  const historicalOwnerReply = put("email_messages", {
    threadId: history._id,
    direction: "out",
    sender: "dbcinemarentals@gmail.com",
    recipient: historyAccount.email,
    subject: history.subject,
    text: "The team has confirmed the rental details.",
    at: 34,
    providerId: "out:email-owner:history-thread:historic-owner-reply",
    state: "sent",
  });
  const historicalGafferReply = put("email_messages", {
    threadId: history._id,
    direction: "out",
    chatSender: "bot",
    sender: "dbcinemarentals@gmail.com",
    recipient: historyAccount.email,
    subject: history.subject,
    text: "Gaffer has found the rental details.",
    at: 35,
    providerId: "out:email-auto:historic-gaffer-reply",
    state: "sent",
  });
  const ambiguousHistoryEmail = put("email_messages", {
    threadId: history._id,
    direction: "in",
    sender: historyAccount.email,
    recipient: "rentals@dbcinemarentals.com",
    subject: `Comparing ${rentalRef(historyBooking)} and ${rentalRef(booking)}`,
    text: "Please compare these two rentals.",
    at: 33,
    providerId: "history-ambiguous-message",
    state: "received",
  });
  const closedSupportChat = put("chat_threads", {
    accountId: historyAccount._id,
    escalated: false,
    updatedAt: 30,
    closedAt: 50,
  });
  put("email_messages", {
    threadId: history._id,
    direction: "in",
    sender: historyAccount.email,
    recipient: "rentals@dbcinemarentals.com",
    subject: "A historic support follow-up",
    text: "This message predates the support closure.",
    at: 40,
    providerId: "history-before-closure",
    state: "received",
  });

  const scheduled = [];
  const scheduler = { runAfter: async (_delay, refName, args) => scheduled.push({ refName: String(refName), args }) };
  await inbox.linkVerifiedHistory.handler({ db, scheduler }, { accountId: historyAccount._id, cursor: null });
  for (const job of scheduled.filter(job => job.refName.endsWith("copyVerifiedHistory"))) {
    await inbox.copyVerifiedHistory.handler({ db, scheduler }, job.args);
  }
  assert.equal(oldBookingEmail.bookingId, historyBooking._id, "verified-history backfill resolves and persists the exact owned booking reference");
  assert.equal(docs.get(oldBookingMirror._id).bookingId, historyBooking._id, "already mirrored support email is moved into its booking conversation without duplication");
  assert.equal(docs.get(historicalOwnerReply.profileMessageId).sender, "owner", "email history restores the DB Cinema team identity for legacy owner outbox messages");
  assert.equal(docs.get(historicalGafferReply.profileMessageId).sender, "bot", "automated Gaffer email replies retain the assistant identity in renter chat");
  assert.equal(ambiguousHistoryEmail.bookingId, undefined, "ambiguous historical references stay in account support");
  assert.equal(closedSupportChat.closedAt, 50, "Backfilling a message older than closure does not reopen support");
  const bookingThread = [...docs.values()].find(row => row.accountId === historyAccount._id && row.bookingId === historyBooking._id && row._id.startsWith("chat_threads-"));
  assert.ok(bookingThread, "backfill creates the correct booking conversation index row");
  const historyMessageCount = [...docs.values()].filter(row => row.accountId === historyAccount._id && row.meta?.channel === "email").length;
  await inbox.copyVerifiedHistory.handler({ db, scheduler }, { accountId: historyAccount._id, threadId: history._id, cursor: null });
  assert.equal([...docs.values()].filter(row => row.accountId === historyAccount._id && row.meta?.channel === "email").length, historyMessageCount, "backfill retry remains idempotent");
  assert.equal([...docs.values()].filter(row => row._id.startsWith("chat_threads-") && row.accountId === historyAccount._id && row.bookingId === undefined).length, 1, "backfill reuses one canonical general-support thread instead of creating a null-booking duplicate");
  put("email_messages", {
    threadId: history._id,
    direction: "in",
    sender: historyAccount.email,
    recipient: "rentals@dbcinemarentals.com",
    subject: "A new support follow-up",
    text: "This message arrived after support closed.",
    at: 60,
    providerId: "history-after-closure",
    state: "received",
  });
  await inbox.copyVerifiedHistory.handler({ db, scheduler }, { accountId: historyAccount._id, threadId: history._id, cursor: null });
  assert.equal(closedSupportChat.closedAt, undefined, "Backfilling a renter message newer than closure reopens the support chat");
  assert.equal(closedSupportChat.updatedAt, 60, "Reopening advances the idle timer from the backfilled renter message");

  const projectionAccount = put("accounts", { email: "projection-owner@example.invalid", emailVerifiedAt: 100, createdAt: 100 });
  const projectionBooking = putBooking(projectionAccount, "PROJ0001", 100);
  function projectionThread({ account = projectionAccount, booking = projectionBooking, mirrored = true, verified = true, general = false, suffix }) {
    const email = account.email;
    const thread = storedThread(email, `Projection ${suffix}`, {
      accountId: account._id,
      ...(general ? {} : { bookingId: booking._id }),
      verifiedRenterEmail: verified ? email : undefined,
      unreadOwner: 1,
    });
    const inbound = put("email_messages", {
      threadId: thread._id,
      ...(general ? {} : { bookingId: booking._id }),
      direction: "in",
      sender: email,
      recipient: "rentals@dbcinemarentals.com",
      subject: thread.subject,
      text: "Can you confirm the rental details?",
      at: 101,
      state: "received",
    });
    if (mirrored) {
      const mirror = put("messages", {
        accountId: account._id,
        ...(general ? {} : { bookingId: booking._id }),
        sender: "renter",
        text: inbound.text,
        at: inbound.at,
        meta: { channel: "email", emailThreadId: String(thread._id), emailMessageId: String(inbound._id) },
      });
      inbound.profileMessageId = mirror._id;
    }
    thread.latestInboundMessageId = inbound._id;
    return thread;
  }
  const exactProjection = projectionThread({ suffix: "exact" });
  const noMirrorProjection = projectionThread({ suffix: "no-mirror", mirrored: false });
  const foreignAccount = put("accounts", { email: "foreign-owner@example.invalid", emailVerifiedAt: 100, createdAt: 100 });
  const foreignProjection = projectionThread({ account: foreignAccount, booking: projectionBooking, suffix: "foreign" });
  const unverifiedAccount = put("accounts", { email: "unverified-owner@example.invalid", createdAt: 100 });
  const projectionUnverifiedBooking = putBooking(unverifiedAccount, "UNVER0001", 100);
  const unverifiedProjection = projectionThread({ account: unverifiedAccount, booking: projectionUnverifiedBooking, suffix: "unverified", verified: false });
  const generalProjection = projectionThread({ suffix: "general", general: true });
  const projectionDb = Object.create(db);
  projectionDb.query = table => {
    const query = db.query(table);
    const withIndex = query.withIndex.bind(query);
    query.withIndex = (name, predicate) => predicate ? withIndex(name, predicate) : query;
    return query;
  };
  const projected = await inbox.adminInboxPage.handler({ db: projectionDb }, {
    token: "fixture-admin",
    paginationOpts: { cursor: null, numItems: 100 },
  });
  const byThreadId = new Map(projected.page.map(thread => [thread._id, thread]));
  assert.deepEqual(byThreadId.get(exactProjection._id).rentalConversation, {
    accountId: projectionAccount._id,
    bookingId: projectionBooking._id,
  }, "only the verified, exactly owned, mirrored inbound projects to its exact rental");
  const linkedDeepLink = await inbox.adminThread.handler({ db: projectionDb }, { token: "fixture-admin", threadId: exactProjection._id });
  assert.deepEqual(linkedDeepLink.rentalConversation, {
    accountId: projectionAccount._id,
    bookingId: projectionBooking._id,
  }, "direct email-thread links resolve the same verified rental destination");
  for (const thread of [foreignProjection, noMirrorProjection, unverifiedProjection, generalProjection]) {
    assert.equal(byThreadId.get(thread._id).rentalConversation, null, `${thread.subject} stays standalone when ownership or mirroring is not proven`);
  }
  assert.equal(byThreadId.has(foreignProjection._id), true, "foreign-account mail remains visible instead of being hidden by a booking ID collision");
  assert.equal(byThreadId.has(noMirrorProjection._id), true, "unmirrored email remains visible for safe recovery");
  assert.equal(byThreadId.has(generalProjection._id), true, "general support remains in the standalone email inbox");

  const foreignClaimOwner = put("accounts", { email: "foreign-claim-owner@example.invalid", emailVerifiedAt: 200, name: "Foreign claim owner" });
  const foreignClaimBooking = putBooking(foreignClaimOwner, "FOREIGN1", 200);
  const foreignClaimThread = storedThread(account.email, "Foreign booking reference", {
    accountId: account._id,
    bookingId: foreignClaimBooking._id,
    verifiedRenterEmail: account.email,
  });
  const foreignClaimInbound = put("email_messages", {
    threadId: foreignClaimThread._id,
    bookingId: foreignClaimBooking._id,
    direction: "in",
    sender: account.email,
    recipient: "rentals@dbcinemarentals.com",
    subject: foreignClaimThread.subject,
    text: "Can you confirm this rental?",
    at: 300,
    providerId: "foreign-booking-context-claim",
    replyCapabilityVerified: true,
    state: "received",
    humanRequested: false,
  });
  const foreignClaim = await inbox.claimInbound.handler({ db }, {
    secret: "fixture-inbound-secret",
    inboundId: foreignClaimInbound._id,
    humanRequested: false,
  });
  assert.equal(foreignClaim.rentalContext, null, "email thread ownership cannot expose another account's referenced booking");

  const duplicateOwner = put("accounts", { email: account.email, emailVerifiedAt: 301, name: "Duplicate booking owner" });
  const duplicateThread = storedThread(account.email, "Duplicate verified owner", {
    accountId: account._id,
    bookingId: booking._id,
    verifiedRenterEmail: account.email,
  });
  const duplicateInbound = put("email_messages", {
    threadId: duplicateThread._id,
    bookingId: booking._id,
    direction: "in",
    sender: account.email,
    recipient: "rentals@dbcinemarentals.com",
    subject: duplicateThread.subject,
    text: "Can you confirm the rental?",
    at: 302,
    providerId: "duplicate-verified-email-context-claim",
    replyCapabilityVerified: true,
    state: "received",
    humanRequested: false,
  });
  assert.ok(duplicateOwner._id);
  const duplicateClaim = await inbox.claimInbound.handler({ db }, {
    secret: "fixture-inbound-secret",
    inboundId: duplicateInbound._id,
    humanRequested: false,
  });
  assert.equal(duplicateClaim.rentalContext, null, "duplicate verified email identities fail closed at the trusted claim boundary");

  const inboundRouteSource = fs.readFileSync(path.join(__dirname, "../src/app/api/email/inbound/route.ts"), "utf8");
  assert.match(inboundRouteSource, /replyKeyFrom\(received\?\.received_for, \.\.\.recipientCandidates\(received\), event\?\.data\?\.to\)/,
    "Resend reply capabilities are read only from the actual recipient envelope");
  assert.match(inboundRouteSource, /api\.emailInbox\.resolveReplyKey[\s\S]{0,180}replyKey: candidateReplyKey[\s\S]{0,100}email: message\.from/,
    "the private alias must resolve against the exact sender before account linkage");
  assert.match(inboundRouteSource, /claim\.rentalContext \?\? null/,
    "Gaffer receives private rental facts only from the server-side verified claim");

  process.stdout.write("PASS inbound email booking routing: private reply capabilities, safe same-sender general-thread RFC continuation, ambiguous/wrong-sender rejection, support isolation, webhook dedupe, retry idempotence, and exact mirrored rental projection.\n");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
