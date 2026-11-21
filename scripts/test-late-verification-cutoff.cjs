const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const helperSource = fs.readFileSync(path.join(root, "shared/verificationProgress.ts"), "utf8");
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helperModule = { exports: {} };
const mockedRequire = name => {
  if (name === "./pickupSecurity") return { isPickupHoldPolicyVersion: () => false };
  if (name === "./savedCardSecurity") return { isSavedCardRental: () => false };
  return require(name);
};
new Function("require", "module", "exports", compiled)(mockedRequire, helperModule, helperModule.exports);
const {
  verificationDeadlineAt,
  verificationLateWindowClosed,
  verificationCanStart,
  verificationSessionCanOpen,
  paidRentalUnverifiedAfterWindow,
} = helperModule.exports;

const start = Date.UTC(2026, 10, 19, 16);
const deadline = start + 2 * 60 * 60 * 1000;
const booking = {
  status: "pending_verification",
  checkoutPaidAt: start - 1,
  start,
  lineItems: [{ start }],
  idVerifyStatus: "processing",
};
assert.equal(verificationDeadlineAt(booking), deadline);
assert.equal(verificationLateWindowClosed(booking, deadline - 1), false);
assert.equal(verificationLateWindowClosed(booking, deadline), true);
assert.equal(verificationCanStart(booking, deadline - 1), true);
assert.equal(verificationCanStart(booking, deadline), false);
assert.equal(verificationSessionCanOpen(booking, deadline), false);
const reopened = { ...booking, lateVerificationAllowedAt: deadline + 1 };
assert.equal(verificationLateWindowClosed(reopened, deadline + 2), false);
assert.equal(verificationCanStart(reopened, deadline + 2), true);
assert.equal(verificationSessionCanOpen(reopened, deadline + 2), true);
assert.equal(paidRentalUnverifiedAfterWindow(reopened, deadline + 2), true);
assert.equal(paidRentalUnverifiedAfterWindow({ ...reopened, idVerifyStatus: "verified", idVerifiedAt: deadline }, deadline + 2), false);

const source = file => fs.readFileSync(path.join(root, file), "utf8");
const didit = source("convex/didit.ts");
const bookings = source("convex/bookings.ts");
const email = source("convex/rentalEmailDelivery.ts");
const reviews = source("convex/lib/reviewEligibility.ts");
const adminUi = source("src/components/rentals/RentalVerificationSummary.tsx");
const renterUi = source("src/components/rentals/VerificationProgress.tsx");
const terms = source("shared/legal-history/2026-11-v22.ts");

assert.match(didit, /verificationLateWindowClosed\(booking\)/);
assert.match(didit, /if \(verificationLateWindowClosed\(booking\)\) return \{status: "late_window_closed"\}/);
assert.match(didit, /Reopen late verification in the admin panel before making a Didit decision/);
assert.match(bookings, /verificationLateWindowClosed\(b, eventAt\)/);
assert.match(bookings, /export const adminAllowLateVerification = mutation/);
assert.match(bookings, /assertAdmin\(ctx, token, "bookings\.adminAllowLateVerification"\)/);
assert.match(adminUi, /Allow late verification/);
assert.match(renterUi, /Online verification has closed/);
assert.match(email, /paidRentalUnverifiedAfterWindow\(b\)/);
assert.match(reviews, /verification_window_passed/);
assert.match(terms, /two hours after the scheduled rental start/);
assert.match(terms, /rental payment is not refunded/);
console.log("PASS late verification cutoff, admin override, and suppressions");
