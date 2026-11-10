const assert = require("node:assert/strict");
const { ConvexError } = require("convex/values");
const { load, db, tables } = require("./lib/rentalTestHarness.cjs");
const accounts = load("convex/accounts.ts");
const { legalVersionForPolicy, CURRENT_PRIVACY_NOTICE_VERSION } = load("shared/legalVersioning.ts");
const policy = { setupIntentSecurityEnabled: true };
const scheduled = [];
const ctx = {
  db,
  runQuery: async (ref, args) => {
    if (ref === "settings.get") return policy;
    if (ref === "accounts._byEmail") return accounts._byEmail.handler(ctx, args);
    throw new Error(`Unexpected query ${ref}`);
  },
  runMutation: async (ref, args) => {
    if (ref === "accounts._create") return accounts._create.handler(ctx, args);
    throw new Error(`Unexpected mutation ${ref}`);
  },
  scheduler: { runAfter: async (...args) => scheduled.push(args) },
};
const currentTermsVersion = legalVersionForPolicy(policy);
const base = {
  email: "new-renter@example.invalid",
  password: "fixture-password",
  termsAndPrivacyAcknowledged: true,
  termsVersion: currentTermsVersion,
  privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION,
};

(async () => {
  await assert.rejects(
    accounts.signUp.handler(ctx, { ...base, email: "no-consent@example.invalid", termsAndPrivacyAcknowledged: false }),
    error => error instanceof ConvexError && error.data.code === "SIGNUP_TERMS_REQUIRED",
  );
  assert.equal((tables.get("accounts") ?? []).length, 0, "No account is created without the required acknowledgement");

  await assert.rejects(
    accounts.signUp.handler(ctx, { ...base, email: "stale-terms@example.invalid", termsVersion: "stale" }),
    error => error instanceof ConvexError && error.data.code === "SIGNUP_TERMS_UPDATED",
  );
  await assert.rejects(
    accounts.signUp.handler(ctx, { ...base, email: "stale-privacy@example.invalid", privacyNoticeVersion: "stale" }),
    error => error instanceof ConvexError && error.data.code === "SIGNUP_TERMS_UPDATED",
  );
  assert.equal((tables.get("accounts") ?? []).length, 0, "Stale versions never create an account");

  const result = await accounts.signUp.handler(ctx, base);
  assert.deepEqual(result, { token: "" }, "Email confirmation remains required before a password signup receives a session");
  const renter = await db.query("accounts").withIndex("by_email", q => q.eq("email", base.email)).unique();
  assert.equal(renter.accountTermsVersion, currentTermsVersion, "The server records the active rental terms version, not a caller-chosen version");
  assert.equal(renter.privacyNoticeVersion, CURRENT_PRIVACY_NOTICE_VERSION, "The exact linked privacy notice version is recorded");
  assert.ok(Number.isSafeInteger(renter.accountTermsAcceptedAt));
  assert.equal(renter.accountTermsAcceptedAt, renter.privacyNoticeAcknowledgedAt, "The two records capture the single checkbox action");
  assert.equal(renter.emailVerificationRequired, true);
  assert.equal((tables.get("sessions") ?? []).length, 0, "Pending email verification does not create a signed-in session");
  assert.equal(scheduled.length, 1, "Signup confirmation is scheduled after acceptance is recorded");

  await assert.rejects(
    accounts.signUp.handler(ctx, base),
    error => error instanceof ConvexError && error.data.code === "ACCOUNT_EXISTS",
  );
  assert.equal((tables.get("accounts") ?? []).length, 1, "A replay cannot create a duplicate account");
  console.log("PASS account signup acceptance: explicit acknowledgment, current terms/privacy versions, server timestamp, no session before email proof, no duplicate account.");
})().catch(error => { console.error(error); process.exitCode = 1; });
