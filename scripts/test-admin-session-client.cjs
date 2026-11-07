const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { createAdminSessionClient } = load("src/lib/adminSessionClient.ts");
const token = "a".repeat(64), identity = { jwt: "identity-fixture" };
const attestation = { clientDigest: "b".repeat(64), nonce: "c".repeat(64), mac: "d".repeat(64), issuedAt: Date.now() };
const revoked = [], requests = [];
const options = {
  convexSiteUrl: "https://synthetic.convex.site/",
  getIdentity: async () => identity,
  revoke: async (value, owner) => { revoked.push({ value, owner }); },
  validate: async () => true,
  fetcher: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(url.startsWith("/api/") ? attestation : { token, expiresAt: Date.now() + 60_000 }), { status: 200 });
  },
};

(async () => {
  for (const url of ["https://evil.invalid", "http://synthetic.convex.site", "https://synthetic.convex.site/path", "https://user@synthetic.convex.site/"])
    assert.throws(() => createAdminSessionClient({ ...options, convexSiteUrl: url }), /Invalid/);
  const client = createAdminSessionClient(options);
  assert.equal(client.current(), null);
  assert.equal((await client.open()).token, token);
  assert.equal(requests[0].url, "/api/admin/session-attestation");
  assert.equal(requests[1].url, "https://synthetic.convex.site/admin-session");
  assert.deepEqual(client.current().headers, { Authorization: "Bearer identity-fixture", "X-DBC-Admin-Session": token });
  assert.equal(await client.refresh(), true);
  await assert.rejects(client.open(), /Sign out/);
  await client.close();
  assert.equal(client.current(), null);
  assert.deepEqual(revoked, [{ value: token, owner: identity }]);
  const broken = createAdminSessionClient({ ...options, revoke: async () => { throw Error("revocation unavailable"); } });
  await broken.open();
  await assert.rejects(broken.close(), /revocation unavailable/);
  assert.equal(broken.current(), null, "local access ends even if remote revocation fails");
  let finish;
  const delayed = createAdminSessionClient({ ...options, fetcher: async url => url.startsWith("/api/")
    ? new Response(JSON.stringify(attestation), { status: 200 })
    : new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify({ token, expiresAt: Date.now() + 60_000 }), { status: 200 })); }) });
  const opening = delayed.open();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await delayed.close();
  finish();
  await assert.rejects(opening, /cancelled/);
  assert.equal(delayed.current(), null);
  assert.equal(revoked.length, 2, "a late session response is revoked instead of restoring access");
  const missing = createAdminSessionClient({ ...options, getIdentity: async () => null });
  await assert.rejects(missing.open(), /identity unavailable/);
  const unauthorized = createAdminSessionClient({ ...options, fetcher: async () => new Response("Unauthorized", { status: 401 }) });
  await assert.rejects(unauthorized.open(), /session unavailable/);
  let identityNow = identity, validation = true;
  const checked = createAdminSessionClient({ ...options, getIdentity: async () => identityNow, validate: async () => validation });
  await checked.open();
  validation = false;
  assert.equal(await checked.refresh(), false);
  assert.equal(checked.current(), null, "revoked sessions are no longer available locally");
  validation = true;
  await checked.open();
  identityNow = { jwt: "different-identity" };
  assert.equal(await checked.refresh(), false);
  assert.equal(checked.current(), null, "changing identity clears the old session");
  const failedValidation = createAdminSessionClient({ ...options, validate: async () => false });
  await assert.rejects(failedValidation.open(), /identity or session changed/);
  assert.equal(failedValidation.current(), null);
  let rejectValidation = false;
  const temporarilyUnavailable = createAdminSessionClient({ ...options, validate: async () => { if (rejectValidation) throw Error("offline"); return true; } });
  await temporarilyUnavailable.open();
  rejectValidation = true;
  await assert.rejects(temporarilyUnavailable.refresh(), /offline/);
  assert.equal(temporarilyUnavailable.current(), null, "an unavailable validation must not leave the session usable");
  rejectValidation = false;
  assert.equal(await temporarilyUnavailable.refresh(), true);
  console.log("PASS in-memory admin browser session lifecycle, URL validation, logout, late response, and error fixtures; identity mocked.");
})().catch(error => { console.error(error); process.exitCode = 1; });
