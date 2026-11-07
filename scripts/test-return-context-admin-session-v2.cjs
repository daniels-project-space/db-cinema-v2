const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const { load, db, put, tables, setMock } = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const sessions = load("convex/adminSessionsV2.ts");
const identityAuth = load("convex/adminAccountSessionV2.ts");
let ready = false;
setMock("./adminAccountSessionV2", { ...identityAuth, adminSessionMigrationReady: () => ready });
const inspections = load("convex/returnInspections.ts");
const hash = value => createHash("sha256").update(value).digest("hex");
const identity = "https://identity.example|return-admin", token = "a".repeat(64);
const ctx = { db, auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) } };
const booking = put("bookings", { status: "returned", lineItems: [], depositAmount: 50, depositRefunded: true, depositRefundAmount: 50 });
const args = { token, bookingId: booking._id };

(async () => {
  process.env.ADMIN_TOKEN = "legacy-return-context-fixture";
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["rentals:read", "payments:read"] });
  await sessions.createSession.handler(ctx, { tokenDigest: hash(token), principalId: `admin:${hash(identity)}`, scopes: ["rentals:read", "payments:read"], expiresAt: Date.now() + 60_000 });
  process.env.ADMIN_SESSION_RETURN_CONTEXT_V2 = "enabled";
  await assert.rejects(inspections.context.handler(ctx, args), /not ready/);
  await assert.rejects(inspections.context.handler(ctx, { ...args, token: process.env.ADMIN_TOKEN }), /not ready/);
  ready = true;
  await assert.rejects(inspections.context.handler(ctx, { ...args, token: process.env.ADMIN_TOKEN }), /unauthorized/);
  const context = await inspections.context.handler(ctx, args);
  assert.equal(context.bookingId, booking._id);assert.equal(context.depositRefundAmount, 50);
  await assert.rejects(inspections.context.handler({ ...ctx, auth: { getUserIdentity: async () => null } }, args), /unauthorized/);
  await assert.rejects(inspections.context.handler({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "different" }) } }, args), /unauthorized/);
  for (const scopes of [["rentals:read"], ["payments:read"]]) {
    process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: scopes });
    await assert.rejects(inspections.context.handler(ctx, args), /unauthorized/, 'Both scopes are required');
  }
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["rentals:read", "payments:read"] });
  const narrowToken = "b".repeat(64);
  await sessions.createSession.handler(ctx, { tokenDigest: hash(narrowToken), principalId: `admin:${hash(identity)}`, scopes: ["rentals:read"], expiresAt: Date.now() + 60_000 });
  await assert.rejects(inspections.context.handler(ctx, { ...args, token: narrowToken }), /unauthorized/, 'Assignment cannot expand a restricted session');
  const session = tables.get("admin_sessions_v2").find(row => row.tokenDigest === hash(token));
  await db.patch(session._id, { expiresAt: Date.now() });
  await assert.rejects(inspections.context.handler(ctx, args), /unauthorized/, 'Expired sessions cannot inspect deposits');
  await db.patch(session._id, { expiresAt: Date.now() + 60_000 });
  await sessions.revoke.handler(ctx, { tokenDigest: hash(token) });
  await assert.rejects(inspections.context.handler(ctx, args), /unauthorized/);
  delete process.env.ADMIN_SESSION_RETURN_CONTEXT_V2;
  assert.equal((await inspections.context.handler(ctx, { ...args, token: process.env.ADMIN_TOKEN })).bookingId, booking._id);
  console.log("PASS staged return-context access: closed gate, both scopes, identity, expiry, revocation and legacy compatibility; synthetic data only.");
})().catch(error => { console.error(error); process.exitCode = 1; });
