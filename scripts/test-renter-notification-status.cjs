const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { getRenterNotificationStatus } = load("src/lib/renterNotificationStatus.ts");

const configured = {
  stateLoaded: true,
  configured: true,
  publicKey: "synthetic-public-key",
  supported: true,
  ios: false,
  installed: false,
  ready: true,
  setupError: false,
  enabled: false,
  connected: false,
  permissionGranted: false,
  messagesEnabled: true,
};

assert.equal(getRenterNotificationStatus({ ...configured, stateLoaded: false }), "unknown");
assert.equal(getRenterNotificationStatus({ ...configured, configured: false }), "unavailable", "Missing provider keys do not invite a renter to enable an impossible feature");
assert.equal(getRenterNotificationStatus({ ...configured, publicKey: null }), "unavailable");
assert.equal(getRenterNotificationStatus({ ...configured, supported: false }), "unavailable", "Unsupported browsers do not get a dead enable CTA");
assert.equal(getRenterNotificationStatus({ ...configured, ready: false }), "unknown", "Wait for service-worker setup before showing the invite");
assert.equal(getRenterNotificationStatus({ ...configured, ready: false, setupError: true }), "unavailable", "A failed worker setup does not show a disabled invitation");
assert.equal(getRenterNotificationStatus({ ...configured, ios: true, installed: false, supported: false }), "inactive", "Configured iPhone users still receive the Home Screen setup invitation");
assert.equal(getRenterNotificationStatus({ ...configured, enabled: true, connected: true, permissionGranted: true }), "active");
assert.equal(getRenterNotificationStatus({ ...configured, enabled: true, connected: true, permissionGranted: true, messagesEnabled: false }), "inactive", "Chat-disabled devices can be invited to re-enable chat alerts");
assert.equal(getRenterNotificationStatus({ ...configured, enabled: false, connected: false, permissionGranted: false }), "inactive", "denied or not-yet-granted browser permission keeps the setup guidance available for recovery");
console.log("PASS renter notification readiness: configured platforms, unsupported browsers, iPhone install guidance, and subscription states.");
