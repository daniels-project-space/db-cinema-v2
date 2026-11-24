const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { renterFacingError } = load("src/lib/renterFacingError.ts");

assert.equal(renterFacingError(new Error("Uncaught Error: Choose a new start date and wait for the live availability check."), "Try again."), "Choose a new start date and wait for the live availability check.");
assert.equal(renterFacingError({ data: { message: "Your rental is unchanged. Refresh and try again." } }, "Try again."), "Your rental is unchanged. Refresh and try again.");
assert.equal(renterFacingError(new Error("Failed to fetch"), "Try again."), "Connection problem. Check your connection and try again.");
assert.equal(renterFacingError(new Error("Unauthorized"), "Try again."), "Please sign in again, then retry.");
for (const privateError of [
  "Uncaught Error: [CONVEX M(private.action)] Internal action failed",
  "StripeError: invalid_request_error request_id=req_private_123",
  "TypeError: cannot read property 'token' at /home/ubuntu/app/file.ts:42:8",
  "Provider details\n    at handler (/root/private/action.ts:5:9)",
  `Bearer ${"sensitive-value"}`,
]) {
  assert.equal(renterFacingError(new Error(privateError), "We couldn’t complete that. Please try again."), "We couldn’t complete that. Please try again.", privateError);
}
assert.equal(renterFacingError(null, "Safe fallback."), "Safe fallback.");
console.log("PASS renter-facing error copy: actionable public messages remain, transport/auth errors are summarized, and internal/provider traces stay private.");
