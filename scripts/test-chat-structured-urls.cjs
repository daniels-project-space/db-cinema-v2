const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");

const { approvedChatLink, approvedStripeCheckoutUrl, approvedCheckoutCartPath, approvedGearListingPath } = load("src/lib/chatLinks.ts");
const stripeUrl = "https://checkout.stripe.com/c/pay/cs_test_valid-session";
const stripeUrlWithQueryAndFragment = `${stripeUrl}?prefilled_email=renter%40example.com#checkout`;

assert.equal(approvedChatLink("/contact")?.toString(), "https://dbcinemarentals.com/contact");
assert.equal(approvedChatLink("https://www.dbcinemarentals.com/how-it-works")?.hostname, "www.dbcinemarentals.com");
assert.equal(approvedChatLink("https://verify.didit.me/session/abc")?.hostname, "verify.didit.me");
assert.equal(approvedChatLink("https://www.google.com/maps/search/Trafalgar+Square")?.hostname, "www.google.com");
assert.equal(approvedChatLink("mailto:dbcinemarentals@gmail.com?subject=Rental%20support")?.protocol, "mailto:");
assert.equal(approvedStripeCheckoutUrl(stripeUrl), stripeUrl);
assert.equal(approvedStripeCheckoutUrl("https://checkout.stripe.com:443/c/pay/cs_test_valid-session"), stripeUrl);
assert.equal(approvedStripeCheckoutUrl(stripeUrlWithQueryAndFragment), stripeUrlWithQueryAndFragment);
assert.equal(approvedChatLink("https://checkout.stripe.com/c/pay/cs_live_liveSession42?client_reference_id=booking#payment")?.toString(), "https://checkout.stripe.com/c/pay/cs_live_liveSession42?client_reference_id=booking#payment", "valid Stripe session links remain clickable in ordinary chat text, including query strings and fragments");

for (const value of [
  "javascript:alert(1)",
  "//evil.example/pay",
  "/\\evil.example/pay",
  "http://checkout.stripe.com/c/pay/cs_test_invalid",
  "https://checkout.stripe.com.evil.example/c/pay/cs_test_invalid",
  "https://evil.example/checkout.stripe.com",
  "https://user@checkout.stripe.com/c/pay/cs_test_invalid",
  "https://checkout.stripe.com:8443/c/pay/cs_test_invalid",
  "https://checkout.stripe.com/",
  "https://checkout.stripe.com/pay/cs_test_valid-session",
  "https://checkout.stripe.com/c/pay/not-a-session",
  "https://checkout.stripe.com/c/pay/cs_test_valid-session/continue",
  "https://checkout.stripe.com/c/pay/cs_test_valid-session%2Fcontinue",
  "mailto:attacker@example.com",
]) {
  assert.equal(approvedChatLink(value), null, `untrusted chat target is rejected: ${value}`);
  assert.equal(approvedStripeCheckoutUrl(value), null, `untrusted payment target is rejected: ${value}`);
}

const cartPath = `/cart/quote/${"A".repeat(43)}`;
assert.equal(approvedCheckoutCartPath(cartPath), cartPath);
for (const value of [`https://evil.example${cartPath}`, `/cart/quote/${"A".repeat(42)}`, `/cart/quote/${"A".repeat(44)}`, `//evil.example${cartPath}`])
  assert.equal(approvedCheckoutCartPath(value), null, `invalid checkout-cart route is rejected: ${value}`);

assert.equal(approvedGearListingPath("sony-fx3"), "/gear/sony-fx3");
assert.equal(approvedGearListingPath("sony_fx3-2"), "/gear/sony_fx3-2");
for (const value of ["../admin", "/admin", "sony/fx3", "https://evil.example", "", null])
  assert.equal(approvedGearListingPath(value), null, `unsafe catalogue slug is rejected: ${value}`);

console.log("PASS chat URL policy: valid first-party, Didit, Google Maps and Stripe Checkout Session URLs remain accepted; unsafe schemes, hosts, credentials and same-host wrong-path payment targets are rejected.");
