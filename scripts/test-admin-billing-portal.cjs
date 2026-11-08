const assert = require("node:assert/strict");
const { load, db, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "fixture-admin";
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.APP_URL = "https://dbcinemarentals.com";

let linkedCustomer = "cus_fixture";
let portalCalls = 0;
let customerRetrieved = 0;
let subscriptionRetrieved = 0;
let changeDuring = null;
setMock("stripe", { default: class {
  constructor() {
    this.customers = { retrieve: async id => { customerRetrieved++; if(changeDuring==='retrieve') member.stripeCustomerId='cus_relinked'; return { id: linkedCustomer, deleted: false, metadata: {} }; } };
    this.subscriptions = { retrieve: async id => { subscriptionRetrieved++; return { id, customer: linkedCustomer }; } };
    this.billingPortal = { sessions: { create: async args => {
      portalCalls++;
      assert.equal(args.customer, "cus_fixture");
      assert.equal(args.return_url, "https://dbcinemarentals.com/admin");
      if(changeDuring==='create') member.stripeCustomerId='cus_relinked';
      return { url: "https://billing.stripe.com/p/session/fixture" };
    } } };
  }
} });

const accounts = load("convex/accountAdmin.ts");
const checkout = load("convex/checkout.ts");
const member = put("accounts", { email: "member@example.invalid", createdAt: 1, stripeCustomerId: "cus_fixture", stripeSubscriptionId: "sub_fixture" });
const customerOnly = put("accounts", { email: "customer-only@example.invalid", createdAt: 1, stripeCustomerId: "cus_fixture" });
const missing = put("accounts", { email: "no-billing@example.invalid", createdAt: 1 });
const ctx = { db, runMutation: async (ref, args) => {
  assert.equal(ref, "accountAdmin.billingCustomerPortalTarget");
  return accounts.billingCustomerPortalTarget.handler(ctx, args);
} };

(async () => {
  await assert.rejects(checkout.adminBillingPortal.handler(ctx, { token: "wrong", accountId: member._id }), /unauthorized/);
  await assert.rejects(checkout.adminBillingPortal.handler(ctx, { token: "renter-session-token", accountId: member._id }), /unauthorized/);
  await assert.rejects(accounts.detail.handler(ctx, { token: "renter-session-token", accountId: customerOnly._id }), /unauthorized/);
  await assert.rejects(checkout.adminBillingPortal.handler(ctx, { token: "fixture-admin", accountId: missing._id }), /linked Stripe customer/);
  assert.equal(customerRetrieved, 0, "Denied accounts never contact Stripe");
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
  member.stripeCustomerId='cus_fixture';changeDuring=null;
  const result = await checkout.adminBillingPortal.handler(ctx, { token: "fixture-admin", accountId: member._id });
  assert.deepEqual(result, { url: "https://billing.stripe.com/p/session/fixture" });
  assert.equal(portalCalls, 2);
  const noSubscriptionResult = await checkout.adminBillingPortal.handler(ctx, { token: "fixture-admin", accountId: customerOnly._id });
  assert.deepEqual(noSubscriptionResult, { url: "https://billing.stripe.com/p/session/fixture" }, "A Stripe customer can open the portal without a subscription");
  assert.equal(portalCalls, 3);
  assert.equal(subscriptionRetrieved, 0, "Portal access never depends on or reads a subscription");
  const appUrl = process.env.APP_URL;
  delete process.env.APP_URL;
  await assert.rejects(checkout.adminBillingPortal.handler(ctx, { token: "fixture-admin", accountId: customerOnly._id }), /APP_URL is not configured/);
  assert.equal(portalCalls, 3, "Missing return URL configuration fails closed");
  process.env.APP_URL = appUrl;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  await assert.rejects(checkout.adminBillingPortal.handler(ctx, { token: "fixture-admin", accountId: customerOnly._id }), /STRIPE_SECRET_KEY not set/);
  assert.equal(portalCalls, 3, "Missing Stripe configuration fails closed");
  process.env.STRIPE_SECRET_KEY = stripeKey;
  assert((tables.get("admin_audit_log") ?? []).some(row => row.fn === `accountAdmin.billingPortal:${member._id}` && row.success), "The account-scoped admin access is audited");
  console.log("PASS admin billing portal: admin-only access, customer-only session with or without subscription, stale-link rejection and fail-closed configuration; synthetic data only.");
})().catch(error => { console.error(error); process.exitCode = 1; });
