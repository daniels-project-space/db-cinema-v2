const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const access = harness.load("convex/adminAccountSessionV2.ts"), sessions = harness.load("convex/adminSessionsV2.ts");
let ready = false, revokeDuringCreate = false, portalCalls = 0;
harness.setMock("./adminAccountSessionV2", { ...access, adminSessionMigrationReady: () => ready });
const identity = "https://identity.example|portal-fixture", token = "a".repeat(64);
const hash = value => createHash("sha256").update(value).digest("hex");
const ctx = { db: harness.db, auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) } };
harness.setMock("stripe", { default: class { constructor() {
  this.customers = { retrieve: async id => ({ id, deleted: false, metadata: {} }) };
  this.billingPortal = { sessions: { create: async () => { portalCalls++; if (revokeDuringCreate) await sessions.revoke.handler(ctx, { tokenDigest: hash(token) }); return { url: "https://billing.stripe.com/p/session/fixture" }; } } };
} } });
const accountAdmin = harness.load("convex/accountAdmin.ts"), checkout = harness.load("convex/checkout.ts");
const account = harness.put("accounts", { email: "portal@example.invalid", createdAt: Date.now(), stripeCustomerId: "cus_fixture", stripeSubscriptionId: "sub_fixture" });
ctx.runMutation = async (ref, args) => { assert.equal(ref, "accountAdmin.billingCustomerPortalTarget"); return accountAdmin.billingCustomerPortalTarget.handler(ctx, args); };
process.env.ADMIN_TOKEN = "legacy-portal-fixture"; process.env.ADMIN_SESSION_BILLING_PORTAL_V2 = "enabled"; process.env.APP_URL = "https://dbcinemarentals.com";
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["payments:write"] }); process.env.STRIPE_SECRET_KEY = "sk_test_fixture";

(async () => {
  assert.equal(access.adminSessionMigrationReady(), false);
  await assert.rejects(checkout.adminBillingPortal.handler(ctx, { token: process.env.ADMIN_TOKEN, accountId: account._id }), /not ready/);
  assert.equal(portalCalls, 0);
  ready = true;
  await sessions.createSession.handler(ctx, { tokenDigest: hash(token), principalId: `admin:${hash(identity)}`, scopes: ["payments:write"], expiresAt: Date.now() + 60_000 });
  await assert.rejects(checkout.adminBillingPortal.handler(ctx, { token: process.env.ADMIN_TOKEN, accountId: account._id }), /unauthorized/);
  await assert.rejects(checkout.adminBillingPortal.handler({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "other" }) }, runMutation: async (ref,args) => accountAdmin.billingPortalTarget.handler({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "other" }) } },args) }, { token, accountId: account._id }), /unauthorized/);
  assert.equal(portalCalls, 0);
  revokeDuringCreate = true;
  await assert.rejects(checkout.adminBillingPortal.handler(ctx, { token, accountId: account._id }), /unauthorized/);
  assert.equal(portalCalls, 1, "A created portal is not returned after session revocation");
  assert(harness.tables.get("admin_audit_log").some(entry => entry.fn === `accountAdmin.billingPortal:${account._id}`));
  console.log("PASS scoped admin billing portal: gate, identity, revocation during Stripe call and no stale URL; Stripe mocked.");
})().catch(error => { console.error(error); process.exitCode = 1; });
