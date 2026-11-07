const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const access = harness.load("convex/adminAccountSessionV2.ts");
const sessions = harness.load("convex/adminSessionsV2.ts");
const issuer = harness.load("convex/adminSessionIssuerV2.ts");
const { makeAdminSessionAttestation } = harness.load("src/lib/adminSessionGateway.ts");
const hash = value => createHash("sha256").update(value).digest("hex");
const identities = { "admina.fixture.signature": "https://identity.example|admin-a", "adminb.fixture.signature": "https://identity.example|admin-b" };
const context = jwt => ({ db: harness.db, auth: { getUserIdentity: async () => identities[jwt] ? { tokenIdentifier: identities[jwt] } : null } });
class ConvexFixture {
  setAuth(value) { this.jwt = value; }
  async query(_ref, args) { await access.assertAdminScopeSession(context(this.jwt), args.token, args.scope); return { ok: true }; }
  async mutation(_ref, args) { await access.revokeOwnSessionInTransaction(context(this.jwt), args.token); }
}
harness.setMock("convex/browser", { ConvexHttpClient: ConvexFixture });
const { createAdminAuthController } = harness.load("src/lib/adminAuthController.ts");
process.env.ADMIN_SESSION_GATEWAY_HMAC_V2 = "11".repeat(32);
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identities["admina.fixture.signature"]]: ["customers:read"], [identities["adminb.fixture.signature"]]: ["customers:read"] });
let delay = false, release, issuedDuringDelay;
const fetcher = async (url, init) => {
  const jwt = init.headers.Authorization.slice(7), subject = identities[jwt];
  if (!subject) return new Response("Unauthorized", { status: 401 });
  if (url.startsWith("/api/")) return Response.json(makeAdminSessionAttestation(hash(subject), "203.0.113.4", process.env.ADMIN_SESSION_GATEWAY_HMAC_V2));
  const ctx = { ...context(jwt), runMutation: async (_ref, args) => sessions.admitAndCreateSession.handler(context(jwt), args) };
  const result = await issuer.issue.handler(ctx, { attestation: JSON.parse(init.body) });
  if (delay) { issuedDuringDelay = result.token; await new Promise(resolve => { release = resolve; }); }
  return Response.json(result);
};

(async () => {
  const controller = createAdminAuthController({ convexUrl: "https://fixture.convex.cloud", convexSiteUrl: "https://fixture.convex.site", scope: "customers:read", fetcher });
  let notifications = 0; const unsubscribe = controller.subscribe(() => { notifications++; });
  assert.equal(await controller.fetchAccessToken(), null);
  await controller.connect("admina.fixture.signature");
  const first = controller.current().token;
  assert.equal(await controller.fetchAccessToken(), "admina.fixture.signature");
  assert.equal(await controller.refresh(), true);
  await controller.connect("adminb.fixture.signature");
  const second = controller.current().token;
  assert.notEqual(first, second);
  assert.equal(await sessions.authorize.handler(context("admina.fixture.signature"), { tokenDigest: hash(first), scope: "customers:read" }), null);
  assert.equal(await controller.fetchAccessToken(), "adminb.fixture.signature");
  await controller.disconnect();
  assert.equal(controller.current(), null);
  assert.equal(await controller.fetchAccessToken(), null);
  assert.equal(await sessions.authorize.handler(context("adminb.fixture.signature"), { tokenDigest: hash(second), scope: "customers:read" }), null);
  delay = true;
  const opening = controller.connect("admina.fixture.signature");
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await controller.disconnect(); release();
  await assert.rejects(opening, /cancelled/);
  assert.equal(controller.current(), null);
  assert.equal(await sessions.authorize.handler(context("admina.fixture.signature"), { tokenDigest: hash(issuedDuringDelay), scope: "customers:read" }), null);
  assert(notifications >= 5);unsubscribe();
  console.log("PASS admin controller: identity switch, notifications, revocation and late sign-in cancellation; provider and gates mocked.");
})().catch(error => { console.error(error); process.exitCode = 1; });
