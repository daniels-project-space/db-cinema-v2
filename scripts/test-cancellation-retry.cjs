const assert = require("node:assert/strict");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
const receipts = new Map();
let created = 0,
  refundListCalls = 0;
class Stripe {
  constructor() {
    this.paymentIntents = {
      retrieve: async (id) => ({ id, amount_received: 12000 }),
    };
    this.refunds = {
      retrieve: async id => [...receipts.values()].find(r => r.id === id),
      list: (args) => ({
        async *[Symbol.asyncIterator]() {
          refundListCalls++;
          for (const r of receipts.values()) if (r.payment_intent === args.payment_intent) yield r;
        },
      }),
      create: async (args, { idempotencyKey }) => {
        if (receipts.has(idempotencyKey)) {
          const prior = receipts.get(idempotencyKey);
          assert.equal(
            prior.amount,
            args.amount,
            "retry uses original frozen amount",
          );
          return prior;
        }
        created++;
        const r = {
          id: "re_fixture",
          status: "succeeded",
          amount: args.amount,
          payment_intent: args.payment_intent,
          currency: "gbp", metadata: args.metadata ?? {},
        };
        receipts.set(idempotencyKey, r);
        return r;
      },
    };
  }
}
setMock("stripe", { default: Stripe });
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.ADMIN_TOKEN = "fixture-owner";
const recovery = load("convex/cancellationRecovery.ts");
const bookings = load("convex/bookings.ts"),
  checkout = load("convex/checkout.ts");
const account=put("accounts", { email: "cancellation@rental-test.invalid" });
put("sessions",{token:"request-renter",accountId:account._id,expiresAt:Date.now()+600000});
const b = put("bookings", {
  status: "confirmed",
  guestEmail: "cancellation@rental-test.invalid",
  stripePaymentIntentId: "pi_fixture",
  total: 120,
  depositAmount: 20,
  currency: "GBP",
  lineItems: [
    {
      listingId: "fixture-listing",
      title: "Camera",
      qty: 1,
      lineTotal: 100,
      start: Date.UTC(2030, 10, 1),
      end: Date.UTC(2030, 10, 2),
    },
  ],
});
let failFinalize = true;
const ctx = {
  db,
  scheduler: { runAfter: async () => {} },
  runQuery: async (ref, args) => {
    if (ref === "bookings.getForCancel")
      return bookings.getForCancel.handler(ctx, args);
    throw Error(ref);
  },
  runMutation: async (ref, args) => {
    if(ref.startsWith("cancellationRecovery.")) return recovery[ref.split(".")[1]].handler(ctx,args);
    if (ref === "adminAuth.assertAdminInternal")
      return load("convex/adminAuth.ts").assertAdminInternal.handler(ctx, args);
    if (ref === "bookings._finalizeCancellation" && failFinalize) {
      failFinalize = false;
      throw Error("Simulated database outage after Stripe success");
    }
    if (ref.startsWith("bookings."))
      return bookings[ref.split(".")[1]].handler(ctx, args);
    throw Error(ref);
  },
};
(async () => {
  const requests=load("convex/rentalRequests.ts");
  await requests.submit.handler(ctx,{token:"request-renter",bookingId:b._id,requestId:"retry-linked-cancellation-01",kind:"cancel",detail:"Please cancel and refund the booking under its agreed terms."});
  const linked=await db.query("rental_change_requests").withIndex("by_booking",q=>q.eq("bookingId",b._id)).first();
  await requests.review.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:b._id,id:linked._id,decision:"approved",note:"We agree to arrange the cancellation under the accepted terms."});
  const args = { changeRequestId:linked._id,
    token: process.env.ADMIN_TOKEN,
    bookingId: b._id,
    reason: "Owner cancellation request",
  };
  await assert.rejects(
    checkout.cancelByAdmin.handler(ctx, args),
    /database outage/,
  );
  assert.equal(created, 1);assert.equal(linked.execution.status,"processing","Lost database finalisation cannot complete the request");
  assert.equal(b.status, "confirmed");
  assert.equal(b.cancellationDecision.quote.refundAmount, 120);
  await checkout.cancelByAdmin.handler(ctx, args);
  assert.equal(created, 1, "one provider refund across retry");
  assert.equal(
    refundListCalls,
    2,
    "retry does not reprice against already refunded balance",
  );
  assert.equal(b.status, "cancelled");
  assert.equal(b.refundAmount, 120);assert.equal(linked.execution.status,"applied");
  const member = put("accounts", {email:"credit-only@rental-test.invalid"});
  const creditOnly = put("bookings", {status:"confirmed", guestEmail:member.email,
    accountId:member._id, currency:"GBP", total:0, creditApplied:53, depositAmount:0,
    lineItems:[{listingId:"fixture-listing",title:"Camera",qty:1,lineTotal:53,
      start:Date.UTC(2030,10,1),end:Date.UTC(2030,10,2)}]});
  const restored=await checkout.cancelByAdmin.handler(ctx,{...args,changeRequestId:undefined,bookingId:creditOnly._id});
  assert.equal(restored.refundAmount,0);
  assert.equal(restored.creditAmount,53,"setup-only booking restores tender despite having no payment intent");
  assert.equal(created,1,"credit-only cancellation does not create a cash refund");
  assert.equal(creditOnly.status,"cancelled");
  const restoredCredits=await db.query("credits").collect();
  assert.equal(restoredCredits.filter(c=>c.bookingId===creditOnly._id).length,1);
  await bookings._finalizeCancellation.handler(ctx,{bookingId:creditOnly._id,accountId:member._id,
    mode:"refund",refundAmount:0,creditAmount:53,currency:"GBP"});
  assert.equal((await db.query("credits").collect()).filter(c=>c.bookingId===creditOnly._id).length,1);
  for(const binding of [{stripeCheckoutSessionId:"cs_bound"},{stripePaymentIntentId:"pi_bound"}]){
    const bound=put("bookings",{status:"pending_payment",...binding});
    await bookings.checkoutCreationRejected.handler(ctx,{bookingId:bound._id});
    assert.equal(bound.status,"pending_payment","a bound provider checkout cannot be released as a create rejection");
  }
  const memberReservation=put("membership_checkouts",{state:"creating"});
  const rejected=put("bookings",{status:"pending_payment",membershipCheckoutId:memberReservation._id});
  const held=put("reservations",{bookingId:rejected._id,status:"hold",holdExpiresAt:Date.now()+10000});
  await bookings.checkoutCreationRejected.handler(ctx,{bookingId:rejected._id});
  assert.equal(rejected.status,"cancelled");assert.equal(held.status,"cancelled");
  assert.equal(memberReservation.state,"expired");
  const originalNow=Date.now;
  Date.now=()=>Date.UTC(2030,9,15,12);
  try {
    for(const [label,version,days,refundAmount,creditAmount] of [
      ['fourteen','2026-10-v11',14,120,0],
      ['thirteen','2026-10-v11',13,20,100],
      ['accepted-old-policy','2026-10-v10',3,120,0],
    ]) {
      const paymentIntentId='pi_'+label;
      const start=Date.now()+days*86400000;
      const rental=put('bookings',{status:'confirmed',guestEmail:b.guestEmail,
        stripePaymentIntentId:paymentIntentId,total:120,depositAmount:20,currency:'GBP',
        agreementDocs:[{kind:'cancellation',version}],
        lineItems:[{listingId:'fixture-listing',title:'Camera',qty:1,lineTotal:100,start,end:start+86400000}]});
      const result=await checkout.cancelByAdmin.handler(ctx,{...args,changeRequestId:undefined,bookingId:rental._id});
      assert.equal(result.refundAmount,refundAmount,label);
      assert.equal(result.creditAmount,creditAmount,label);
      assert.equal(rental.status,'cancelled');
      assert.equal(receipts.get(`dbc-cancel-refund-${rental._id}`).payment_intent,paymentIntentId,'Refund uses this rental’s original payment transaction');
    }
  } finally {Date.now=originalNow;}
  console.log(
    "PASS cancellation: Stripe succeeded/database failed; original quote reused; one cash refund; retry finalizes once.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
