const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const access = harness.load("convex/adminAccountSessionV2.ts");
let ready = false;
harness.setMock("./adminAccountSessionV2", { ...access, adminSessionMigrationReady: () => ready });
const notifications = harness.load("convex/adminNotifications.ts");
const sessions = harness.load("convex/adminSessionsV2.ts");
const identity = "https://identity.example|notifications-fixture", read = "a".repeat(64), write = "b".repeat(64);
const hash = value => createHash("sha256").update(value).digest("hex");
const ctx = { db: harness.db, auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) } };
process.env.ADMIN_TOKEN = "legacy-notification-fixture";
process.env.ADMIN_SESSION_NOTIFICATIONS_V2 = "enabled";
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["settings:read", "settings:write"] });

(async () => {
  assert.equal(access.adminSessionMigrationReady(), false);
  for (const name of ["device", "latest", "settings", "subscribe", "disable", "acknowledge", "preferences", "retry"])
    await assert.rejects(notifications[name].handler(ctx, { token: process.env.ADMIN_TOKEN }), /not ready/, name);
  ready = true;
  for (const [token, scope] of [[read, "settings:read"], [write, "settings:write"]])
    await sessions.createSession.handler(ctx, { tokenDigest: hash(token), principalId: `admin:${hash(identity)}`, scopes: [scope], expiresAt: Date.now() + 60_000 });
  const device = harness.put("admin_push_subscriptions", { deviceId: "fixture-device", enabled: true, updatedAt: Date.now() });
  assert.equal((await notifications.device.handler(ctx, { token: read, deviceId: device.deviceId })).enabled, true);
  await assert.rejects(notifications.device.handler(ctx, { token: write, deviceId: device.deviceId }), /unauthorized/);
  await assert.rejects(notifications.disable.handler(ctx, { token: read, deviceId: device.deviceId }), /unauthorized/);
  await assert.rejects(notifications.disable.handler(ctx, { token: process.env.ADMIN_TOKEN, deviceId: device.deviceId }), /unauthorized/);
  await assert.rejects(notifications.disable.handler({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "other" }) } }, { token: write, deviceId: device.deviceId }), /unauthorized/);
  await notifications.disable.handler(ctx, { token: write, deviceId: device.deviceId });
  assert.equal(device.enabled, false);
  assert(harness.tables.get("admin_audit_log").some(entry => entry.fn === "adminNotifications.disable"));
  await sessions.revoke.handler(ctx, { tokenDigest: hash(write) });
  await assert.rejects(notifications.disable.handler(ctx, { token: write, deviceId: device.deviceId }), /unauthorized/);
  await sessions.revoke.handler(ctx, { tokenDigest: hash(read) });
  await assert.rejects(notifications.latest.handler(ctx, { token: read }), /unauthorized/);
  delete process.env.ADMIN_SESSION_NOTIFICATIONS_V2;
  assert.equal((await notifications.device.handler(ctx, { token: process.env.ADMIN_TOKEN, deviceId: device.deviceId })).enabled, false);
  console.log("PASS notification admin session gate, scopes, identity, revocation, audit and legacy compatibility; readiness mocked only in test.");
})().catch(error => { console.error(error); process.exitCode = 1; });
