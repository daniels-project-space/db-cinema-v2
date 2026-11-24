const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { inventory } = require("./admin-auth-inventory.cjs");

const root = path.resolve(__dirname, "..");
const expected = fs.readFileSync(path.join(__dirname, "admin-auth-inventory.txt"), "utf8").trimEnd().split("\n");
const actual = inventory();
const expectedSet = new Set(expected);
const actualSet = new Set(actual);
const added = actual.filter(entry => !expectedSet.has(entry));
const removed = expected.filter(entry => !actualSet.has(entry));
assert.deepEqual({ added, removed }, { added: [], removed: [] }, "Admin migration inventory changed; review and update its baseline before any cutover.");
for (const required of [
  "export convex/adminAuth.ts:verify",
  "export convex/adminAuth.ts:assertAdmin",
  "export convex/accountAdmin.ts:directory",
  "call src/app/api/admin/gaffer-calls/route.ts:adminAuth.verify",
  "route src/app/api/admin/gaffer-calls/route.ts",
]) assert(actualSet.has(required), `Inventory missed ${required}`);
assert(actualSet.has("call src/components/BotBubble.tsx:chat.recordGafferUserMessage"),
  "The signed-in support widget must persist renter questions through the account-authenticated mutation.");
assert(!actualSet.has("call src/components/BotBubble.tsx:chat.recordGafferReply"),
  "The browser must not submit Gaffer's account-support response; the server-owned action handles it.");
const chatSource = fs.readFileSync(path.join(root, "convex/chat.ts"), "utf8");
assert.match(chatSource, /export const recordGafferUserMessage\s*=\s*mutation\([\s\S]*?acctByToken\(ctx, token\)[\s\S]*?ctx\.scheduler\.runAfter\(0,\s*internal\.gaffer\.gafferReply/,
  "Saving an authenticated account-support question must durably schedule the internal Gaffer action.");
assert.match(chatSource, /const proof=completionProof\?await verifyGafferReplyProof\([\s\S]*?if\(!proof\)throw new Error\("Gaffer's reply could not be verified\./,
  "The legacy public reply mutation must remain proof-gated during migration.");
const gafferSource = fs.readFileSync(path.join(root, "convex/gaffer.ts"), "utf8");
assert.match(gafferSource, /export const gafferReply\s*=\s*internalAction\(/,
  "Public callers must not invoke the server-owned Gaffer reply action directly.");
for (const required of [
  "export convex/reviews.ts:adminPendingNative",
  "export convex/reviews.ts:moderateNative",
  "call src/components/admin/NativeReviewModeration.tsx:bookings.adminAuthorized",
  "call src/components/admin/NativeReviewModeration.tsx:reviews.adminPendingNative",
  "call src/components/admin/NativeReviewModeration.tsx:reviews.moderateNative",
]) assert(actualSet.has(required), `Review moderation inventory missed ${required}`);
const reviewsSource = fs.readFileSync(path.join(root, "convex/reviews.ts"), "utf8");
assert.match(reviewsSource, /export const adminPendingNative\s*=\s*query\([\s\S]*?if\s*\(!checkAdminToken\(token\)\)\s*return\s*\{\s*authorized:\s*false\s+as\s+const,\s*items:\s*\[\]\s*\}/,
  "The public moderation queue must return no review data unless its server-side admin token check succeeds.");
assert.match(reviewsSource, /export const moderateNative\s*=\s*mutation\([\s\S]*?await assertAdmin\(ctx,\s*token,\s*["']reviews\.moderateNative["']\)/,
  "Review approval/rejection must remain server-authorized rather than relying on hiding the admin UI.");
const returnSource = fs.readFileSync(path.join(root, "convex/bookings.ts"), "utf8");
for (const [name, kind] of [
  ["returnStatementEvidenceContext", "internalQuery"],
  ["returnEvidenceLinkFiles", "internalQuery"],
  ["returnEvidenceAccessAttempt", "internalMutation"],
]) assert.match(returnSource, new RegExp(`export const ${name}\\s*=\\s*${kind}\\(`),
  `${name} must not become a renter-callable Convex endpoint; signed return-evidence delivery owns its access check.`);
const emailInboxSource = fs.readFileSync(path.join(root, "convex/emailInbox.ts"), "utf8");
for (const name of ["prepareRentalEmailThread", "finishRentalEmailThread", "prepareRentalContextEmail", "finishRentalContextEmail"])
  assert.match(emailInboxSource, new RegExp(`export const ${name}\\s*=\\s*internalMutation\\(`),
    `${name} must remain an internal transactional email outbox operation.`);
assert.match(emailInboxSource, /export const prepareRentalContextEmail\s*=\s*internalMutation\([\s\S]*?canonicalRecipient[\s\S]*?belongsToRentalAccount\(booking, rentalAccount\)/,
  "Booking-context email must bind the recipient to the current renter before creating a reply thread.");
assert.match(emailInboxSource, /export const finishRentalContextEmail\s*=\s*internalMutation\([\s\S]*?outbound\.bookingId !== args\.bookingId[\s\S]*?thread\.bookingId !== args\.bookingId/,
  "Email delivery completion must stay bound to its original booking and outbox row.");
const contextMailerSource = fs.readFileSync(path.join(root, "convex/lib/rentalContextEmail.ts"), "utf8");
assert.match(contextMailerSource, /ctx\.runMutation\(internal\.emailInbox\.prepareRentalContextEmail/);
assert.match(contextMailerSource, /ctx\.runMutation\(internal\.emailInbox\.finishRentalContextEmail/,
  "The exported rental email helper must route durable thread operations through internal-only mutations.");
const securityChargeSource = fs.readFileSync(path.join(root, "convex/securityChargeState.ts"), "utf8");
assert.match(securityChargeSource, /export const evidenceOptions\s*=\s*query\([\s\S]*?await authorizePaymentRead\(ctx,\s*token\)/,
  "Return-claim evidence enumeration requires payment-read authorization at the Convex boundary.");
const archiveSource = fs.readFileSync(path.join(root, "convex/verificationArchive.ts"), "utf8");
assert.match(archiveSource, /export async function verificationArchiveHasIntegrity\(/,
  "Verification archive integrity must remain a non-callable internal helper, not a public Convex endpoint.");
assert.match(archiveSource, /export async function verificationArchiveHasIntegrity\([\s\S]*?archiveRetention\(ctx,archive\)[\s\S]*?archiveCopies\(ctx,archive\)/,
  "The internal badge helper checks retention and stored-file integrity before reporting a valid archive.");
const helperChecks = [
  ["convex/lib/accountVerificationReady.ts", "accountVerificationBadge", "async function"],
  ["convex/lib/cleanCompletedRental.ts", "checkoutCreditFullyCoversDue", "function"],
  ["convex/lib/cleanCompletedRental.ts", "hasCheckoutPaymentProof", "function"],
  ["convex/lib/cleanCompletedRental.ts", "cleanCompletedRental", "async function"],
  ["convex/lib/rentalContextEmail.ts", "sendRentalContextEmail", "async function"],
  ["convex/lib/rentalSwapAuthority.ts", "rentalItemSwapFeatureReady", "function"],
  ["convex/lib/shared_stock_sync.ts", "hasFreshSharedStock", "async function"],
];
for (const [filename, name, kind] of helperChecks) {
  const helperSource = fs.readFileSync(path.join(root, filename), "utf8");
  assert.match(helperSource, new RegExp(`export ${kind} ${name}\\(`),
    `${filename}:${name} is a server-side helper, not an exposed Convex endpoint.`);
}
const waiverSource = fs.readFileSync(path.join(root, "convex/lib/strictDepositWaiver.ts"), "utf8");
assert.match(waiverSource, /export \{ checkoutCreditFullyCoversDue \}/,
  "The clean-rental predicate remains available to waiver code through its reviewed helper re-export.");
const mailerSource = fs.readFileSync(path.join(root, "convex/lib/mailer.ts"), "utf8");
assert.doesNotMatch(mailerSource, /export (?:async )?function deliveryMessageId\(/,
  "The removed deliveryMessageId helper is not an unreviewed public authorization path.");
for (const required of [
  "call convex/checkout.ts:securityChargeState.evidenceOptions",
  "export convex/bookings.ts:returnEvidenceAccessAttempt",
  "export convex/bookings.ts:returnEvidenceLinkFiles",
  "export convex/bookings.ts:returnStatementEvidenceContext",
  "export convex/emailInbox.ts:prepareRentalEmailThread",
  "export convex/emailInbox.ts:finishRentalEmailThread",
  "export convex/emailInbox.ts:prepareRentalContextEmail",
  "export convex/emailInbox.ts:finishRentalContextEmail",
]) assert(actualSet.has(required), `Return/email access inventory missed ${required}`);
const creditSource = fs.readFileSync(path.join(root, "convex/lib/checkoutCredit.ts"), "utf8");
for (const helper of ["checkoutCreditSpentPence", "checkoutMembershipCreditSpentPence"]) {
  assert.match(creditSource, new RegExp(`export function ${helper}\\(`),
    `${helper} remains a pure internal helper rather than a callable Convex endpoint.`);
}
const extensionsSource = fs.readFileSync(path.join(root, "convex/rentalExtensions.ts"), "utf8");
assert.match(extensionsSource, /export const expirePendingCreditRequests\s*=\s*internalMutation\(/,
  "Expired extension-credit reservations can only be released through an internal mutation.");
const extensionPaymentsSource = fs.readFileSync(path.join(root, "convex/rentalExtensionPayments.ts"), "utf8");
assert.match(extensionPaymentsSource, /export const reconcile\s*=\s*internalAction\([\s\S]*?internal\.rentalExtensions\.expirePendingCreditRequests/,
  "The expiration mutation is invoked by the server-owned reconciliation action.");
assert(!actual.some(entry => entry.includes("api.rentalExtensions.expirePendingCreditRequests")),
  "No public API path invokes the pending-credit expiration mutation.");
const file = "convex/adminAccountSessionV2.ts";
const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
const gate = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "adminSessionMigrationReady");
assert.ok(gate?.body?.statements.length === 1 && ts.isReturnStatement(gate.body.statements[0]) &&
  gate.body.statements[0].expression?.kind === ts.SyntaxKind.FalseKeyword,
  "Do not enable the admin session cutover until every legacy path, identity boundary and external action is migrated and independently verified.");
console.log(`PASS admin migration inventory (${actual.length} entries); the incomplete session cutover remains disabled.`);
