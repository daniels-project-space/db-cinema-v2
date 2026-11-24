const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { rentalReplyTemplates } = load("convex/lib/rentalReplyTemplates.ts");
const { listingImages } = load("convex/lib/catalogImages.ts");
const { LEO_SUPPORT_PHONE, TRAFALGAR_PICKUP_ADDRESS, TRAFALGAR_PICKUP_INSTRUCTIONS } = load("shared/pickupLocation.ts");
const settings = { businessAddress: "Private confirmed pickup depot" };
const booking = { status: "pending_payment", fulfilment: "pickup", pickupTime: "10:30", returnTime: "16:00", idVerifyStatus: "requires_input", lineItems: [{ start: Date.UTC(2027,3,1), end: Date.UTC(2027,3,2) }] };
let replies = rentalReplyTemplates(booking, settings);
assert.equal(replies.length, 1);
assert.ok(!JSON.stringify(replies).includes(settings.businessAddress));
assert.ok(!replies.some(r => ["Rental details", "Verification needed"].includes(r.label)));
replies = rentalReplyTemplates({ ...booking, status: "confirmed" }, settings);
assert.match(replies[0].text, /rental is not ready for collection yet/i);
assert.doesNotMatch(replies[0].text, /your rental is confirmed/i);
assert.match(replies[0].text, /1 Apr 2027 at 10:30/);
assert.match(replies[0].text, /2 Apr 2027 at 16:00/);
assert.ok(!replies[0].text.includes(settings.businessAddress));
assert.ok(replies.some(r => r.label === "Resubmit documents"));
assert.ok(!rentalReplyTemplates({ ...booking, status: "confirmed", idVerifyStatus: "verified" }, settings).some(r => r.label === "Resubmit documents"));
const completeDiditRental = {
  ...booking,
  status: "confirmed",
  paidConfirmedAt: Date.now(),
  idVerifyStatus: "verified",
  verificationProvider: "didit",
  idVerificationSource: "didit",
  idVerifiedAt: Date.now(),
  verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
};
assert.ok(rentalReplyTemplates(completeDiditRental, settings)[0].text.includes(TRAFALGAR_PICKUP_ADDRESS));
assert.ok(rentalReplyTemplates(completeDiditRental, settings)[0].text.includes(TRAFALGAR_PICKUP_INSTRUCTIONS));
assert.ok(rentalReplyTemplates(completeDiditRental, settings)[0].text.includes(LEO_SUPPORT_PHONE));
assert.ok(rentalReplyTemplates({ ...completeDiditRental, idVerifiedAt: Date.now() - 91 * 86400000 }, settings)[0].text.includes(TRAFALGAR_PICKUP_ADDRESS), "the booking's own approval remains valid for its rental after the account reuse window expires");
const diditManualFallback = rentalReplyTemplates({ ...completeDiditRental, idVerificationSource: "manual", verificationChecks: { identity: "approved", selfie: "approved", address: "waiting" } }, settings)[0].text;
assert.ok(!diditManualFallback.includes(TRAFALGAR_PICKUP_ADDRESS), "Didit quick replies do not disclose pickup details through a legacy manual-source fallback");
assert.doesNotMatch(diditManualFallback, /Your rental is confirmed/i, "Didit quick replies do not claim confirmation without complete provider evidence");
assert.ok(!rentalReplyTemplates({ ...booking, status: "confirmed", paidConfirmedAt: Date.now(), idVerifyStatus: "verified", idVerificationSource: "manual", idVerifiedAt: Date.now() }, settings)[0].text.includes(TRAFALGAR_PICKUP_ADDRESS), "legacy manual verification cannot disclose exact pickup details");
for (const status of ["cancelled", "returned"]) assert.ok(!JSON.stringify(rentalReplyTemplates({ ...booking, status }, settings)).includes(TRAFALGAR_PICKUP_ADDRESS));
assert.ok(!JSON.stringify(rentalReplyTemplates({ ...booking, status: "confirmed", fulfilment: "delivery" }, settings)).includes(TRAFALGAR_PICKUP_ADDRESS));
assert.match(rentalReplyTemplates({ ...booking, status: "confirmed", pickupTime: undefined, returnTime: undefined }, {})[0].text, /time to be confirmed/);
assert.deepEqual(listingImages({ r2Images: ["https://assets.example/a", ""], sourceImages: ["https://source.example/a", "https://assets.example/a"], gallery: ["/gear/a.jpg", "javascript:bad"] }), ["https://assets.example/a", "https://source.example/a", "/gear/a.jpg"]);
assert.deepEqual(listingImages({ reviewedImageUrls: ["https://cdn.example/camera-outline.svg", "https://cdn.example/photo.jpg?format=image%2Fsvg%2Bxml"], r2Images: ["https://cdn.example/fx3.webp?width=640"], sourceImages: ["/gear/lens.svg", "/gear/sony-lens.jpg"] }), ["https://cdn.example/fx3.webp?width=640", "/gear/sony-lens.jpg"], "Renter catalog tiles use raster listing photos, never SVG camera/lens illustrations");
assert.deepEqual(listingImages({ r2Images: [], sourceImages: [], gallery: ["/gear/a.jpg"] }), ["/gear/a.jpg"]);
console.log("PASS stage-aware reply templates: no unpaid/cancelled/returned pickup disclosure; no invented times; verification state; real image alternatives preserved.");

(async () => {
  const { db, put, tables } = require("./lib/rentalTestHarness.cjs");
  const { postBookingMessages } = load("convex/chat.ts");
  const account = put("accounts", { email: "stage@rental-test.invalid" });
  const fx3Listing = put("listings", { r2Images: ["https://assets.example/sony-fx3.webp"], sourceImages: ["https://source.example/sony-fx3.jpg"] });
  put("settings", settings);
  const ctx = { db, scheduler: { runAfter: async () => {} } };
  const config = load("convex/settings.ts");
  assert.equal((await config.get.handler(ctx, {})).businessAddress, undefined, "Public settings never expose the pickup address");
  assert.equal((await config.pickupAddress.handler(ctx, {})).businessAddress, settings.businessAddress, "Verified notifications can use the internal address");
  const rental = put("bookings", { ...booking, guestEmail: account.email, accountId: account._id, lineItems: [{ ...booking.lineItems[0], listingId: fx3Listing._id, title: "Sony FX3 camera", qty: 1 }] });
  for (const status of ["pending_payment", "cancelled", "returned"]) {
    await db.patch(rental._id, { status });
    await postBookingMessages.handler(ctx, { bookingId: rental._id });
    assert.equal((tables.get("messages") ?? []).length, 0, `No confirmation for ${status}`);
  }
  await db.patch(rental._id, { status: "confirmed" });
  await postBookingMessages.handler(ctx, { bookingId: rental._id });
  assert.equal((tables.get("messages") ?? []).length, 0, "Unverified rentals do not receive a confirmation message");
  await db.patch(rental._id, { idVerifyStatus: "verified", verificationProvider: "didit", idVerificationSource: "didit", idVerifiedAt: Date.now(), verificationChecks: { identity: "approved", selfie: "approved", address: "approved" } });
  await postBookingMessages.handler(ctx, { bookingId: rental._id });
  assert.equal((tables.get("messages") ?? []).length, 0, "a confirmed but unpaid booking does not disclose handover details");
  await db.patch(rental._id, { paidConfirmedAt: Date.now() });
  await postBookingMessages.handler(ctx, { bookingId: rental._id });
  assert.equal(tables.get("messages").length, 1, "Confirmation retry cannot duplicate");
  assert.ok(tables.get("messages")[0].text.includes(TRAFALGAR_PICKUP_ADDRESS));
  assert.ok(tables.get("messages")[0].text.includes(TRAFALGAR_PICKUP_INSTRUCTIONS));
  assert.ok(tables.get("messages")[0].text.includes(LEO_SUPPORT_PHONE));
  assert.deepEqual(tables.get("messages")[0].meta.items, [{ title: "Sony FX3 camera", qty: 1, heroImage: "https://assets.example/sony-fx3.webp", imageSources: ["https://assets.example/sony-fx3.webp", "https://source.example/sony-fx3.jpg"] }], "The confirmation card uses the actual approved listing gallery for the booked equipment");
  assert.equal(tables.get("messages")[0].meta.itemCount, 1);
  assert.match(tables.get("messages")[0].text, /10:30/);
  assert.match(tables.get("messages")[0].text, /16:00/);
  assert.equal(tables.get("messages")[0].accountId, account._id, "an account-owned booking receives the automatic confirmation in its chat");
  const manualRental = put("bookings", { ...booking, accountId: account._id, guestEmail: account.email, status: "confirmed", paidConfirmedAt: Date.now(), idVerifyStatus: "verified", idVerificationSource: "manual", idVerifiedAt: Date.now(), lineItems: [{ start: Date.UTC(2027,3,1), end: Date.UTC(2027,3,2) }] });
  await postBookingMessages.handler(ctx, { bookingId: manualRental._id });
  assert.equal(tables.get("messages").length, 1, "a legacy/manual verification label cannot bypass Didit approval");
  const untrackedApproval = put("bookings", { ...booking, accountId: account._id, guestEmail: account.email, status: "confirmed", paidConfirmedAt: Date.now(), idVerifyStatus: "verified", idVerificationSource: undefined });
  await postBookingMessages.handler(ctx, { bookingId: untrackedApproval._id });
  assert.equal(tables.get("messages").length, 1, "a legacy verified label without an approval source cannot disclose handover details");
  const diditWithManualSource = put("bookings", {
    ...booking,
    accountId: account._id,
    guestEmail: account.email,
    status: "confirmed",
    paidConfirmedAt: Date.now(),
    idVerifyStatus: "verified",
    verificationProvider: "didit",
    idVerificationSource: "manual",
    idVerifiedAt: Date.now(),
    verificationChecks: { identity: "approved", selfie: "approved", address: "waiting" },
  });
  await postBookingMessages.handler(ctx, { bookingId: diditWithManualSource._id });
  assert.equal(tables.get("messages").length, 1, "Didit bookings cannot use the legacy manual-source fallback to disclose pickup details");
  const reviewedGuestEmail = "guest-confirmed@rental-test.invalid";
  const reviewedGuest = put("accounts", { email: reviewedGuestEmail });
  const reviewedGuestRental = put("bookings", {
    guestEmail: reviewedGuestEmail.toUpperCase(), status: "active", fulfilment: "delivery", deliveryLegs: "one_way",
    pickupTime: "09:00", returnTime: "17:00", paidConfirmedAt: Date.now(), idVerifyStatus: "verified",
    verificationProvider: "didit", idVerificationSource: "didit", idVerifiedAt: Date.now(), diditManualDecisionAt: Date.now(),
    verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
    lineItems: [
      { start: Date.UTC(2027, 3, 3), end: Date.UTC(2027, 3, 4) },
      { start: Date.UTC(2027, 3, 4), end: Date.UTC(2027, 3, 5) },
    ],
  });
  await postBookingMessages.handler(ctx, { bookingId: reviewedGuestRental._id });
  const guestConfirmation = tables.get("messages")[1];
  assert.equal(guestConfirmation.accountId, reviewedGuest._id, "a guest booking is routed to the account matched by its normalized email");
  assert.ok(guestConfirmation.text.includes(TRAFALGAR_PICKUP_ADDRESS), "a final Didit-approved one-way delivery confirms the agreed Trafalgar return point");
  assert.ok(guestConfirmation.text.includes(TRAFALGAR_PICKUP_INSTRUCTIONS));
  assert.ok(guestConfirmation.text.includes(LEO_SUPPORT_PHONE));
  assert.match(guestConfirmation.text, /3 Apr 2027/);
  assert.match(guestConfirmation.text, /5 Apr 2027/);
  await postBookingMessages.handler(ctx, { bookingId: reviewedGuestRental._id });
  assert.equal(tables.get("messages").length, 2, "a delayed/retried approval event cannot duplicate the guest confirmation");
  const malformedRental = put("bookings", {
    ...completeDiditRental, accountId: account._id, guestEmail: account.email, lineItems: [], chatConfirmationMessageId: undefined,
  });
  await postBookingMessages.handler(ctx, { bookingId: malformedRental._id });
  assert.equal(tables.get("messages").length, 2, "a malformed booking without dated line items cannot issue a misleading confirmation");
  console.log("PASS confirmation transaction: payment and final Didit gate, account/guest routing, single/multi-item dates, Trafalgar details, and retry idempotency.");
})().catch(error => { console.error(error); process.exitCode = 1; });

const {groupRentalKit,uniqueKitPhotos}=load("src/lib/rentalKit.ts");
const kit=[{listingId:"camera",title:"Camera",start:1,end:2,qty:1,lineTotal:100,heroImage:"/camera.jpg"},{listingId:"camera",title:"Camera",start:1,end:2,qty:2,lineTotal:200,heroImage:"/camera.jpg"},{listingId:"camera",title:"Camera",start:3,end:4,qty:1,lineTotal:50,heroImage:"/camera.jpg"},{listingId:"lens",title:"Lens",start:1,end:2,qty:1,lineTotal:50,heroImage:"/camera.jpg"}];
const groupedKit=groupRentalKit(kit);assert.equal(groupedKit.length,3);assert.equal(groupedKit[0].qty,3);assert.equal(groupedKit[0].lineTotal,300);assert.equal(uniqueKitPhotos(groupedKit).length,3,"separate rental periods and distinct listings remain visible even when their image URLs match");assert.equal(kit[0].qty,1,"display grouping cannot mutate order");
