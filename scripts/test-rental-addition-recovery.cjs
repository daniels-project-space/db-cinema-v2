const assert = require("node:assert/strict");
const { db, load, put, setMock } = require("./lib/rentalTestHarness.cjs");
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.ADMIN_TOKEN = "recovery-admin";
let sessions = [], hasMore = false, lists = 0, paymentCalls = 0;
setMock("stripe", { __esModule: true, default: class StripeFixture {
  checkout = { sessions: {
    list: async () => { lists++; return { data: sessions, has_more: hasMore }; },
    retrieve: async id => sessions.find(session => session.id === id),
    expire: async id => ({ ...sessions.find(session => session.id === id), status: "expired", payment_status: "unpaid" }),
  } };
  paymentIntents = { retrieve: async id => ({ id, status: "succeeded", amount_received: 1500, currency: "gbp", metadata: currentIntentMetadata }) };
} });
setMock("./checkout", { checkoutPaymentIntent: async session => session.payment_intent, syncStripeMembership: async () => {} });
const state = load("convex/rentalAdditionState.ts"), actions = load("convex/rentalAdditions.ts");
const stateCtx = { db, scheduler: { runAfter: async () => {} } };
let currentIntentMetadata = {};
let scheduledRows = [];
const ctx = {
  runQuery: async (ref, args) => ref === "rentalAdditionState.open" ? scheduledRows : state.context.handler(stateCtx, args),
  runMutation: async (ref, args) => {
    if (ref === "adminAuth.assertAdminInternal") { if (args.token !== process.env.ADMIN_TOKEN) throw Error("Unauthorized"); return; }
    if (ref === "rentalAdditionState.bindRecoveredSession") return state.bindRecoveredSession.handler(stateCtx, args);
    if (ref === "rentalAdditionState.markSessionRecoveryReview") return state.markSessionRecoveryReview.handler(stateCtx, args);
    if (ref === "rentalAdditionState.touch") return;
    if (ref === "rentalAdditionState.markPaid") { paymentCalls++; return; }
    if (ref === "rentalAdditionState.apply") { const row = await db.get(args.id); row.status = "applied"; return { closed: false }; }
    if (ref === "rentalAdditionState.close") { const row = await db.get(args.id); row.status = "expired"; row.closedWithoutPayment = true; return; }
    throw Error(`Unexpected mutation ${ref}`);
  },
};
function fixture(suffix, ageHours = 23.75) {
  const booking = put("bookings", { status: "confirmed", depositHoldAmount: 0 });
  const addition = put("rental_additions", { bookingId: booking._id, status: "prepared", title: suffix, qty: 1, lineTotal: 20, securityCharge: 0, holdTotal: 0, creditOptIn: true, creditAppliedPence: 500, cardDuePence: 1500, sessionCreationPending: true, createdAt: Date.now() - ageHours * 3600000 });
  booking.activeAdditionId = addition._id;
  const metadata = { rentalAdditionId: addition._id, additionBookingId: booking._id, cardDuePence: "1500", creditAppliedPence: "500" };
  const session = { id: `cs_${suffix}`, mode: "payment", currency: "gbp", amount_total: 1500, status: "complete", payment_status: "paid", payment_intent: `pi_${suffix}`, metadata };
  return { booking, addition, session };
}
(async () => {
  const missing = fixture("missing");
  await assert.rejects(actions.recoverPayment.handler(ctx, { token: "renter", id: missing.addition._id }), /Unauthorized/); assert.equal(lists, 0);
  assert.equal((await actions.recoverPayment.handler(ctx, { token: process.env.ADMIN_TOKEN, id: missing.addition._id })).status, "needs_review");
  assert.equal(missing.addition.sessionId, undefined);
  sessions = [fixture("other").session]; hasMore = true;
  assert.equal((await actions.recoverPayment.handler(ctx, { token: process.env.ADMIN_TOKEN, id: missing.addition._id })).status, "needs_review"); hasMore = false;
  const expired = fixture("expired", 25); expired.session.status = "expired"; expired.session.payment_status = "unpaid"; sessions = [expired.session];
  assert.equal((await actions.recoverPayment.handler(ctx, { token: process.env.ADMIN_TOKEN, id: expired.addition._id })).status, "closed"); assert(expired.addition.closedWithoutPayment);
  assert.equal((await actions.recoverPayment.handler(ctx, { token: process.env.ADMIN_TOKEN, id: expired.addition._id })).status, "closed");
  const paid = fixture("paid"); sessions = [paid.session, { ...paid.session, id: "cs_duplicate" }];
  assert.equal((await actions.recoverPayment.handler(ctx, { token: process.env.ADMIN_TOKEN, id: paid.addition._id })).status, "needs_review"); assert.equal(paymentCalls, 0);
  sessions = [{ ...paid.session, metadata: { ...paid.session.metadata, additionBookingId: "other" } }];
  assert.equal((await actions.recoverPayment.handler(ctx, { token: process.env.ADMIN_TOKEN, id: paid.addition._id })).status, "needs_review");
  const processing = fixture("processing"); processing.session.payment_status = "unpaid"; sessions = [processing.session];
  assert.equal((await actions.recoverPayment.handler(ctx, { token: process.env.ADMIN_TOKEN, id: processing.addition._id })).status, "processing"); assert.equal(processing.addition.status, "awaiting_payment"); assert.equal(paymentCalls, 0);
  sessions = [paid.session]; currentIntentMetadata = { rentalAdditionId: paid.addition._id, bookingId: paid.booking._id, cardDuePence: "1500", creditAppliedPence: "500" };
  assert.equal((await actions.recoverPayment.handler(ctx, { token: process.env.ADMIN_TOKEN, id: paid.addition._id })).status, "paid"); assert.equal(paymentCalls, 1);
  assert.equal((await actions.recoverPayment.handler(ctx, { token: process.env.ADMIN_TOKEN, id: paid.addition._id })).status, "paid"); assert.equal(paymentCalls, 1);
  const latePaid = fixture("late-paid", 25); sessions = [latePaid.session];
  assert.equal((await actions.recoverPayment.handler(ctx, { token: process.env.ADMIN_TOKEN, id: latePaid.addition._id })).status, "needs_review"); assert.equal(paymentCalls, 1, "late paid sessions never initiate automatic refunds");
  const batch = [fixture("batch1", 25), fixture("batch2", 25), fixture("batch3", 25)]; scheduledRows = batch.map(row => row.addition); sessions = [];
  const before = lists; await actions.reconcile.handler(ctx, {}); assert.equal(lists - before, 2); assert.equal(batch.filter(row => row.addition.recoveryNeedsReview).length, 2);
  const scheduledPaid = fixture("scheduled-paid"); scheduledRows = [scheduledPaid.addition]; sessions = [scheduledPaid.session];
  currentIntentMetadata = { rentalAdditionId: scheduledPaid.addition._id, bookingId: scheduledPaid.booking._id, cardDuePence: "1500", creditAppliedPence: "500" };
  await actions.reconcile.handler(ctx, {}); assert.equal(scheduledPaid.addition.status, "applied", "scheduled recovery uses the same attested paid path"); assert.equal(paymentCalls, 2);
  console.log("PASS addition recovery: auth, ambiguous evidence, bounded scheduling, unpaid closure, paid settlement and replay; synthetic data only.");
})().catch(error => { console.error(error); process.exitCode = 1; });
