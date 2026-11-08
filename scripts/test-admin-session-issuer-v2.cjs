const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
globalThis.crypto ??= nodeCrypto.webcrypto;
const { load, db, tables } = require("./lib/rentalTestHarness.cjs");
const sessions = load("convex/adminSessionsV2.ts");
const issuer = load("convex/adminSessionIssuerV2.ts");
const sha256 = value => nodeCrypto.createHash("sha256").update(value).digest("hex");
const gatewayKey = Buffer.alloc(32, 17);
const identity = "fixture-issuer|fixture-admin";
const now = Date.now();
const oldNow = Date.now;
const oldScopes = process.env.ADMIN_SESSION_SCOPES_V2;
const oldKey = process.env.ADMIN_SESSION_GATEWAY_HMAC_V2;
let nonceCounter = 0;

function attestation(clientDigest = "a".repeat(64), tokenIdentifier = identity, issuedAt = now) {
  const nonce = sha256(`fixture-${++nonceCounter}`);
  const message = `dbc-admin-session-v2|${sha256(tokenIdentifier)}|${clientDigest}|${nonce}|${issuedAt}`;
  return { clientDigest, nonce, issuedAt, mac: nodeCrypto.createHmac("sha256", gatewayKey).update(message).digest("hex") };
}
function context(tokenIdentifier = identity) {
  return {
    auth: { getUserIdentity: async () => tokenIdentifier ? { tokenIdentifier } : null },
    runMutation: async (ref, args) => {
      assert.equal(ref, "adminSessionsV2.admitAndCreateSession");
      return sessions.admitAndCreateSession.handler({ db }, args);
    },
  };
}

(async () => {
  Date.now = () => now;
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["rentals:read"] });
  process.env.ADMIN_SESSION_GATEWAY_HMAC_V2 = gatewayKey.toString("hex");
  assert.equal(await issuer.issue.handler(context(null), { attestation: attestation() }), null);
  assert.equal(await issuer.issue.handler(context("other"), { attestation: attestation() }), null);
  const modified = attestation();
  assert.equal(await issuer.issue.handler(context(), { attestation: { ...modified, clientDigest: "b".repeat(64) } }), null);
  assert.equal(await issuer.issue.handler(context(), { attestation: { ...modified, mac: "0".repeat(64) } }), null);
  assert.equal(await issuer.issue.handler(context(), { attestation: attestation("a".repeat(64), identity, now - 120_000) }), null);
  const signed = attestation();
  const first = await issuer.issue.handler(context(), { attestation: signed });
  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.equal(first.expiresAt, now + 3_600_000);
  assert.equal(await issuer.issue.handler(context(), { attestation: signed }), null);
  const second = await issuer.issue.handler(context(), { attestation: attestation() });
  assert.notEqual(first.token, second.token);
  const stored = tables.get("admin_sessions_v2");
  assert.equal(stored.length, 2);
  assert(stored.some(row => row.tokenDigest === sha256(first.token)));
  assert(!JSON.stringify(stored).includes(first.token));
  assert.equal(await sessions.authorizeSessionInTransaction({ db }, sha256(first.token), "payments:write"), null);
  assert((await sessions.authorizeSessionInTransaction({ db }, sha256(first.token), "rentals:read"))?.principalId);
  for (let count = 0; count < 3; count++) assert(await issuer.issue.handler(context(), { attestation: attestation() }));
  const acceptedNonces = tables.get("admin_login_attestation_nonces_v2").length;
  for (let count = 0; count < 50; count++)
    assert.equal(await issuer.issue.handler(context(), { attestation: attestation() }), null);
  assert.equal(tables.get("admin_login_attestation_nonces_v2").length, acceptedNonces);
  assert(await issuer.issue.handler(context(), { attestation: attestation("b".repeat(64)) }));
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["root"] });
  assert.equal(await issuer.issue.handler(context(), { attestation: attestation("c".repeat(64)) }), null);
  delete process.env.ADMIN_SESSION_GATEWAY_HMAC_V2;
  assert.equal(await issuer.issue.handler(context(), { attestation: attestation("d".repeat(64)) }), null);
  console.log("PASS internal session issuer: authenticated subject, signed client binding, replay, expiry, scope, throttle and token secrecy fixtures");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Date.now = oldNow;
  if (oldScopes === undefined) delete process.env.ADMIN_SESSION_SCOPES_V2; else process.env.ADMIN_SESSION_SCOPES_V2 = oldScopes;
  if (oldKey === undefined) delete process.env.ADMIN_SESSION_GATEWAY_HMAC_V2; else process.env.ADMIN_SESSION_GATEWAY_HMAC_V2 = oldKey;
});
