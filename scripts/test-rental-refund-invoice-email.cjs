const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");

const account = put("accounts", { email: "refund-renter@example.invalid", name: "Refund Renter" });
const line = { title: "Sony FX3", start: Date.UTC(2030, 0, 2), end: Date.UTC(2030, 0, 4), qty: 1, lineTotal: 80 };
const booking = put("bookings", { accountId: account._id, guestEmail: account.email, status: "confirmed", stripePaymentIntentId: "pi_original", paidConfirmedAt: Date.now(), lineItems: [line], subtotal: 80, discount: 0, deliveryFee: 0, creditApplied: 0, total: 80 });
const posted = [], scheduled = [];
setMock("./lib/rentalChat", { ...load("convex/lib/rentalChat.ts"), postRentalMessage: async (_ctx, message) => posted.push(message) });
setMock("./lib/mailer", { sendMail: async () => { throw Error("This test must never send mail"); }, OWNER_EMAIL: () => "owner@example.invalid" });
process.env.ADMIN_TOKEN = "refund-invoice-test-admin";
const operations = load("convex/rentalOperations.ts");
const ctx = { db, scheduler: { runAfter: async (...args) => scheduled.push(args) } };
const refundRows = () => db.query("rental_email_deliveries").collect().then(rows => rows.filter(row => row.kind === "refund_invoice"));

function refundFixture(requestId, status = "prepared") {
  return put("rental_refunds", {
    bookingId: booking._id,
    expectedAccountId: account._id,
    expectedRecipientEmail: account.email,
    requestId,
    amountPence: 1500,
    reason: "Rental adjustment after return",
    status,
    allocations: [{ paymentIntentId: `pi_${requestId}`, amountPence: 1500 }],
  });
}

function callCtx(refund) {
  const invoiceSnapshot = {
    number: `DBC-${String(booking._id).slice(-8).toUpperCase()}`,
    issuedAt: Date.now(),
    supplierName: "DB CINEMA RENTALS LTD",
    status: "confirmed",
    customerName: account.name,
    email: account.email,
    fulfilment: "pickup",
    address: null,
    currency: "GBP",
    lineItems: [line],
    subtotal: 80,
    discount: 0,
    deliveryFee: 0,
    creditApplied: 0,
    depositAmount: 0,
    total: 80,
    promoCode: null,
  };
  const reference = `DBC-R-${String(refund._id).slice(-8).toUpperCase()}`;
  const view = { ...invoiceSnapshot, rentalRefunds: [{ reference, amount: 15, status: refund.status, reason: refund.reason }], rentalRefunded: refund.status === "succeeded" ? 15 : 0 };
  return {
    runQuery: async (ref, args) => {
      if (ref === "bookings.receiptContext") return { ...booking, guestEmail: account.email, invoiceSnapshot };
      if (ref === "rentalOperations.refundJob") return refund;
      if (ref === "rentalOperations.changeRecipient") return { email: account.email, bookingId: booking._id };
      if (ref === "bookings.invoiceData") return view;
      throw Error(`Unexpected query: ${ref}`);
    },
    runMutation: async () => null,
  };
}

(async () => {
  const pending = refundFixture("refund-pending-001");
  await operations.recordRefundPart.handler(ctx, { id: pending._id, paymentIntentId: "pi_refund-pending-001", stripeRefundId: "re_pending", status: "pending" });
  assert.equal((await refundRows()).length, 0, "pending provider status creates no updated-invoice email");

  const failed = refundFixture("refund-failed-001");
  await operations.recordRefundPart.handler(ctx, { id: failed._id, paymentIntentId: "pi_refund-failed-001", stripeRefundId: "re_failed", status: "failed" });
  assert.equal((await refundRows()).length, 0, "failed provider status creates no updated-invoice email");

  const successful = refundFixture("refund-success-001");
  await operations.recordRefundPart.handler(ctx, { id: successful._id, paymentIntentId: "pi_refund-success-001", stripeRefundId: "re_success", status: "succeeded" });
  const queued = await refundRows();
  assert.equal(queued.length, 1, "a fully confirmed, renter-bound refund queues one replacement invoice");
  assert.equal(queued[0].refundId, successful._id);
  assert.equal(queued[0].key, `${booking._id}:refund_invoice:${successful._id}`, "the delivery key is stable for provider retries");
  await operations.recordRefundPart.handler(ctx, { id: successful._id, paymentIntentId: "pi_refund-success-001", stripeRefundId: "re_success", status: "succeeded" });
  assert.equal((await refundRows()).length, 1, "a repeated Stripe success event cannot duplicate the invoice email");

  const single = refundFixture("refund-single-001");
  await operations.recordRefund.handler(ctx, { id: single._id, stripeRefundId: "re_single", status: "pending" });
  assert.equal((await refundRows()).length, 1, "the single-payment pending webhook creates no invoice email");
  await operations.recordRefund.handler(ctx, { id: single._id, stripeRefundId: "re_single", status: "succeeded" });
  assert.equal((await refundRows()).length, 2, "the single-payment success webhook queues its updated invoice");
  await operations.recordRefund.handler(ctx, { id: single._id, stripeRefundId: "re_single", status: "succeeded" });
  assert.equal((await refundRows()).length, 2, "replayed single-payment success remains idempotent");

  const invoice = load("convex/invoice.ts");
  process.env.INVOICE_SECRET = "synthetic-invoice-secret";
  const priorFetch = global.fetch;
  let fetches = 0;
  global.fetch = async url => {
    fetches++;
    assert.match(String(url), /\/api\/invoice\/bookings-/);
    return new Response(Buffer.from("%PDF-refund-test"), { status: 200, headers: { "content-type": "application/pdf" } });
  };
  try {
    const payload = await invoice.invoiceEmail.handler(callCtx(successful), { bookingId: booking._id, refundId: successful._id, deliveryKey: queued[0].key, prepareOnly: true });
    const reference = `DBC-R-${String(successful._id).slice(-8).toUpperCase()}`;
    assert.equal(payload.to, account.email);
    assert.equal(payload.deliveryKey, queued[0].key);
    assert.match(payload.subject, new RegExp(reference));
    assert.match(payload.html, /Sony FX3/);
    assert.match(payload.html, /Total paid/);
    assert.match(payload.html, /£80\.00/, "the original invoice amount remains intact");
    assert.match(payload.html, /Confirmed rental refund/);
    assert.match(payload.html, /−£15\.00/);
    assert.match(payload.html, /Rental adjustment after return/);
    assert.equal(Buffer.from(payload.attachments[0].content, "base64").toString(), "%PDF-refund-test");

    for (const status of ["pending", "failed"]) {
      const unsettled = { ...successful, status };
      await assert.rejects(invoice.invoiceEmail.handler(callCtx(unsettled), { bookingId: booking._id, refundId: successful._id, prepareOnly: true }), /provider-confirmed/);
    }
    assert.equal(fetches, 1, "unsettled refunds cannot render or deliver an invoice");
  } finally {
    global.fetch = priorFetch;
    delete process.env.INVOICE_SECRET;
    delete process.env.ADMIN_TOKEN;
  }
  console.log("PASS rental refund invoice email: provider-confirmed only, bound renter, stable retries, original invoice totals, refund reference/reason and PDF; synthetic data only.");
})().catch(error => {
  delete process.env.INVOICE_SECRET;
  delete process.env.ADMIN_TOKEN;
  console.error(error);
  process.exitCode = 1;
});
