const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { needsDiditReviewTab, rentalWorkspaceTabs } = load("shared/diditReviewTab.ts");

const base = {
  status: "pending_verification",
  verificationProvider: "didit",
  idVerifyStatus: "manual_review",
};

assert.equal(needsDiditReviewTab(base), true, "An open Didit manual review exposes the review tab");
assert.deepEqual(rentalWorkspaceTabs(base), [["order", "Order & payments"], ["verification", "Verification review"]]);
assert.equal(needsDiditReviewTab({ ...base, status: "confirmed" }), true, "A confirmed open rental can retain a Didit review");
assert.equal(needsDiditReviewTab({ ...base, status: "returned" }), false, "Closed rentals do not show an actionable review tab");
assert.equal(needsDiditReviewTab({ ...base, idVerifyStatus: "requires_input" }), false, "A renter resubmission request is not a manual review");
assert.equal(needsDiditReviewTab({ ...base, verificationProvider: "manual" }), false, "Non-Didit verification does not show the Didit review tab");
assert.equal(needsDiditReviewTab({ ...base, verificationLateBlockedAt: 10, verificationLateBlockedProviderStatus: "Approved" }), false, "A late provider approval is not presented as a review decision");
assert.equal(needsDiditReviewTab(null), false, "Missing rental data fails closed");
assert.deepEqual(rentalWorkspaceTabs({ ...base, idVerifyStatus: "verified" }), [["order", "Order & payments"]], "The ordinary workspace has no verification tab");

console.log("PASS Didit review tab visibility only follows an actionable open manual review.");
