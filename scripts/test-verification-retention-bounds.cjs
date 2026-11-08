const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const { archiveRetention, purgeExpired } = load("convex/verificationArchive.ts");
const ctx = { db, storage: { delete: async () => { throw Error("must not delete"); } }, scheduler: { runAfter: async () => {} } };
const old = Date.now() - 100 * 86400000;
function source() {
  const booking = put("bookings", { status: "returned", returnedAt: old });
  return { booking, archive: put("verification_archives", { bookingId: booking._id, status: "complete", sessionId: "fixture", createdAt: old }) };
}
(async () => {
  const reused = source();
  for (let index = 0; index < 31; index++) put("bookings", { status: "returned", returnedAt: old, verificationReusedFrom: reused.booking._id });
  const linked = source();
  for (let index = 0; index < 31; index++) {
    const rental = put("bookings", { status: "returned", returnedAt: old });
    put("verification_archive_links", { sourceBookingId: linked.booking._id, bookingId: rental._id, createdAt: old });
  }
  const cases = source();
  for (let index = 0; index < 101; index++) put("rental_damage_cases", { bookingId: cases.booking._id, status: "closed", closedAt: old });
  for (const item of [reused, linked, cases]) {
    const result = await archiveRetention(ctx, item.archive);
    assert.equal(result.status, "unknown-closure");
    assert.equal(result.needsReview, true);
    assert.equal(result.viewable, false);
    assert.equal(result.expiresAt, null);
  }
  assert.equal(await purgeExpired.handler(ctx, {}), 0);
  for (const item of [reused, linked, cases]) assert.equal(item.archive.status, "complete");
  console.log("PASS bounded archive retention fails closed for excess rentals, links and cases without deleting evidence.");
})().catch(error => { console.error(error); process.exitCode = 1; });
