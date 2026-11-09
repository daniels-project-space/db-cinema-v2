const assert = require("node:assert/strict");
const { load, db, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");

const intent = load("shared/rentalExtensionConversation.ts");
assert.deepEqual(intent.parseRentalExtensionIntent("Can I extend the kit by two days?"), { requested: true, extraDays: 2 });
assert.deepEqual(intent.parseRentalExtensionIntent("I need one more night for the rental"), { requested: true, extraDays: 1 });
assert.deepEqual(intent.parseRentalExtensionIntent("Can I keep the camera until Friday?"), { requested: true, extraDays: null });
assert.deepEqual(intent.parseRentalExtensionIntent("Do you rent extension cords?"), { requested: false, extraDays: null });
assert.deepEqual(intent.parseRentalExtensionIntent("I need to extend my subscription"), { requested: false, extraDays: null });

setMock("@openrouter/ai-sdk-provider", { createOpenRouter: () => () => ({}) });
setMock("ai", { generateObject: async () => { throw new Error("The extension intent path must not call a model."); } });
setMock("zod", require("zod"));
let stripeCreates = 0;
class StripeFixture {
  checkout = { sessions: {
    create: async () => { stripeCreates++; return { id: "cs_unexpected_zero", url: "https://checkout.stripe.com/unexpected", status: "open" }; },
    retrieve: async () => { throw new Error("A zero-balance extension must not retrieve Stripe."); },
    list: async function* () {},
  } };
}
setMock("stripe", { __esModule: true, default: StripeFixture });

const extensions = load("convex/rentalExtensions.ts");
const extensionPayments = load("convex/rentalExtensionPayments.ts");
const { gafferReply } = load("convex/gaffer.ts");
const account = put("accounts", {
  email: "gaffer-extension@example.invalid",
  membershipActive: true,
  membershipStatus: "active",
  membershipPaidThrough: Date.now() + 30 * 86400000,
  membershipTier: "pro",
  stripeSubscriptionId: "sub_gaffer_extension_fixture",
});
const cameraUnit = put("inventory_units", { name: "Camera", quantityOwned: 4 });
const lensUnit = put("inventory_units", { name: "Lens", quantityOwned: 1 });
const alternateUnit = put("inventory_units", { name: "Alternative lens", quantityOwned: 3 });
const camera = put("listings", {
  active: true, category: "camera", title: "Camera body", slug: "camera-body", depositAmount: 200,
  pricing: { daily: 10 }, components: [{ inventoryUnitId: cameraUnit._id, qty: 1 }],
  reviewedImageUrls: ["https://cdn.example.invalid/camera-reviewed.jpg"],
});
const lens = put("listings", {
  active: true, category: "lens", title: "Booked lens", slug: "booked-lens", depositAmount: 100,
  pricing: { daily: 8 }, components: [{ inventoryUnitId: lensUnit._id, qty: 1 }],
  reviewedImageUrls: ["https://cdn.example.invalid/booked-lens.jpg"],
});
const alternate = put("listings", {
  active: true, category: "lens", title: "Available alternative lens", slug: "alternative-lens", depositAmount: 150,
  pricing: { daily: 12 }, components: [{ inventoryUnitId: alternateUnit._id, qty: 1 }],
  reviewedImageUrls: ["https://cdn.example.invalid/alternative-lens.jpg"],
});
const start = Date.UTC(2026, 10, 12);
const end = Date.UTC(2026, 10, 13); // Friday; the two extension days are Saturday and Sunday.
const approval = {
  paidConfirmedAt: Date.now() - 1000,
  verificationProvider: "didit",
  idVerifyStatus: "verified",
  idVerificationSource: "didit",
  idVerifiedAt: Date.now() - 1000,
  verificationExpiresAt: Date.now() + 90 * 86400000,
  verificationChecks: { identity: "approved", selfie: "approved", address: "approved" },
};
const lines = [
  { listingId: camera._id, title: camera.title, qty: 2, start, end, returnTime: "17:00", lineTotal: 40 },
  { listingId: lens._id, title: lens.title, qty: 1, start, end, returnTime: "16:00", lineTotal: 16 },
];
const booking = put("bookings", {
  ...approval, accountId: account._id, guestEmail: account.email, status: "active",
  lineItems: lines, pickupTime: "10:00", returnTime: "17:00", subtotal: 56, total: 156,
  depositAmount: 100,
});
put("reservations", { bookingId: booking._id, listingId: camera._id, inventoryUnitId: cameraUnit._id, qty: 2, start, end, status: "active", source: "site" });
put("reservations", { bookingId: booking._id, listingId: lens._id, inventoryUnitId: lensUnit._id, qty: 1, start, end, status: "active", source: "site" });
put("reservations", {
  bookingId: "other-confirmed-rental", listingId: lens._id, inventoryUnitId: lensUnit._id,
  qty: 1, start: end + 2 * 86400000, end: end + 3 * 86400000, status: "confirmed", source: "site",
});

let previewCalls = 0;
const context = {
  escalated: false,
  gafferGeneration: 4,
  latestRenterId: "message-extension-1",
  messages: [],
  booking: {
    stage: "active",
    items: lines.map((line, index) => ({ index, title: line.title, qty: line.qty, end: "2026-11-13", returnTime: line.returnTime })),
    pendingExtension: null,
    changeLocked: false,
  },
};
const posts = [];
const actionContext = {
  runQuery: async (reference, args) => {
    if (reference === "chat._gafferContext") return { ...context, messages: [{ _id: "message-extension-1", sender: "renter", text: context.renterText }], latestRenterId: "message-extension-1" };
    if (reference === "rentalExtensions.gafferPreview") {
      previewCalls++;
      return extensions.gafferPreview.handler(dbContext, args);
    }
    throw new Error("Unexpected query: " + reference);
  },
  runMutation: async (reference, args) => {
    assert.equal(reference, "chat._postBot");
    posts.push(args);
    return true;
  },
};
const dbContext = { db, scheduler: { runAfter: async () => {} } };

async function ask(text) {
  context.renterText = text;
  const beforePosts = posts.length;
  await gafferReply.handler(actionContext, { accountId: account._id, bookingId: booking._id, messageId: "message-extension-1" });
  return posts.slice(beforePosts);
}

(async () => {
  let replies = await ask("Can I extend the kit by two days?");
  assert.equal(replies.length, 1);
  const offer = replies[0].meta.extensionOffer;
  assert.equal(offer.quoteStatus, "partial");
  assert.deepEqual(offer.availableIndexes, [0]);
  assert.equal(offer.total, 20, "the displayed total applies the Pro weekend saving");
  assert.equal(offer.benefit.saving, 20);
  assert.equal(offer.items.length, 1);
  assert.equal(offer.items[0].listingId, camera._id);
  assert.equal(offer.items[0].imageSources[0], "https://cdn.example.invalid/camera-reviewed.jpg");
  assert.equal(offer.items[0].originalEnd, end);
  assert.equal(offer.items[0].originalReturnTime, "17:00");
  assert.equal(offer.items[0].proposedEnd, end + 2 * 86400000);
  assert.equal(offer.unavailableItems.length, 1);
  assert.equal(offer.unavailableItems[0].title, lens.title);
  assert.equal(offer.unavailableItems[0].originalEnd, end);
  assert.equal(offer.unavailableItems[0].originalReturnTime, "16:00");
  assert.equal(offer.unavailableItems[0].imageSources[0], "https://cdn.example.invalid/booked-lens.jpg");
  assert.equal(offer.unavailableItems[0].alternatives[0].listingId, alternate._id);
  assert.equal(offer.unavailableItems[0].alternatives[0].imageSources[0], "https://cdn.example.invalid/alternative-lens.jpg");
  assert.equal(offer.unavailableItems[0].alternatives[0].availability, "available");
  assert.equal(offer.unavailableItems[0].alternatives[0].informationalOnly, true);
  assert.equal(offer.unavailableItems[0].alternatives[0].total, 12, "alternative price uses the same active member benefit");
  assert.equal(offer.approvalRequired, true);
  assert.equal(offer.paymentLinkAfterApprovalOnly, true);
  assert.equal(offer.datesChanged, false);
  assert.match(replies[0].text, /original deadline/i);
  assert.equal((tables.get("booking_change_requests") ?? []).length, 0, "a Gaffer preview never submits a request");
  assert.equal(booking.lineItems[0].end, end, "a preview never changes the booking");
  assert.equal(booking.lineItems[1].end, end, "an unavailable item keeps its original deadline");
  assert.equal(Object.hasOwn(offer, "url"), false, "a preview never includes a payment link");

  replies = await ask("Can I keep this booking until Friday?");
  const durationOffer = replies[0].meta.extensionOffer;
  assert.equal(durationOffer.quoteStatus, "duration_required");
  assert.equal(durationOffer.items.length, 2);
  assert(durationOffer.items.every(item => item.availability === "unchecked"));
  assert.equal(Object.hasOwn(durationOffer, "total"), false, "no duration means no invented quote");
  assert.equal((tables.get("booking_change_requests") ?? []).length, 0);

  const beforePreviewCalls = previewCalls;
  replies = await ask("Do you rent extension cords?");
  assert.equal(previewCalls, beforePreviewCalls, "extension cords must not trigger rental extension quoting");
  assert.equal(replies[0].meta?.extensionOffer, undefined);

  // A fully discounted extension still requires staff approval, but after approval it must settle without a zero-value Stripe Checkout.
  delete process.env.STRIPE_SECRET_KEY;
  process.env.RENTAL_CHECKOUT_ENABLED = "false";
  process.env.ADMIN_TOKEN = "fixture-zero-extension-admin";
  const encore = put("accounts", { email: "encore-zero@example.invalid", loyaltyEligible: true, loyaltyPercent: 100 });
  put("sessions", { accountId: encore._id, token: "encore-zero", expiresAt: Date.now() + 86400000 });
  const zeroUnit = put("inventory_units", { name: "Zero-price extension unit", quantityOwned: 2 });
  const zeroListing = put("listings", {
    active: true, category: "camera", title: "Zero-price extension camera", slug: "zero-price-camera",
    depositAmount: 100, pricing: { daily: 5 }, components: [{ inventoryUnitId: zeroUnit._id, qty: 1 }],
    reviewedImageUrls: ["https://cdn.example.invalid/zero-price-camera.jpg"],
  });
  const zeroStart = Date.UTC(2026, 11, 1), zeroEnd = Date.UTC(2026, 11, 2);
  const zeroBooking = put("bookings", {
    ...approval, accountId: encore._id, guestEmail: encore.email, status: "active",
    lineItems: [{ listingId: zeroListing._id, title: zeroListing.title, qty: 1, start: zeroStart, end: zeroEnd, returnTime: "17:00" }],
    pickupTime: "10:00", returnTime: "17:00", subtotal: 10, total: 110, depositAmount: 100,
  });
  put("reservations", { bookingId: zeroBooking._id, listingId: zeroListing._id, inventoryUnitId: zeroUnit._id, qty: 1, start: zeroStart, end: zeroEnd, status: "active", source: "site" });
  const zeroQuote = await extensions.quote.handler(dbContext, { token: "encore-zero", bookingId: zeroBooking._id, extraDays: 2 });
  assert.equal(zeroQuote.priceDelta, 0, "the fixture represents a fully discounted, zero-difference extension");
  const zeroRequest = await extensions.request.handler(dbContext, {
    token: "encore-zero", bookingId: zeroBooking._id, requestKey: "fixture-zero-extension-0001",
    extraDays: 2, expectedAmount: 0, expectedBase: zeroQuote.baseLines, requestedReturnTime: "17:00",
  });
  const zeroPending = await db.get(zeroRequest.requestId);
  assert.equal(zeroPending.status, "pending");
  assert.equal(zeroPending.stripePaymentLinkId, undefined);
  assert.equal(zeroBooking.lineItems[0].end, zeroEnd, "the renter request does not change the due date");
  const extensionModules = { rentalExtensions: extensions, rentalExtensionPayments: extensionPayments };
  const ownerContext = {
    db,
    scheduler: { runAfter: async () => {} },
    runQuery: async (reference, args) => {
      const [moduleName, functionName] = reference.split(".");
      return extensionModules[moduleName][functionName].handler(ownerContext, args);
    },
    runMutation: async (reference, args) => {
      if (reference === "adminAuth.assertAdminInternal") {
        assert.equal(args.token, process.env.ADMIN_TOKEN);
        return true;
      }
      const [moduleName, functionName] = reference.split(".");
      return extensionModules[moduleName][functionName].handler(ownerContext, args);
    },
    runAction: async (reference, args) => {
      const [moduleName, functionName] = reference.split(".");
      return extensionModules[moduleName][functionName].handler(ownerContext, args);
    },
  };
  const approved = await extensionPayments.approve.handler(ownerContext, {
    token: process.env.ADMIN_TOKEN, requestId: zeroRequest.requestId, reason: "Approved zero-balance extension",
  });
  assert.equal(approved.ok, true);
  const zeroSettled = await db.get(zeroRequest.requestId);
  assert.equal(zeroSettled.status, "applied");
  assert.equal(zeroSettled.settlementKind, "approved_zero");
  assert.equal(zeroSettled.paymentIntentId, undefined, "a zero settlement does not invent a Stripe payment intent");
  assert.equal(zeroSettled.stripePaymentLinkId, undefined);
  assert.equal(zeroSettled.paymentLinkUrl, undefined);
  assert.equal(zeroBooking.lineItems[0].end, zeroEnd + 2 * 86400000, "staff approval settles the date update");
  assert.equal(zeroBooking.total, 110);
  assert.equal(stripeCreates, 0, "zero balance never creates a Stripe session");
  const zeroMessage = (tables.get("messages") ?? []).find(message => message.bookingId === zeroBooking._id && message.sender === "system");
  assert.match(zeroMessage.text, /no additional payment due/i);

  console.log("Gaffer extensions: explicit and ambiguous duration intent, mixed live stock, original deadlines, canonical images, alternatives, active membership prices, read-only pre-approval card, and staff-approved zero-balance settlement without Stripe.");

})().catch(error => { console.error(error); process.exitCode = 1; });
