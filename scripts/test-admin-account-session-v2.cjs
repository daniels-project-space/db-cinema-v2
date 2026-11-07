const assert = require("node:assert/strict");
const { webcrypto, createHash } = require("node:crypto");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const sessions = load("convex/adminSessionsV2.ts");
const customerAdmin = load("convex/accountAdmin.ts");
const action = customerAdmin.setStarred;
const { assertAdminScopeSession, assertCustomerWriteSession, assertCustomerReadSession, revokeOwnSessionInTransaction, signOut, checkSession } = load("convex/adminAccountSessionV2.ts");
const hash = value => createHash("sha256").update(value).digest("hex");
const identity = "https://identity.example|fixture";
const token = "a".repeat(64);
const account = put("accounts", { email: "fixture@example.invalid" });
const ctx = { db, auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) } };
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["customers:read", "customers:write"] });
const args = { token, accountId: account._id, starred: true };

(async () => {
  await sessions.createSession.handler(ctx, {
    tokenDigest: hash(token), principalId: `admin:${hash(identity)}`,
    scopes: ["customers:write"], expiresAt: Date.now() + 60_000,
  });
  process.env.ADMIN_TOKEN = "legacy-secret-fixture";
  delete process.env.ADMIN_SESSION_STARRED_V2;
  await assert.rejects(action.handler(ctx, args), /unauthorized/);
  await action.handler(ctx, { ...args, token: process.env.ADMIN_TOKEN });
  assert.equal(account.adminStarred, true);
  account.adminStarred = undefined;
  process.env.ADMIN_SESSION_STARRED_V2 = "enabled";
  await assert.rejects(action.handler(ctx, args), /not ready/);
  await assert.rejects(action.handler(ctx, { ...args, token: process.env.ADMIN_TOKEN }), /not ready/);
  await assert.rejects(assertCustomerWriteSession(ctx, process.env.ADMIN_TOKEN), /unauthorized/);
  await assert.rejects(assertCustomerWriteSession({ ...ctx, auth: { getUserIdentity: async () => null } }, token), /unauthorized/);
  await assert.rejects(assertCustomerWriteSession({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "another" }) } }, token), /unauthorized/);
  await assert.rejects(assertCustomerWriteSession(ctx, "b".repeat(64)), /unauthorized/);
  assert.equal(account.adminStarred, undefined);
  process.env.ADMIN_SESSION_CUSTOMER_WRITE_V2 = "enabled";
  for (const name of ["setLevel", "setEncoreLevel", "setBlocked", "addNote"]) {
    await assert.rejects(customerAdmin[name].handler(ctx, { token, accountId: account._id }), /not ready/, name);
    await assert.rejects(customerAdmin[name].handler(ctx, { token: process.env.ADMIN_TOKEN, accountId: account._id }), /not ready/, name);
  }
  delete process.env.ADMIN_SESSION_CUSTOMER_WRITE_V2;
  await assertCustomerWriteSession(ctx, token);
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["customers:read"] });
  await assert.rejects(assertCustomerWriteSession(ctx, token), /unauthorized/);
  process.env.ADMIN_SESSION_SCOPES_V2 = "{";
  await assert.rejects(assertCustomerWriteSession(ctx, token), /unauthorized/);
  delete process.env.ADMIN_SESSION_SCOPES_V2;
  await assert.rejects(assertCustomerWriteSession(ctx, token), /unauthorized/);
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["customers:read", "customers:write"] });
  await assert.rejects(assertCustomerReadSession(ctx, token), /unauthorized/);
  assert.equal(tables.get("admin_audit_log").length, 1);
  await sessions.revoke.handler(ctx, { tokenDigest: hash(token) });
  await assert.rejects(assertCustomerWriteSession(ctx, token), /unauthorized/);
  assert.equal(account.adminStarred, undefined);
  const noScopeToken = "c".repeat(64);
  await sessions.createSession.handler(ctx, {
    tokenDigest: hash(noScopeToken), principalId: `admin:${hash(identity)}`,
    scopes: ["customers:read"], expiresAt: Date.now() + 60_000,
  });
  await assert.rejects(assertCustomerWriteSession(ctx, noScopeToken), /unauthorized/);
  await assertCustomerReadSession(ctx, noScopeToken);
  await assert.rejects(assertCustomerReadSession({ ...ctx, auth: { getUserIdentity: async () => null } }, noScopeToken), /unauthorized/);
  await assert.rejects(assertCustomerReadSession({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "another" }) } }, noScopeToken), /unauthorized/);
  process.env.ADMIN_SESSION_CUSTOMER_READ_V2 = "enabled";
  const reads = ["directoryAccess", "possibleRestrictedIdentityMatches", "directory", "searchMessages", "directoryMetrics", "search", "history", "verificationReviews", "detail"];
  for (const name of reads) {
    await assert.rejects(customerAdmin[name].handler(ctx, { token: noScopeToken }), /not ready/, name);
    await assert.rejects(customerAdmin[name].handler(ctx, { token: process.env.ADMIN_TOKEN }), /not ready/, name);
  }
  delete process.env.ADMIN_SESSION_CUSTOMER_READ_V2;
  assert.equal(await customerAdmin.directoryAccess.handler(ctx, { token: process.env.ADMIN_TOKEN }), true);
  assert.equal(await customerAdmin.directoryAccess.handler(ctx, { token: noScopeToken }), false);
  await sessions.revoke.handler(ctx, { tokenDigest: hash(noScopeToken) });
  await assert.rejects(assertCustomerReadSession(ctx, noScopeToken), /unauthorized/);
  const expiringToken = "d".repeat(64);
  await sessions.createSession.handler(ctx, {
    tokenDigest: hash(expiringToken), principalId: `admin:${hash(identity)}`,
    scopes: ["customers:write"], expiresAt: Date.now() + 60_000,
  });
  const expiring = tables.get("admin_sessions_v2").find(row => row.tokenDigest === hash(expiringToken));
  await db.patch(expiring._id, { expiresAt: Date.now() });
  await assert.rejects(assertCustomerWriteSession(ctx, expiringToken), /unauthorized/);
  const rentalToken = "e".repeat(64);
  await sessions.createSession.handler(ctx, {
    tokenDigest: hash(rentalToken), principalId: `admin:${hash(identity)}`,
    scopes: ["rentals:read"], expiresAt: Date.now() + 60_000,
  });
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["rentals:read", "payments:write"] });
  await assertAdminScopeSession(ctx, rentalToken, "rentals:read");
  await assert.rejects(assertAdminScopeSession(ctx, rentalToken, "payments:write"), /unauthorized/);
  await assert.rejects(assertAdminScopeSession(ctx, rentalToken, "not-a-scope"), /unauthorized/);
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["payments:write"] });
  await assert.rejects(assertAdminScopeSession(ctx, rentalToken, "rentals:read"), /unauthorized/);
  await assert.rejects(signOut.handler(ctx, { token: rentalToken }), /not ready/);
  await assert.rejects(checkSession.handler(ctx, { token: rentalToken, scope: "rentals:read" }), /not ready/);
  await assert.rejects(revokeOwnSessionInTransaction({ ...ctx, auth: { getUserIdentity: async () => null } }, rentalToken), /unauthorized/);
  await assert.rejects(revokeOwnSessionInTransaction({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "another" }) } }, rentalToken), /unauthorized/);
  await assert.rejects(revokeOwnSessionInTransaction(ctx, "f".repeat(64)), /unauthorized/);
  const rentalSession = tables.get("admin_sessions_v2").find(row => row.tokenDigest === hash(rentalToken));
  assert.equal(rentalSession.revokedAt, undefined);
  delete process.env.ADMIN_SESSION_SCOPES_V2;
  await revokeOwnSessionInTransaction(ctx, rentalToken);
  const revokedAt = rentalSession.revokedAt;
  assert.equal(typeof revokedAt, "number");
  await revokeOwnSessionInTransaction(ctx, rentalToken);
  assert.equal(rentalSession.revokedAt, revokedAt);
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["rentals:read"] });
  await assert.rejects(assertAdminScopeSession(ctx, rentalToken, "rentals:read"), /unauthorized/);
  console.log("PASS gated identity-bound admin session action, scope and revocation fixtures");
})().catch(error => { console.error(error); process.exitCode = 1; });
