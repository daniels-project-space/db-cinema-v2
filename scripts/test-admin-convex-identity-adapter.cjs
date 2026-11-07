const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const access = harness.load("convex/adminAccountSessionV2.ts");
const sessions = harness.load("convex/adminSessionsV2.ts");
const identity = "https://accounts.google.com|synthetic-google-subject", jwt = "fixture.payload.signature";
const token = "a".repeat(64), hash = value => createHash("sha256").update(value).digest("hex");
const context = value => ({ db: harness.db, auth: { getUserIdentity: async () => value === jwt ? { tokenIdentifier: identity } : null } });
class ConvexFixture {
  constructor(url) { assert.equal(url, "https://fixture.convex.cloud"); }
  setAuth(value) { this.jwt = value; }
  async query(ref, args) { assert.equal(ref, "adminAccountSessionV2.checkSession"); await access.assertAdminScopeSession(context(this.jwt), args.token, args.scope); return { ok: true }; }
  async mutation(ref, args) { assert.equal(ref, "adminAccountSessionV2.signOut"); await access.revokeOwnSessionInTransaction(context(this.jwt), args.token); }
}
harness.setMock("convex/browser", { ConvexHttpClient: ConvexFixture });
const { createAdminConvexIdentityAdapter } = harness.load("src/lib/adminConvexIdentityAdapter.ts");
const { createAdminSessionClient } = harness.load("src/lib/adminSessionClient.ts");
const { makeAdminSessionAttestation } = harness.load("src/lib/adminSessionGateway.ts");
const issuer = harness.load("convex/adminSessionIssuerV2.ts");
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["customers:read"] });
process.env.ADMIN_SESSION_GATEWAY_HMAC_V2 = "11".repeat(32);

(async () => {
  for (const url of ["https://evil.invalid", "http://fixture.convex.cloud", "https://fixture.convex.cloud/path"])
    assert.throws(() => createAdminConvexIdentityAdapter(url, "customers:read"), /Invalid/);
  assert.throws(() => createAdminConvexIdentityAdapter("https://fixture.convex.cloud", "admin"), /Invalid/);
  const adapter = createAdminConvexIdentityAdapter("https://fixture.convex.cloud", "customers:read");
  assert.throws(() => adapter.setCredential("not-a-jwt"), /Invalid/);
  assert.equal(await adapter.getIdentity(), null);
  adapter.setCredential(jwt);
  assert.equal(await adapter.fetchAccessToken(), jwt);
  const admin = await adapter.getIdentity();
  await sessions.createSession.handler(context(jwt), { tokenDigest: hash(token), principalId: `admin:${hash(identity)}`, scopes: ["customers:read"], expiresAt: Date.now() + 60_000 });
  assert.equal(await adapter.validate(token, admin), true);
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: [] });
  await assert.rejects(adapter.validate(token, admin), /unauthorized/);
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["customers:read"] });
  adapter.setCredential("other.payload.signature");
  assert.equal(await adapter.validate(token, admin), false, "changing credential cannot validate the old identity");
  adapter.clearCredential();
  assert.equal(await adapter.fetchAccessToken(), null);
  await adapter.revoke(token, admin);
  adapter.setCredential(jwt);
  await assert.rejects(adapter.validate(token, await adapter.getIdentity()), /unauthorized/);
  const issuerCtx = { ...context(jwt), runMutation: async (_ref, args) => sessions.admitAndCreateSession.handler(context(jwt), args) };
  const sessionClient = createAdminSessionClient({ convexSiteUrl: "https://fixture.convex.site", ...adapter, fetcher: async (url, init) => {
    if (url.startsWith("/api/")) return Response.json(makeAdminSessionAttestation(hash(identity), "203.0.113.1", process.env.ADMIN_SESSION_GATEWAY_HMAC_V2));
    const issued = await issuer.issue.handler(issuerCtx, { attestation: JSON.parse(init.body) });
    return Response.json(issued);
  } });
  const opened = await sessionClient.open();
  assert.equal(sessionClient.current().token, opened.token);
  assert.equal(await sessionClient.refresh(), true);
  await sessionClient.close();
  await assert.rejects(adapter.validate(opened.token, await adapter.getIdentity()), /unauthorized/);
  console.log("PASS Convex admin identity adapter: credential separation, server scope checks, identity change and revocation; Convex identity mocked.");
})().catch(error => { console.error(error); process.exitCode = 1; });
