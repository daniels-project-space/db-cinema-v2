const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { adminGoogleProvider } = load("convex/lib/adminGoogleProvider.ts");
const id = "123456789-fixture.apps.googleusercontent.com";
assert.deepEqual(adminGoogleProvider(id), {
  type: "customJwt",
  issuer: "https://accounts.google.com",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
  algorithm: "RS256",
  applicationID: id,
});
for (const candidate of ["", "fixture", "apps.googleusercontent.com", "http://evil.invalid", "fixture.apps.googleusercontent.com.evil.invalid", "fixture.apps.googleusercontent.com ", "*", "x".repeat(201)])
  assert.throws(() => adminGoogleProvider(candidate), /specific Google OAuth client ID/);
console.log("PASS staged Google identity provider configuration: pinned issuer, keys, RS256 and required exact audience; no provider configured.");
