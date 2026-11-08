const assert = require("node:assert/strict");
const { load, db, tables } = require("./lib/rentalTestHarness.cjs");
const sessions = load("convex/adminSessionsV2.ts");
const ctx = { db };
const digest = digit => digit.repeat(64);
const originalNow = Date.now;

(async () => {
  let now = 1_800_000_000_000;
  Date.now = () => now;
  for (let attempt = 0; attempt < 5; attempt++)
    assert.equal((await sessions.consumeLoginAttempt.handler(ctx, { trustedClientDigest: digest("a") })).allowed, true);
  const limited = await sessions.consumeLoginAttempt.handler(ctx, { trustedClientDigest: digest("a") });
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterMs, 900_000);
  assert.equal((await sessions.consumeLoginAttempt.handler(ctx, { trustedClientDigest: digest("b") })).allowed, true);
  await assert.rejects(sessions.consumeLoginAttempt.handler(ctx, { trustedClientDigest: "untrusted" }), /Invalid/);
  assert.equal(tables.get("admin_login_attempt_windows_v2").length, 2);
  now += 900_000;
  assert.equal((await sessions.consumeLoginAttempt.handler(ctx, { trustedClientDigest: digest("a") })).allowed, true);

  const session = { tokenDigest: digest("c"), principalId: "admin:fixture", scopes: ["rentals:read"], expiresAt: now + 60_000 };
  await sessions.createSession.handler(ctx, session);
  assert.deepEqual(await sessions.authorize.handler(ctx, { tokenDigest: digest("c"), scope: "rentals:read" }), { principalId: "admin:fixture" });
  assert.deepEqual(await sessions.authorizeSessionInTransaction(ctx, digest("c"), "rentals:read"), { principalId: "admin:fixture" });
  assert.equal(await sessions.authorize.handler(ctx, { tokenDigest: digest("c"), scope: "payments:write" }), null);
  await assert.rejects(sessions.createSession.handler(ctx, session), /already exists/);
  for (const changes of [
    { tokenDigest: "invalid" }, { principalId: "" }, { scopes: [] },
    { scopes: ["unknown"] }, { scopes: ["rentals:read", "rentals:read"] },
    { expiresAt: now }, { expiresAt: now + 12 * 60 * 60 * 1000 + 1 },
  ]) await assert.rejects(sessions.createSession.handler(ctx, { ...session, ...changes }), /Invalid/);
  assert.equal(await sessions.revoke.handler(ctx, { tokenDigest: digest("c") }), true);
  assert.equal(await sessions.revoke.handler(ctx, { tokenDigest: digest("c") }), true);
  assert.equal(await sessions.authorize.handler(ctx, { tokenDigest: digest("c"), scope: "rentals:read" }), null);
  assert.equal(await sessions.revoke.handler(ctx, { tokenDigest: digest("d") }), false);
  await sessions.createSession.handler(ctx, { ...session, tokenDigest: digest("d") });
  now += 60_000;
  assert.equal(await sessions.authorize.handler(ctx, { tokenDigest: digest("d"), scope: "rentals:read" }), null);
  const cleaned = await sessions.cleanupExpired.handler(ctx, {});
  assert.equal(cleaned.sessions, 2);
  assert.equal(cleaned.windows, 1);
  console.log("PASS internal admin session scope, revocation, expiry, bounded cleanup and per-key attempt window fixtures");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Date.now = originalNow; });
