const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");

const messages = [];
const notifications = [];
const scheduled = [];
setMock("./lib/rentalChat", {
  postRentalMessage: async (_ctx, message) => { messages.push(message); return `message-${messages.length}`; },
});
setMock("./lib/rentalAccount", {
  accountForRental: async (_ctx, booking) => booking.accountId
    ? { _id: booking.accountId, email: "renter@example.invalid" }
    : null,
});
setMock("./lib/adminPush", {
  queueOwnerNotification: async (_ctx, notice) => { notifications.push(notice); return `notice-${notifications.length}`; },
});

const operations = load("convex/rentalOperations.ts");
const account = put("accounts", { email: "renter@example.invalid" });
const booking = put("bookings", { accountId: account._id });
const ctx = { db, scheduler: { runAfter: async (...args) => { scheduled.push(args); } } };

async function record(refund, status, stripeRefundId) {
  return operations.recordRefundPart.handler(ctx, {
    id: refund._id,
    paymentIntentId: refund.allocations[0].paymentIntentId,
    stripeRefundId,
    status,
  });
}

(async () => {
  const swapRefund = put("rental_refunds", {
    bookingId: booking._id,
    expectedAccountId: account._id,
    expectedRecipientEmail: account.email,
    requestId: "swap-swap-1",
    amountPence: 1500,
    reason: "Equipment change: Camera to lens",
    status: "prepared",
    allocations: [{ paymentIntentId: "pi_swap", amountPence: 1500 }],
    parts: [],
  });

  await record(swapRefund, "pending", "re_swap_pending");
  assert.equal(messages.length, 1, "A pending swap refund gets one chat progress update");
  assert.match(messages[0].text, /still shows the original equipment/i, "The pending update does not imply the swap is complete");
  assert.equal(scheduled.length, 0, "A swap refund does not send the generic refund email");

  await record(swapRefund, "succeeded", "re_swap_pending");
  assert.equal(messages.length, 1, "Generic refund success is withheld until the swap transaction applies the basket");
  assert.equal(scheduled.length, 0, "A swap refund does not queue a duplicate generic success email");

  const ordinaryRefund = put("rental_refunds", {
    bookingId: booking._id,
    expectedAccountId: account._id,
    expectedRecipientEmail: account.email,
    requestId: "return-deposit-1",
    amountPence: 5000,
    reason: "Deposit returned",
    status: "prepared",
    allocations: [{ paymentIntentId: "pi_return", amountPence: 5000 }],
    parts: [],
  });
  await record(ordinaryRefund, "succeeded", "re_deposit");
  assert.equal(messages.length, 2, "Ordinary rental refunds still send their generic chat notice");
  assert.match(messages[1].text, /succeeded/i);
  assert.equal(scheduled.length, 1, "Ordinary rental refunds still send their email");
  assert.equal(notifications.length, 0);

  console.log("PASS swap refund notice gating: pending is clear, generic swap success is withheld, ordinary refund notices remain enabled");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
