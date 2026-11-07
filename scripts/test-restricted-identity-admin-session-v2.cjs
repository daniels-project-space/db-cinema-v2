const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const access = harness.load("convex/adminAccountSessionV2.ts");
let ready = false;
harness.setMock("./adminAccountSessionV2", { ...access, adminSessionMigrationReady: () => ready });
const alerts = harness.load("convex/restrictedIdentityAlerts.ts");
const sessions = harness.load("convex/adminSessionsV2.ts");
const identity = "https://identity.example|restricted-alert-fixture", read = "a".repeat(64), write = "b".repeat(64);
const hash = value => createHash("sha256").update(value).digest("hex");
const ctx = { db: harness.db, auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) } };
process.env.ADMIN_TOKEN = "legacy-alert-fixture";
process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2 = "enabled";
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["verification:read", "verification:write"] });

(async () => {
  assert.equal(access.adminSessionMigrationReady(), false);
  for (const name of ["attention", "recheckAttention", "retry", "retryRecheck"])
    await assert.rejects(alerts[name].handler(ctx, { token: process.env.ADMIN_TOKEN }), /not ready/, name);
  ready = true;
  for (const [token, scope] of [[read, "verification:read"], [write, "verification:write"]])
    await sessions.createSession.handler(ctx, { tokenDigest: hash(token), principalId: `admin:${hash(identity)}`, scopes: [scope], expiresAt: Date.now() + 60_000 });
  const job = harness.put("restricted_identity_alert_jobs", { bookingId: "fixture-booking", state: "attention", generation: 1, attempts: 5, updatedAt: Date.now(), dueAt: Date.now() });
  assert.equal((await alerts.attention.handler(ctx, { token: read })).length, 1);
  await assert.rejects(alerts.attention.handler(ctx, { token: write }), /unauthorized/);
  await assert.rejects(alerts.retry.handler(ctx, { token: read, id: job._id }), /unauthorized/);
  await assert.rejects(alerts.retry.handler(ctx, { token: process.env.ADMIN_TOKEN, id: job._id }), /unauthorized/);
  await assert.rejects(alerts.retry.handler({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "other" }) } }, { token: write, id: job._id }), /unauthorized/);
  await alerts.retry.handler(ctx, { token: write, id: job._id });
  assert.equal(job.state, "pending");
  assert(harness.tables.get("admin_audit_log").some(entry => entry.fn === "restrictedIdentityAlerts.retry"));
  await sessions.revoke.handler(ctx, { tokenDigest: hash(write) });
  await assert.rejects(alerts.retry.handler(ctx, { token: write, id: job._id }), /unauthorized/);
  await sessions.revoke.handler(ctx, { tokenDigest: hash(read) });
  await assert.rejects(alerts.attention.handler(ctx, { token: read }), /unauthorized/);
  delete process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2;
  assert.deepEqual(await alerts.attention.handler(ctx, { token: process.env.ADMIN_TOKEN }), []);
  console.log("PASS restricted identity alert session gate, scopes, identity, revocation, audit and legacy compatibility; readiness mocked only in test.");
})().catch(error => { console.error(error); process.exitCode = 1; });
