const assert = require("node:assert/strict");
const { load, setMock } = require("./lib/rentalTestHarness.cjs");
const calls = [];
let currentSession;
setMock("stripe", { default: class {
  webhooks = { constructEvent: (body, signature) => { if (signature !== "fixture-signature") throw Error("bad signature"); return JSON.parse(body); } };
  checkout = { sessions: { retrieve: async () => currentSession } };
} });
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
const checkout = load("convex/checkout.ts");
const ctx = {
  runAction: async (ref, args) => { calls.push({ ref, args }); return { bookingId: "bookings-fixture", paid: true, swapStatus: "applied" }; },
  runMutation: async (ref, args) => { calls.push({ ref, args }); },
};
const deliver = (type, session, signature = "fixture-signature") => checkout.stripeWebhook.handler(ctx, { body: JSON.stringify({ type, data: { object: session } }), sig: signature });

(async () => {
  currentSession = { id: "cs_fixture", status: "complete", payment_status: "paid", amount_total: 1200, currency: "gbp", metadata: { itemSwapId: "rental_item_swaps-fixture" } };
  assert.equal(await deliver("checkout.session.completed", currentSession, "invalid"), false);
  assert.equal(calls.length, 0);
  assert.equal(await deliver("checkout.session.completed", currentSession), true);
  assert.deepEqual(calls.pop(), { ref: "rentalSwapPayments.finalize", args: { sessionId: "cs_fixture" } });
  assert.equal(await deliver("checkout.session.async_payment_succeeded", currentSession), true);
  assert.deepEqual(calls.pop(), { ref: "rentalSwapPayments.finalize", args: { sessionId: "cs_fixture" } });
  await deliver("checkout.session.completed", { ...currentSession, payment_status: "unpaid" });
  assert.equal(calls.length, 0, "an unpaid event cannot apply the equipment change");
  await deliver("checkout.session.async_payment_failed", { ...currentSession, payment_status: "unpaid" });
  assert.deepEqual(calls.pop(), { ref: "rentalSwapState.asyncPaymentFailed", args: { id: "rental_item_swaps-fixture", sessionId: "cs_fixture", amountPence: 1200, currency: "gbp" } });
  const result = await checkout.finalize.handler(ctx, { sessionId: "cs_fixture" });
  assert.equal(result.swapStatus, "applied");
  assert.deepEqual(calls.pop(), { ref: "rentalSwapPayments.finalize", args: { sessionId: "cs_fixture" } });
  console.log("PASS equipment payment routing: signature, paid events, asynchronous failure and success-page recovery.");
})().catch(error => { console.error(error); process.exitCode = 1; });
