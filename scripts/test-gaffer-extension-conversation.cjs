const assert = require("node:assert/strict");
const { load, db, put, tables, setMock, putFreshSharedStock } = require("./lib/rentalTestHarness.cjs");
putFreshSharedStock();

const intent = load("shared/rentalExtensionConversation.ts");
assert.deepEqual(intent.parseRentalExtensionIntent("Can I extend the kit by two days?"), { requested: true, extraDays: 2 });
assert.deepEqual(intent.parseRentalExtensionIntent("I need one more night for the rental"), { requested: true, extraDays: 1 });
assert.deepEqual(intent.parseRentalExtensionIntent("Can I keep the camera until Friday?"), { requested: true, extraDays: null });
assert.deepEqual(intent.parseRentalExtensionIntent("Can I keep the camera 3 more days?"), { requested: true, extraDays: 3 });
assert.deepEqual(intent.parseRentalExtensionIntent("Can I hold the lens for two more nights?"), { requested: true, extraDays: 2 });
assert.deepEqual(intent.parseRentalExtensionIntent("Can I keep my rental for one week?"), { requested: true, extraDays: 7 });
assert.deepEqual(intent.parseRentalExtensionIntent("2 days", "How many extra days would you like?"), { requested: true, extraDays: 2 }, "a short duration answer is interpreted from Gaffer's immediately preceding clarification");
assert.deepEqual(intent.parseRentalExtensionIntent("2", "How many extra days would you like?"), { requested: true, extraDays: 2 }, "a bare number is accepted only after Gaffer explicitly asks for the duration");
assert.deepEqual(intent.parseRentalExtensionIntent("2 days"), { requested: false, extraDays: null }, "a duration alone does not accidentally change a rental without extension context");
assert.deepEqual(intent.parseRentalExtensionIntent("2", "Which camera would you like to extend?"), { requested: false, extraDays: null }, "a bare number is not treated as a rental change after a different question");
assert.deepEqual(intent.parseRentalExtensionIntent("Do you rent extension cords?"), { requested: false, extraDays: null });
assert.deepEqual(intent.parseRentalExtensionIntent("I need to extend my subscription"), { requested: false, extraDays: null });
assert.deepEqual(intent.parseRentalExtensionIntent("Please extend the camera two days and the lens three days"), { requested: true, extraDays: null }, "different durations require clarification rather than an invented common quote");
assert.deepEqual(intent.parseRentalExtensionIntent("Can I keep the camera two days and the lens three days?"), { requested: true, extraDays: null }, "different durations in keep-item wording still open clarification");
assert.deepEqual(intent.rentalExtensionItemSelection("Can I extend the lens for two days?", [
  { index: 0, title: "Sony FX3 camera" }, { index: 1, title: "Sony 24-70mm lens" },
]), { kind: "selected", lineIndexes: [1] }, "a specific item name resolves only to its booking line");
assert.equal(intent.rentalExtensionItemSelection("Can I extend the Sony for two days?", [
  { index: 0, title: "Sony FX3 camera" }, { index: 1, title: "Sony 24-70mm lens" },
]).kind, "clarify", "a shared product term asks which matching item instead of quoting both silently");
assert.deepEqual(intent.rentalExtensionItemSelection("Can I extend the Sony FX3 camera and the lens for two days?", [
  { index: 0, title: "Sony FX3 camera" }, { index: 1, title: "Sony 24-70mm lens" },
]), { kind: "selected", lineIndexes: [0, 1] }, "each explicitly named item remains selected even if one has more matching words");
assert.equal(intent.rentalExtensionItemSelection("Can I extend the camera and the lens for two days?", [
  { index: 0, title: "Sony camera" }, { index: 1, title: "Canon camera" }, { index: 2, title: "Sony lens" },
]).kind, "clarify", "a conjunction never silently selects multiple items when one named type is ambiguous");

setMock("@openrouter/ai-sdk-provider", { createOpenRouter: () => () => ({}) });
setMock("ai", { generateObject: async () => { throw new Error("The extension intent path must not call a model."); } });
setMock("zod", require("zod"));
let stripeCreates = 0;
let stripeSession;
class StripeFixture {
  checkout = { sessions: {
    create: async (params) => { stripeCreates++; stripeSession = { id: "cs_earned_extension", url: "https://checkout.stripe.com/earned-extension", status: "open", amount_total: params.line_items[0].price_data.unit_amount, metadata: params.metadata }; return stripeSession; },
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
const priorCleanReturnAt = Date.now() - 2 * 86400000;
put("bookings", {
  accountId: account._id,
  guestEmail: account.email,
  status: "returned",
  paidConfirmedAt: priorCleanReturnAt - 86400000,
  pickedUpAt: priorCleanReturnAt - 86400000,
  returnedAt: priorCleanReturnAt,
  actualReturnedAt: priorCleanReturnAt,
  lineItems: [{ title: "Earlier clean rental", start: priorCleanReturnAt - 86400000, end: priorCleanReturnAt, qty: 1, lineTotal: 10 }],
  returnDecision: {
    actualReturnedAt: priorCleanReturnAt,
    damageKept: 0,
    depositKept: 0,
    chargeLate: false,
    inspection: [{ key: "earlier-camera", title: "Camera", condition: "good", details: "", openCase: false }],
  },
});
const cameraUnit = put("inventory_units", { name: "Camera", quantityOwned: 4 });
const lensUnit = put("inventory_units", { name: "Lens", quantityOwned: 1 });
const alternateUnit = put("inventory_units", { name: "Alternative lens", quantityOwned: 3 });
const camera = put("listings", {
  active: true, category: "camera", title: "Camera body", slug: "camera-body", itemType: "camera-body", depositAmount: 200,
  specs: { mount: "E", coverage: "ff" },
  pricing: { daily: 10 }, components: [{ inventoryUnitId: cameraUnit._id, qty: 1 }],
  reviewedImageUrls: ["https://cdn.example.invalid/camera-reviewed.jpg"],
});
const lens = put("listings", {
  active: true, category: "lens", title: "Booked lens", slug: "booked-lens", depositAmount: 100,
  pricing: { daily: 8 }, components: [{ inventoryUnitId: lensUnit._id, qty: 1 }],
  reviewedImageUrls: ["https://cdn.example.invalid/booked-lens.jpg"],
});
const alternate = put("listings", {
  active: true, category: "lens", title: "Available alternative lens", slug: "alternative-lens", itemType: "lens", depositAmount: 150,
  specs: { mount: "E", coverage: "ff", tier: "premium", lensClass: "af", lensFocal: "24-70" },
  pricing: { daily: 12 }, components: [{ inventoryUnitId: alternateUnit._id, qty: 1 }],
  reviewedImageUrls: ["https://cdn.example.invalid/alternative-lens.jpg"],
});
const incompatibleAlternateUnit = put("inventory_units", { name: "Incompatible alternative lens", quantityOwned: 3 });
const incompatibleAlternate = put("listings", {
  active: true, category: "lens", title: "Wrong-mount RF alternative", slug: "wrong-mount-rf-lens", itemType: "lens", depositAmount: 150,
  specs: { mount: "RF", coverage: "ff", tier: "premium", lensClass: "af", lensFocal: "24-70" },
  pricing: { daily: 12 }, components: [{ inventoryUnitId: incompatibleAlternateUnit._id, qty: 1 }], demandScore: 999,
  reviewedImageUrls: ["https://cdn.example.invalid/wrong-mount-rf-lens.jpg"],
});
const currentDate = new Date();
const daysUntilFriday = ((5 - currentDate.getUTCDay() + 7) % 7) || 7;
const end = Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate() + daysUntilFriday);
const start = end - 86400000; // Friday end; the two extension days are Saturday and Sunday.
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
    if (reference === "chat._gafferContext") return { ...context, messages: [
      ...(context.priorGafferText ? [{ _id: "message-extension-prior", sender: "bot", text: context.priorGafferText }] : []),
      { _id: "message-extension-1", sender: "renter", text: context.renterText },
    ], latestRenterId: "message-extension-1" };
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
  assert(!offer.unavailableItems[0].alternatives.some(item => item.listingId === incompatibleAlternate._id), "an available but wrong-mount alternative is never offered for this Sony camera kit");
  assert.equal(offer.approvalRequired, true);
  assert.equal(offer.paymentLinkAfterApprovalOnly, true);
  assert.equal(offer.datesChanged, false);
  assert.match(replies[0].text, /original deadline/i);
  assert.equal((tables.get("booking_change_requests") ?? []).length, 0, "a Gaffer preview never submits a request");
  assert.equal(booking.lineItems[0].end, end, "a preview never changes the booking");
  assert.equal(booking.lineItems[1].end, end, "an unavailable item keeps its original deadline");
  assert.equal(Object.hasOwn(offer, "url"), false, "a preview never includes a payment link");

  replies = await ask("Can I extend the camera body and the lens by two days?");
  assert.equal(replies[0].meta.extensionOffer.quoteStatus, "partial", "an explicit multi-item request includes both the available camera and unavailable lens");
  assert.deepEqual(replies[0].meta.extensionOffer.availableIndexes, [0]);
  assert.deepEqual(replies[0].meta.extensionOffer.unavailableItems.map(item => item.title), [lens.title], "the unavailable named item keeps its original return deadline in the offer");
  replies = await ask("Please extend the camera two days and the lens three days");
  assert.equal(replies[0].meta.extensionOffer.quoteStatus, "duration_required", "different durations are clarified before any price or availability claim");
  assert.equal(Object.hasOwn(replies[0].meta.extensionOffer, "total"), false);

  const paidPendingBooking = put("bookings", {
    status: "pending_verification",
    checkoutPaidAt: Date.now(),
    verificationProvider: "didit",
    lineItems: [{ listingId: camera._id, title: camera.title, qty: 3, start: end + 86400000, end: end + 2 * 86400000 }],
  });
  const paidPendingReservation = put("reservations", {
    bookingId: paidPendingBooking._id,
    listingId: camera._id,
    inventoryUnitId: cameraUnit._id,
    qty: 3,
    start: end + 86400000,
    end: end + 2 * 86400000,
    status: "hold",
    source: "site",
    holdExpiresAt: Date.now() + 60000,
  });
  replies = await ask("Can I extend only the camera by two days?");
  const paidHoldOffer = replies[0].meta.extensionOffer;
  assert.equal(paidHoldOffer.quoteStatus, "unavailable", "A paid pending-verification booking reserves extension stock");
  assert.equal(paidHoldOffer.unavailableItems[0].title, camera.title);
  assert.equal(paidHoldOffer.unavailableItems[0].originalEnd, end, "The unavailable item retains its original return date");
  assert.equal(paidHoldOffer.unavailableItems[0].originalReturnTime, "17:00", "The unavailable item retains its original return time");
  assert.match(replies[0].text, /original deadline/i);
  assert.equal(booking.lineItems[0].end, end, "A stock-checked extension suggestion never changes the current booking");
  delete paidPendingBooking.checkoutPaidAt;
  replies = await ask("Can I extend only the camera by two days?");
  assert.deepEqual(replies[0].meta.extensionOffer.availableIndexes, [0], "An unpaid pending basket does not consume extension stock");
  paidPendingReservation.status = "cancelled";

  replies = await ask("Can I keep the camera 3 more days?");
  assert.equal(replies[0].meta.extensionOffer.extraDays, 3, "natural keep-item duration wording reaches the live extension quote");
  assert.equal(replies[0].meta.extensionOffer.quoteStatus, "available", "an item-specific request prices only the named camera");
  assert.deepEqual(replies[0].meta.extensionOffer.availableIndexes, [0]);

  replies = await ask("Can I extend the booked lens by two days?");
  assert.equal(replies[0].meta.extensionOffer.quoteStatus, "unavailable", "a specifically requested unavailable item is not replaced by another available basket item");
  assert.deepEqual(replies[0].meta.extensionOffer.unavailableItems.map(item => item.title), [lens.title]);
  assert.equal(replies[0].meta.extensionOffer.items.length, 0, "the available camera is not quoted when only the lens was requested");
  assert.match(replies[0].text, /original deadline/i);

  replies = await ask("Can I extend only the camera by two days?");
  assert.equal(replies[0].meta.extensionOffer.quoteStatus, "available", "the exact selected line gets its own quote");
  assert.deepEqual(replies[0].meta.extensionOffer.availableIndexes, [0]);
  assert.deepEqual(replies[0].meta.extensionOffer.items.map(item => item.title), [camera.title]);

  replies = await ask("Can I extend the projector by two days?");
  assert.equal(replies[0].meta?.extensionOffer, undefined, "an item not in the current rental never falls back to quoting the full basket");
  assert.match(replies[0].text, /couldn’t match that item/i);
  assert.match(replies[0].text, /Nothing has changed/i);

  replies = await ask("Can I keep this booking until Friday?");
  const durationOffer = replies[0].meta.extensionOffer;
  assert.equal(durationOffer.quoteStatus, "duration_required");
  assert.equal(durationOffer.items.length, 2);
  assert(durationOffer.items.every(item => item.availability === "unchecked"));
  assert.equal(Object.hasOwn(durationOffer, "total"), false, "no duration means no invented quote");
  assert.equal((tables.get("booking_change_requests") ?? []).length, 0);

  context.priorGafferText = replies[0].text;
  assert.match(context.priorGafferText, /How many extra days would you like/i);
  const previewsBeforeDurationAnswer = previewCalls;
  replies = await ask("2 days");
  assert.equal(previewCalls, previewsBeforeDurationAnswer + 1, "a duration follow-up runs the same live stock-and-price preview");
  assert.equal(replies[0].meta.extensionOffer.extraDays, 2);
  assert.equal(replies[0].meta.extensionOffer.quoteStatus, "partial", "the duration follow-up preserves the partial-stock boundary");
  context.priorGafferText = "";

  const beforePreviewCalls = previewCalls;
  replies = await ask("Do you rent extension cords?");
  assert.equal(previewCalls, beforePreviewCalls, "extension cords must not trigger rental extension quoting");
  assert.equal(replies[0].meta?.extensionOffer, undefined);

  const conflictPool = put("inventory_units", { name: "Shared extension pool", quantityOwned: 4 });
  const conflictCamera = put("listings", {
    active: true, category: "camera", title: "Conflict test camera", slug: "conflict-test-camera", itemType: "camera-body",
    depositAmount: 200, specs: { mount: "E", coverage: "ff" }, pricing: { daily: 10 }, components: [{ inventoryUnitId: conflictPool._id, qty: 1 }],
    reviewedImageUrls: ["https://cdn.example.invalid/conflict-camera.jpg"],
  });
  const conflictLens = put("listings", {
    active: true, category: "lens", title: "Conflict test lens", slug: "conflict-test-lens", itemType: "lens",
    depositAmount: 100, specs: { mount: "E", coverage: "ff", tier: "premium", lensClass: "af", lensFocal: "24-70" },
    pricing: { daily: 8 }, components: [{ inventoryUnitId: conflictPool._id, qty: 1 }],
    reviewedImageUrls: ["https://cdn.example.invalid/conflict-lens.jpg"],
  });
  const unbookableAlternative = put("listings", {
    active: true, category: "lens", title: "Unbookable shared-pool lens", slug: "unbookable-shared-pool-lens", itemType: "lens", demandScore: 1000,
    depositAmount: 100, specs: { mount: "E", coverage: "ff", tier: "premium", lensClass: "af", lensFocal: "24-70" },
    pricing: { daily: 9 }, components: [{ inventoryUnitId: conflictPool._id, qty: 1 }],
    reviewedImageUrls: ["https://cdn.example.invalid/unbookable-alternative.jpg"],
  });
  const conflictAlternativePool = put("inventory_units", { name: "Bookable alternative lens pool", quantityOwned: 1 });
  const conflictAlternative = put("listings", {
    active: true, category: "lens", title: "Bookable conflict alternative", slug: "bookable-conflict-alternative", itemType: "lens",
    depositAmount: 100, specs: { mount: "E", coverage: "ff", tier: "premium", lensClass: "af", lensFocal: "24-70" },
    pricing: { daily: 8 }, components: [{ inventoryUnitId: conflictAlternativePool._id, qty: 1 }],
    reviewedImageUrls: ["https://cdn.example.invalid/bookable-conflict-alternative.jpg"],
  });
  const conflictEnd = end + 10 * 86400000;
  const conflictStart = conflictEnd - 86400000;
  const conflictBooking = put("bookings", {
    ...approval, accountId: account._id, guestEmail: account.email, status: "active", pickupTime: "10:00", returnTime: "17:00",
    lineItems: [
      { listingId: conflictCamera._id, title: conflictCamera.title, qty: 1, start: conflictStart, end: conflictEnd, returnTime: "17:00" },
      { listingId: conflictLens._id, title: conflictLens.title, qty: 1, start: conflictStart, end: conflictEnd, returnTime: "16:00" },
    ], subtotal: 18, total: 18, depositAmount: 0,
  });
  put("reservations", { bookingId: conflictBooking._id, listingId: conflictCamera._id, inventoryUnitId: conflictPool._id, qty: 1, start: conflictStart, end: conflictEnd, status: "active", source: "site" });
  put("reservations", { bookingId: conflictBooking._id, listingId: conflictLens._id, inventoryUnitId: conflictPool._id, qty: 1, start: conflictStart, end: conflictEnd, status: "active", source: "site" });
  put("reservations", { bookingId: "external-shared-pool-rental", inventoryUnitId: conflictPool._id, qty: 3, start: conflictEnd + 86400000, end: conflictEnd + 3 * 86400000, status: "confirmed", source: "site" });
  const conflictOffer = await extensions.gafferPreview.handler(dbContext, { accountId: account._id, bookingId: conflictBooking._id, extraDays: 2 });
  assert.equal(conflictOffer.quoteStatus, "partial", "live capacity allows one item but blocks the combined extension");
  assert.deepEqual(conflictOffer.availableIndexes, [0], "the individually bookable camera remains in the available set");
  assert.equal(conflictOffer.items.some(item => item.index === 1), false, "the conflicting original lens is not mislabeled as extendable");
  assert.equal(conflictOffer.unavailableItems[0].index, 1);
  assert.equal(conflictOffer.unavailableItems[0].originalEnd, conflictEnd, "the conflicting original retains its agreed return date");
  assert.equal(conflictOffer.unavailableItems[0].originalReturnTime, "16:00", "the conflicting original retains its agreed return time");
  assert.match(conflictOffer.unavailableItems[0].reason, /conflicts with another selected item/i);
  const suggestedIds = conflictOffer.unavailableItems[0].alternatives.map(item => String(item.listingId));
  assert(suggestedIds.length > 0, "a combination-capacity conflict offers checked alternatives");
  assert.equal(suggestedIds.includes(String(unbookableAlternative._id)), false, "an alternative that fails the combined live stock check is never suggested");
  assert(suggestedIds.includes(String(conflictAlternative._id)), "a compatible alternative that passes the combined live stock check is suggested");
  assert(conflictOffer.unavailableItems[0].alternatives.every(item => item.availability === "available" && item.informationalOnly === true), "alternatives remain informational and stock-checked");
  assert.equal(conflictBooking.lineItems[0].end, conflictEnd, "an alternative preview leaves the available item's return date unchanged");
  assert.equal(conflictBooking.lineItems[1].end, conflictEnd, "an alternative preview leaves the conflicting item's original due date unchanged");

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
  assert.equal(zeroQuote.priceDelta, 10, "a stale 100% cached Encore field is not trusted without the server's clean completed-rental history");
  const zeroRequest = await extensions.request.handler(dbContext, {
    token: "encore-zero", bookingId: zeroBooking._id, requestKey: "fixture-zero-extension-0001",
    extraDays: 2, expectedAmount: 10, expectedBase: zeroQuote.baseLines, requestedReturnTime: "17:00",
  });
  const zeroPending = await db.get(zeroRequest.requestId);
  assert.equal(zeroPending.status, "pending");
  assert.equal(zeroPending.stripePaymentLinkId, undefined);
  const zeroRequestMessage = (tables.get("messages") ?? []).find(message => message.bookingId === zeroBooking._id && message.meta?.kind === "extension_request");
  assert.match(zeroRequestMessage.text, /until approval and payment\./, "the server-resolved nonzero quote correctly signals payment after approval");
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
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  const approved = await extensionPayments.approve.handler(ownerContext, {
    token: process.env.ADMIN_TOKEN, requestId: zeroRequest.requestId, reason: "Approved priced extension",
  });
  assert.equal(approved.ok, true);
  const approvedPrice = await db.get(zeroRequest.requestId);
  assert.equal(approvedPrice.status, "awaiting_payment");
  assert.equal(approvedPrice.priceDelta, 10);
  assert.equal(approvedPrice.paymentLinkUrl, "https://checkout.stripe.com/earned-extension");
  assert.equal(stripeSession.amount_total, 1000, "Stripe payment link uses the same server-computed price as the renter quote");
  assert.equal(zeroBooking.lineItems[0].end, zeroEnd, "approval and payment-link creation do not change rental dates");
  assert.equal(zeroBooking.total, 110);
  assert.equal(stripeCreates, 1);
  const paymentMessage = (tables.get("messages") ?? []).find(message => message.bookingId === zeroBooking._id && message.meta?.kind === "extension_payment");
  assert.equal(paymentMessage.meta.amount, 10, "the chat payment offer and Stripe amount match the quote");

  console.log("Gaffer extensions: explicit and ambiguous duration intent, mixed live stock, original deadlines, canonical images, alternatives, active membership prices, stale Encore rejection, and quote/chat/Stripe payment parity.");

})().catch(error => { console.error(error); process.exitCode = 1; });
