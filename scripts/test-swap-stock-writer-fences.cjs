/** Regression cases for booking/reservation writers beside an unresolved swap receipt.
 * Synthetic Convex database only; no Stripe, Didit or Rental Manager calls. */
const assert = require("node:assert/strict");
const { load, db, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");

const noop = async () => {};
setMock("./lib/adminPush", { queueOwnerNotification: noop });
setMock("./lib/rmv2SyncQueue", { queueRmv2Sync: noop });
setMock("./lib/rentalEmailQueue", { queueRentalEmail: noop });
setMock("./verificationArchive", { queueVerificationArchive: noop, assertVerificationArchive: noop });
setMock("./lib/verificationReuse", {
  VERIFICATION_REUSE_DAYS: 90,
  validReuse: () => false,
  verificationDetail: value => typeof value === "string" ? value.trim().toLowerCase() : "",
  verificationUpdateMessage: noop,
  saveAccountDiditVerification: noop,
  verificationReuseOwnerMatches: async () => false,
});
setMock("./lib/rentalAccount", { accountForRental: async () => null, belongsToRentalAccount: () => false });
setMock("./lib/rentalChat", { accountForToken: async () => null, ownedBooking: async () => null, postRentalMessage: noop });
setMock("./accountClaims", { ensurePaidBookingAccount: async () => null });
setMock("./lib/checkoutRecovery", { stopMatchingRecovery: noop, linkMatchingRecovery: noop });
setMock("./lib/rentalExposure", {
  assertRenterExposure: noop,
  renterExposure: async () => null,
  replacementValues: async () => [],
  attachRenterPerson: noop,
});

const bookings = load("convex/bookings.ts");
const ctx = { db, scheduler: { runAfter: async () => {} } };
const day = 86_400_000;
const start = Date.UTC(2030, 0, 1);
const end = start + day;
const inventory = put("inventory_units", { name: "Swap fixture camera", active: true, quantityOwned: 2 });
const listing = put("listings", {
  title: "Swap fixture camera",
  active: true,
  components: [{ inventoryUnitId: inventory._id, qty: 1 }],
});

function makePendingSwapBooking(status = "pending_verification") {
  const booking = put("bookings", {
    status,
    verificationProvider: "didit",
    diditSessionId: `didit-${status}-${Math.random()}`,
    idVerifyStatus: "processing",
    diditEventAt: 1,
    lineItems: [{ listingId: listing._id, title: listing.title, start, end, qty: 1 }],
    total: 100,
    currency: "GBP",
    stripeCheckoutSessionId: `cs-${status}-${Math.random()}`,
    stripePaymentIntentId: `pi-${status}-${Math.random()}`,
    checkoutExpectedAmountPence: 10_000,
    checkoutPaymentAmountPence: 10_000,
    checkoutPaymentCurrency: "GBP",
    checkoutPaymentStatus: "paid",
    checkoutPaidAt: Date.now(),
    idVerifiedAt: Date.now(),
    verificationExpiresAt: Date.now() + 90 * day,
  });
  const swap = put("rental_item_swaps", {
    bookingId: booking._id,
    status: "accepted",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  booking.activeItemSwapId = swap._id;
  const receipt = put("swap_stock_applied_receipts", {
    bookingId: booking._id,
    swapId: swap._id,
    deliveryState: "pending",
    stockRisk: false,
    bookingRevision: 4,
    appliedAt: Date.now(),
  });
  const reservation = put("reservations", {
    bookingId: booking._id,
    listingId: listing._id,
    inventoryUnitId: inventory._id,
    start,
    end,
    qty: 1,
    source: "site",
    status: "hold",
    externalRef: `swap:${swap._id}`,
    holdExpiresAt: Date.now() + 45 * 60_000,
  });
  // `confirm` checks the saved checkout allocation before converting holds.
  // Reproduce a valid frozen allocation whose row happens to carry the swap claim.
  const physical = [JSON.stringify([
    String(reservation.inventoryUnitId), String(reservation.listingId), reservation.start,
    reservation.end, reservation.qty, reservation.endExclusive === true,
    reservation.turnaroundBufferMinutes ?? 0,
  ])].sort();
  const lines = [JSON.stringify([
    String(listing._id), start, end, null, null, 1,
  ])].sort();
  booking.stockHoldFingerprint = JSON.stringify({ lines, physical });
  return { booking, swap, receipt, reservation };
}

async function eitherRejectOrApplySafely(run, stillFenced, label) {
  let error;
  try { await run(); } catch (caught) { error = caught; }
  const isFenced = await stillFenced();
  assert(isFenced, `${label}: no mutation may release or rewrite a swap reservation before its receipt is acknowledged`);
  assert(error === undefined || /stock|reconcil|equipment change/i.test(String(error.message)),
    `${label}: expected either a stock-fence rejection or a safe no-op, received ${error?.message ?? "success"}`);
}

(async () => {
  const failures = [];
  const capture = async (name, run) => {
    try { await run(); } catch (error) { failures.push(`${name}: ${error.message}`); }
  };
  // A terminal Didit rejection must not cancel a reservation owned by the swap.
  await capture("Didit rejection", async () => {
    const { booking, receipt, reservation } = makePendingSwapBooking();
    const originalBookingStatus = booking.status;
    await eitherRejectOrApplySafely(() => bookings.setDiditResult.handler(ctx, {
      bookingId: booking._id,
      sessionId: booking.diditSessionId,
      eventId: "didit-rejected-with-pending-swap-receipt",
      status: "rejected",
      providerStatus: "Declined",
      note: "Fixture rejection",
      poaPostcodes: [],
      eventAt: 2,
      checks: { identity: "approved", selfie: "approved", address: "rejected" },
    }), () => reservation.status === "hold" && reservation.externalRef === `swap:${booking.activeItemSwapId}` && receipt.deliveryState === "pending",
    "Didit rejection");
    assert.equal(booking.status, originalBookingStatus, "A fenced rejection must not demote or cancel a rental mid stock reconciliation");
  });

  // Verification confirmation must not consume a swap hold or drop its claim identity.
  await capture("Checkout confirmation", async () => {
    const { booking, receipt, reservation } = makePendingSwapBooking();
    booking.idVerifyStatus = "verified";
    await eitherRejectOrApplySafely(() => bookings.confirm.handler(ctx, {
      bookingId: booking._id,
      paymentIntentId: booking.stripePaymentIntentId,
    }), async () => reservation.status === "hold" && JSON.stringify(await db.get(reservation._id)) === JSON.stringify(reservation) &&
      reservation.externalRef === `swap:${booking.activeItemSwapId}` && receipt.deliveryState === "pending",
    "Checkout confirmation");
  });

  // Duplicate checkout receipts must not alter a swap hold's expiry while pending.
  await capture("Paid checkout receipt replay", async () => {
    const { booking, receipt, reservation } = makePendingSwapBooking();
    const expiresAt = reservation.holdExpiresAt;
    await eitherRejectOrApplySafely(() => bookings.recordPaidCheckoutReceipt.handler(ctx, {
      bookingId: booking._id,
      sessionId: booking.stripeCheckoutSessionId,
      paymentIntentId: booking.stripePaymentIntentId,
      amountTotalPence: 10_000,
      currency: "GBP",
      paymentStatus: "paid",
    }), () => reservation.status === "hold" && reservation.holdExpiresAt === expiresAt &&
      reservation.externalRef === `swap:${booking.activeItemSwapId}` && receipt.deliveryState === "pending",
    "Paid checkout receipt replay");
  });

  // The unpaid-checkout expiry worker must not delete any reservation if the booking
  // unexpectedly carries a swap receipt; expired/unpaid stock is still evidence to reconcile.
  await capture("Unpaid checkout expiry", async () => {
    const { booking, receipt, reservation } = makePendingSwapBooking("pending_payment");
    booking.checkoutPaidAt = undefined;
    booking.checkoutPaymentStatus = undefined;
    booking.checkoutPaymentAmountPence = undefined;
    booking.checkoutExpectedAmountPence = undefined;
    booking.stripePaymentIntentId = undefined;
    // A recovered legacy row may have lost its convenience marker. The
    // immutable pending receipt must still prevent its hold from being freed.
    booking.activeItemSwapId = undefined;
    const before = JSON.stringify(reservation);
    await eitherRejectOrApplySafely(() => bookings.expireUnpaidPending.handler(ctx, {
      bookingId: booking._id,
      sessionId: booking.stripeCheckoutSessionId,
    }), async () => JSON.stringify(await db.get(reservation._id)) === before && JSON.stringify(reservation) === before &&
      booking.status === "pending_payment" && receipt.deliveryState === "pending",
    "Unpaid checkout expiry");
  });

  assert.equal((tables.get("swap_stock_applied_receipts") ?? []).filter(row => row.deliveryState === "pending").length, 4);
  if (failures.length) throw Error(failures.join("\n"));
  console.log("PASS unresolved swap receipts preserve reservations across Didit rejection and checkout confirmation/hold lifecycle. Synthetic database; no provider writes.");
})().catch(error => { console.error(error); process.exitCode = 1; });
