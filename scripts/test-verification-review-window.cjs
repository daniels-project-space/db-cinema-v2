const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const { archiveRetention, purgeExpired } = load("convex/verificationArchive.ts");

let now = Date.now();
const actualNow = Date.now;
Date.now = () => now;
const deleted = [];
const ctx = { db, storage: { delete: async id => deleted.push(id) }, scheduler: { runAfter: async () => {} } };
const days = value => value * 86400000;
const closedWithMissingDate = (email = "review@example.invalid") => {
  const booking = put("bookings", { status: "returned", guestEmail: email, returnedAt: undefined });
  const archive = put("verification_archives", { bookingId: booking._id, email, sessionId: `session-${email}`, source: "didit", status: "complete", createdAt: now, attempts: 0, dueAt: 0 });
  put("verification_documents", { archiveId: archive._id, bookingId: booking._id, sessionId: archive.sessionId, kind: "identity-front", storageId: `file-${email}`, sha256: "a".repeat(64), size: 5, contentType: "image/jpeg", savedAt: now });
  return { booking, archive };
};

(async () => {
  const uncertain = closedWithMissingDate();
  let retention = await archiveRetention(ctx, uncertain.archive);
  assert.equal(retention.reviewWindowEligible, true);
  assert.equal(retention.reviewStartedAt, null);
  assert.equal(retention.expiresAt, null, "The clock begins on the first purge sweep, not on each read");
  assert.equal(retention.viewable, true, "Documents remain available before and during the fixed review window");

  assert.equal(await purgeExpired.handler(ctx, {}), 0);
  const fixedStart = uncertain.archive.retentionReviewStartedAt;
  assert.equal(fixedStart, now, "First purge sweep persists a stable review start");
  retention = await archiveRetention(ctx, uncertain.archive);
  assert.equal(retention.expiresAt, fixedStart + days(90));
  assert.equal(retention.viewable, true);

  now += days(30);
  assert.equal(await purgeExpired.handler(ctx, {}), 0);
  assert.equal(uncertain.archive.retentionReviewStartedAt, fixedStart, "Later sweeps do not slide the deadline");
  now = fixedStart + days(90) - 1;
  assert.equal((await archiveRetention(ctx, uncertain.archive)).viewable, true, "Copies remain viewable through the full review window");
  assert.equal(await purgeExpired.handler(ctx, {}), 0);
  now += 1;
  assert.equal((await archiveRetention(ctx, uncertain.archive)).viewable, false, "Copies stop being viewable after the review window");
  assert.equal(await purgeExpired.handler(ctx, {}), 1, "The next sweep deletes bytes after the fixed deadline");
  assert.equal(uncertain.archive.status, "deleted");
  assert.deepEqual(deleted, [`file-${"review@example.invalid"}`]);

  const active = closedWithMissingDate("active@example.invalid");
  active.booking.status = "active";
  assert.equal((await archiveRetention(ctx, active.archive)).status, "active-rental");
  assert.equal(await purgeExpired.handler(ctx, {}), 0);
  assert.equal(active.archive.retentionReviewStartedAt, undefined, "An active rental never starts a review timer");

  const openCase = closedWithMissingDate("case@example.invalid");
  put("rental_damage_cases", { bookingId: openCase.booking._id, status: "open", openedAt: now - days(1) });
  assert.equal((await archiveRetention(ctx, openCase.archive)).status, "insurance-case");
  assert.equal(await purgeExpired.handler(ctx, {}), 0);
  assert.equal(openCase.archive.retentionReviewStartedAt, undefined, "An open case never starts a review timer");

  const missingLinkSource = closedWithMissingDate("missing-link@example.invalid");
  put("verification_archive_links", { sourceBookingId: missingLinkSource.booking._id, bookingId: "bookings:missing" });
  retention = await archiveRetention(ctx, missingLinkSource.archive);
  assert.equal(retention.reviewWindowEligible, false, "A missing linked rental is not treated as fully accounted closure history");
  assert.equal(retention.viewable, false);
  assert.equal(await purgeExpired.handler(ctx, {}), 0);
  assert.equal(missingLinkSource.archive.retentionReviewStartedAt, undefined);

  const overLimit = closedWithMissingDate("over-limit@example.invalid");
  for (let i = 0; i < 31; i++) put("bookings", { status: "returned", verificationReusedFrom: overLimit.booking._id, returnedAt: undefined });
  retention = await archiveRetention(ctx, overLimit.archive);
  assert.equal(retention.reviewWindowEligible, false, "Over-limit reused history is not treated as fully accounted");
  assert.equal(await purgeExpired.handler(ctx, {}), 0);
  assert.equal(overLimit.archive.retentionReviewStartedAt, undefined);

  Date.now = actualNow;
  console.log("PASS bounded verification review retention: fixed first-sweep deadline, 90-day visibility and deletion, active/open-case pause, and no fallback for missing or over-limit links.");
})().catch(error => { Date.now = actualNow; console.error(error); process.exitCode = 1; });
