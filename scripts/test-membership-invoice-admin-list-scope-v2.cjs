const assert = require("node:assert/strict");
const { webcrypto, createHash } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");

global.crypto ??= webcrypto;
const sessionsAccess = harness.load("convex/adminAccountSessionV2.ts");
harness.setMock("./adminAccountSessionV2", {
  ...sessionsAccess,
  adminSessionMigrationReady: () => true,
});
class StripeFixture {
  constructor() {
    this.subscriptions = {
      retrieve: async id => ({ id, customer: "cus_scope_fixture", latest_invoice: null }),
    };
  }
}
harness.setMock("stripe", { __esModule: true, default: StripeFixture });
const accountAdmin = harness.load("convex/accountAdmin.ts");
const checkout = harness.load("convex/checkout.ts");
const reviews = harness.load("convex/membershipInvoiceReviews.ts");
const sessions = harness.load("convex/adminSessionsV2.ts");
const hash = value => createHash("sha256").update(value).digest("hex");
const identity = "https://identity.example|membership-invoice-scope-fixture";
const readToken = "a".repeat(64);
const writeToken = "b".repeat(64);
const account = harness.put("accounts", {
  stripeCustomerId: "cus_scope_fixture",
  stripeSubscriptionId: "sub_scope_fixture",
});
const review = harness.put("membership_invoice_reviews", {
  accountId: account._id,
  subscriptionId: "sub_scope_fixture",
  invoiceId: "in_scope_fixture",
  reason: "processing_error",
  state: "review",
  createdAt: Date.now(),
});
for (let index = 0; index < 30; index++) {
  harness.put("membership_invoice_reviews", {
    accountId: account._id,
    subscriptionId: "sub_scope_fixture",
    invoiceId: `in_page_${String(index).padStart(2, "0")}`,
    reason: "snapshot_not_configured",
    state: "review",
    createdAt: Date.now() + index + 1,
  });
}
const ctx = {
  db: harness.db,
  auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) },
  runMutation: async (reference, args) => {
    assert.equal(reference, "accountAdmin.billingPortalTarget");
    return accountAdmin.billingPortalTarget.handler(ctx, args);
  },
};

process.env.ADMIN_SESSION_BILLING_PORTAL_V2 = "enabled";
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({
  [identity]: ["payments:read", "payments:write"],
});
process.env.ADMIN_TOKEN = "legacy-token-must-not-authorize";
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";

(async () => {
  for (const [token, scope] of [
    [readToken, "payments:read"],
    [writeToken, "payments:write"],
  ]) {
    await sessions.createSession.handler(ctx, {
      tokenDigest: hash(token),
      principalId: `admin:${hash(identity)}`,
      scopes: [scope],
      expiresAt: Date.now() + 60_000,
    });
  }

  const firstPage = await reviews.adminList.handler(ctx, {
    token: readToken,
    accountId: account._id,
    paginationOpts: { numItems: 30, cursor: null },
  });
  assert.equal(firstPage.page.length, 30);
  assert.equal(firstPage.isDone, false, "the query reports additional review rows beyond the first page");
  const secondPage = await reviews.adminList.handler(ctx, {
    token: readToken,
    accountId: account._id,
    paginationOpts: { numItems: 30, cursor: firstPage.continueCursor },
  });
  assert.equal(secondPage.page.length, 1);
  assert.equal(secondPage.isDone, true);
  assert.equal([...firstPage.page, ...secondPage.page].filter(row => row.invoiceId === "in_scope_fixture").length, 1);
  const inspected = await checkout.adminInspectMembershipInvoice.handler(ctx, {
    token: readToken,
    accountId: account._id,
    inspectTier: true,
  });
  assert.equal(inspected.invoice, null);
  assert.equal(inspected.receipt, null);
  assert.equal(await accountAdmin.billingPortalTarget.handler(ctx, {
    token: readToken,
    accountId: account._id,
    purpose: "membership_read",
  }).then(target => target.subscriptionId), "sub_scope_fixture");
  await assert.rejects(
    reviews.adminList.handler(ctx, { token: "c".repeat(64), accountId: account._id, paginationOpts: { numItems: 30, cursor: null } }),
    /unauthorized/,
    "legacy admin token must not bypass V2 scope checks",
  );
  await assert.rejects(
    reviews.adminReserveRetry.handler(ctx, {
      token: readToken,
      accountId: account._id,
      subscriptionId: "sub_scope_fixture",
      invoiceId: "in_scope_fixture",
    }),
    /unauthorized/,
    "read-only session cannot start a Stripe invoice retry",
  );
  process.env.MEMBERSHIP_HISTORICAL_INVOICE_CREDIT_V1 = "enabled";
  await reviews.adminReserveRetry.handler(ctx, {
    token: writeToken,
    accountId: account._id,
    subscriptionId: "sub_scope_fixture",
    invoiceId: "in_scope_fixture",
  });
  assert.equal((await harness.db.get(review._id)).retryCount, 1);
  console.log("PASS membership invoice scope split: read session lists and inspects subscription invoice; write session alone can retry Stripe credit sync");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
