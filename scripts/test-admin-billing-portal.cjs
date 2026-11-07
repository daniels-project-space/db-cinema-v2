const assert = require("node:assert/strict");
const { load, db, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "fixture-admin";
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.APP_URL = "https://dbcinemarentals.com";

let linkedCustomer = "cus_fixture";
let portalCalls = 0;
let retrieved = 0;
let changeDuring = null;
setMock("stripe", { default: class {
  constructor() {
    this.subscriptions = { retrieve: async id => { retrieved++; if(changeDuring==='retrieve') member.stripeCustomerId='cus_relinked'; return { id, customer: linkedCustomer }; } };
    this.billingPortal = { sessions: { create: async args => {
      portalCalls++;
      assert.equal(args.customer, "cus_fixture");
      assert.equal(args.return_url, "https://dbcinemarentals.com/admin");
      if(changeDuring==='create') member.stripeSubscriptionId='sub_relinked';
      return { url: "https://billing.stripe.com/p/session/fixture" };
    } } };
  }
} });

const accounts = load("convex/accountAdmin.ts");
const checkout = load("convex/checkout.ts");
const member = put("accounts", { email: "member@example.invalid", createdAt: 1, stripeCustomerId: "cus_fixture", stripeSubscriptionId: "sub_fixture" });
const missing = put("accounts", { email: "no-billing@example.invalid", createdAt: 1 });
const ctx = { db, runMutation: async (ref, args) => {
  assert.equal(ref, "accountAdmin.billingPortalTarget");
  return accounts.billingPortalTarget.handler(ctx, args);
} };

(async () => {
  await assert.rejects(checkout.adminBillingPortal.handler(ctx, { token: "wrong", accountId: member._id }), /unauthorized/);
  await assert.rejects(checkout.adminBillingPortal.handler(ctx, { token: "fixture-admin", accountId: missing._id }), /linked Stripe subscription/);
  assert.equal(retrieved, 0, "Denied accounts never contact Stripe");
  linkedCustomer = "cus_other";
  await assert.rejects(checkout.adminBillingPortal.handler(ctx, { token: "fixture-admin", accountId: member._id }), /does not match/);
  assert.equal(portalCalls, 0, "A subscription owned by another Stripe customer cannot open a portal");
  linkedCustomer = "cus_fixture";
  changeDuring='retrieve';
  await assert.rejects(checkout.adminBillingPortal.handler(ctx,{token:'fixture-admin',accountId:member._id}),/billing link changed/);
  assert.equal(portalCalls,0,'A stale link is rejected before making a portal');
  member.stripeCustomerId='cus_fixture';changeDuring='create';
  await assert.rejects(checkout.adminBillingPortal.handler(ctx,{token:'fixture-admin',accountId:member._id}),/billing link changed/);
  assert.equal(portalCalls,1,'A portal created during a relink is never returned to the browser');
  member.stripeSubscriptionId='sub_fixture';changeDuring=null;
  const result = await checkout.adminBillingPortal.handler(ctx, { token: "fixture-admin", accountId: member._id });
  assert.deepEqual(result, { url: "https://billing.stripe.com/p/session/fixture" });
  assert.equal(portalCalls, 2);
  assert((tables.get("admin_audit_log") ?? []).some(row => row.fn === `accountAdmin.billingPortal:${member._id}` && row.success), "The account-scoped admin access is audited");
  console.log("PASS admin billing portal: admin authentication, account-to-Stripe ownership, audited access and trusted return URL; synthetic data only.");
})().catch(error => { console.error(error); process.exitCode = 1; });
