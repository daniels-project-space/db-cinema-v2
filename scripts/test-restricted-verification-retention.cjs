const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "retention-admin";
delete process.env.ADMIN_SESSION_CUSTOMER_WRITE_V2;
delete process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2;

const accountAdmin = load("convex/accountAdmin.ts");
const { archiveRetention, purgeExpired } = load("convex/verificationArchive.ts");
const { CURRENT_PRIVACY_NOTICE } = load("shared/currentPrivacyNotice.ts");
const { CURRENT_PRIVACY_NOTICE_VERSION } = load("shared/privacyNoticeVersion.ts");
const schema = fs.readFileSync("convex/schema.ts", "utf8");
const accountDocumentsSource = fs.readFileSync("src/components/admin/AccountDocuments.tsx", "utf8");
assert.match(schema, /identitySafetyRetentionAt:\s*v\.optional\(v\.number\(\)\)/, "Blacklist retention is represented separately from legacy retention fields");
const retentionText = CURRENT_PRIVACY_NOTICE.sections.find(section => section.h === "5. Retention")?.p ?? "";
assert.match(retentionText, /retain its existing verification archive indefinitely/);
assert.match(retentionText, /restricted to administrators/);
assert.match(retentionText, /never blocks a new renter automatically/);
assert.match(accountDocumentsSource, /Permanent admin archive/);
assert.equal(CURRENT_PRIVACY_NOTICE_VERSION, "2026-11-12-v5", "Changed retention copy requires a fresh notice acknowledgement version");

const now = Date.now();
const account = put("accounts", { email: "restricted-retention@example.invalid", renterPersonKey: "a".repeat(64) });
const booking = put("bookings", { accountId: account._id, guestEmail: account.email, status: "returned", returnedAt: now - 100 * 86400000 });
const archive = put("verification_archives", { bookingId: booking._id, accountId: account._id, sessionId: "fixture", status: "complete", createdAt: now - 100 * 86400000, attempts: 0, dueAt: 0, retentionHoldReason: "Legacy manual override", retentionHoldRevision: 1 });
put("verification_documents", { archiveId: archive._id, bookingId: booking._id, accountId: account._id, sessionId: archive.sessionId, kind: "identity-front", storageId: "restricted-id-copy", sha256: "a".repeat(64), size: 5, contentType: "image/jpeg", savedAt: now - 100 * 86400000 });
const normalAccount = put("accounts", { email: "normal-retention@example.invalid" });
const normalBooking = put("bookings", { accountId: normalAccount._id, guestEmail: normalAccount.email, status: "returned", returnedAt: now - 100 * 86400000 });
const normalArchive = put("verification_archives", { bookingId: normalBooking._id, accountId: normalAccount._id, sessionId: "normal-fixture", status: "complete", createdAt: now - 100 * 86400000, attempts: 0, dueAt: 0 });
put("verification_documents", { archiveId: normalArchive._id, bookingId: normalBooking._id, accountId: normalAccount._id, sessionId: normalArchive.sessionId, kind: "identity-front", storageId: "normal-id-copy", sha256: "b".repeat(64), size: 5, contentType: "image/jpeg", savedAt: now - 100 * 86400000 });
const deletedStorage = [];
const ctx = { db, storage: { delete: async id => deletedStorage.push(id) }, scheduler: { runAfter: async () => {} } };
const expected = value => ({ blockedAt: value.blockedAt ?? null, restrictionClass: value.restrictionClass ?? null, noticeId: value.restrictionNoticeId ?? null, reason: value.blockedReason ?? "", revision: value.restrictionRevision ?? 0 });

(async () => {
  await accountAdmin.setBlocked.handler(ctx, { token: "retention-admin", accountId: account._id, blocked: true, restrictionClass: "identity_safety_blacklist", reason: "Synthetic restriction for retention test", expected: expected(account) });
  assert.equal(account.restrictionClass, "identity_safety_blacklist", "The manual identity alert remains available");
  assert.equal(account.identitySafetyRetentionAt, account.blockedAt, "A manual identity-safety blacklist creates a permanent retention record");
  let retention = await archiveRetention(ctx, archive);
  assert.equal(retention.status, "identity-safety");
  assert.equal(retention.permanent, true);
  assert.equal(retention.expiresAt, null, "Blacklisted verification archives do not expire on the normal 90-day schedule");

  // The old ambiguous marker stays ignored; only the explicit identity-safety marker changes retention.
  await db.patch(account._id, { verificationRetentionPermanentAt: now - 86400000 });
  retention = await archiveRetention(ctx, archive);
  assert.equal(retention.status, "identity-safety", "The current blacklist marker, not the legacy field, controls retention");
  assert.equal(retention.permanent, true);

  const caseId = await db.insert("rental_damage_cases", { bookingId: booking._id, status: "open", openedAt: now - 120 * 86400000 });
  retention = await archiveRetention(ctx, archive);
  assert.equal(retention.status, "identity-safety", "An identity-safety archive remains permanent while a case is open");
  await db.patch(caseId, { status: "closed", closedAt: now - 100 * 86400000 });
  retention = await archiveRetention(ctx, archive);
  assert.equal(retention.status, "identity-safety", "Closing a case does not remove the blacklist archive marker");
  assert.equal(retention.expiresAt, null);

  await accountAdmin.setBlocked.handler(ctx, { token: "retention-admin", accountId: account._id, blocked: false, restrictionClass: "identity_safety_blacklist", reason: "Access restored after manual review", expected: expected(account) });
  assert.equal(account.blockedAt, undefined);
  assert.equal((await archiveRetention(ctx, archive)).permanent, true, "Restoring account access does not remove the permanent archive marker");
  const normalRetention = await archiveRetention(ctx, normalArchive);
  assert.equal(normalRetention.status, "expires", "Ordinary accounts keep the normal 90-day closure window");
  assert.equal(normalRetention.expiresAt, now - 10 * 86400000);
  assert.equal(await purgeExpired.handler(ctx, {}), 1, "The sweep deletes only expired ordinary documents");
  assert.deepEqual(deletedStorage, ["normal-id-copy"]);
  assert.equal((await db.get(archive._id)).status, "complete", "Blacklisted archive bytes remain in storage");
  assert.equal((await db.get(normalArchive._id)).status, "deleted");
  console.log("PASS restricted verification retention: identity-safety archives persist for manual repeat-match review; ordinary archives expire after 90 days/case closure.");
})().catch(error => { console.error(error); process.exitCode = 1; });
