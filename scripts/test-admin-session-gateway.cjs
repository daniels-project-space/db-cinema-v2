const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const helper = harness.load("src/lib/adminSessionGateway.ts");
let ready = false;
harness.setMock("@/lib/adminSessionGateway", { ...helper, adminSessionGatewayReady: () => ready });
const identity = "https://identity.example|gateway-fixture";
const hash = value => createHash("sha256").update(value).digest("hex");
const access = harness.load("convex/adminAccountSessionV2.ts");
class ConvexFixture {
  setAuth(token) { this.token = token; }
  async query(ref) {
    assert.equal(ref, "adminAccountSessionV2.gatewayIdentityDigest");
    return access.assignedIdentityDigest({ auth: { getUserIdentity: async () => this.token === "valid-identity-jwt" ? { tokenIdentifier: identity } : null } });
  }
}
harness.setMock("convex/browser", { ConvexHttpClient: ConvexFixture });
const gateway = harness.load("src/app/api/admin/session-attestation/route.ts");
const issuer = harness.load("convex/adminSessionIssuerV2.ts");
const sessions = harness.load("convex/adminSessionsV2.ts");
const secret = "11".repeat(32);
process.env.VERCEL = "1"; process.env.ADMIN_SESSION_GATEWAY_ORIGIN = "https://dbcinemarentals.com";
process.env.NEXT_PUBLIC_CONVEX_URL = "https://fixture.convex.cloud";
process.env.ADMIN_SESSION_GATEWAY_HMAC_V2 = secret;
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["customers:read"] });
const request = (headers = {}) => new Request("https://dbcinemarentals.com/api/admin/session-attestation", {
  method: "POST", headers: { origin: "https://dbcinemarentals.com", authorization: "Bearer valid-identity-jwt", "x-vercel-forwarded-for": "203.0.113.1", ...headers },
});
const ctx = { db: harness.db, auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) } };
ctx.runMutation = async (_ref, args) => sessions.admitAndCreateSession.handler(ctx, args);

(async () => {
  assert.equal((await gateway.POST(request())).status, 503);
  await assert.rejects(access.gatewayIdentityDigest.handler(ctx, {}), /not ready/);
  ready = true;
  assert.equal((await gateway.POST(request({ origin: "https://foreign.invalid" }))).status, 401);
  assert.equal((await gateway.POST(request({ authorization: "Bearer invalid" }))).status, 401);
  assert.equal((await gateway.POST(request({ "x-vercel-forwarded-for": "203.0.113.1, 198.51.100.1" }))).status, 401);
  assert.equal((await gateway.POST(request({ "x-vercel-forwarded-for": "", "x-forwarded-for": "203.0.113.1" }))).status, 401);
  const response = await gateway.POST(request({ "x-forwarded-for": "198.51.100.2" }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const attestation = await response.json();
  const issued = await issuer.issue.handler(ctx, { attestation });
  assert.match(issued.token, /^[a-f0-9]{64}$/);
  assert.equal(await issuer.issue.handler(ctx, { attestation }), null);
  const otherIp = helper.makeAdminSessionAttestation(hash(identity), "203.0.113.2", secret, attestation.issuedAt);
  assert.notEqual(attestation.clientDigest, otherIp.clientDigest);
  assert.equal(helper.makeAdminSessionAttestation(hash(identity), "2001:db8::1", secret).clientDigest,
    helper.makeAdminSessionAttestation(hash(identity), "2001:0db8:0:0:0:0:0:1", secret).clientDigest);
  console.log("PASS gated gateway identity, origin, trusted-IP selection, signed attestation and issuer replay fixtures; Vercel and identity mocked.");
})().catch(error => { console.error(error); process.exitCode = 1; });
