const assert = require("node:assert/strict");
const h = require("./lib/rentalTestHarness.cjs");
const reviewApi = h.load("convex/verificationRetentionReview.ts");
const archiveApi = h.load("convex/verificationArchive.ts");
const revisionApi = h.load("convex/lib/verificationRetentionRevision.ts");
process.env.ADMIN_TOKEN = "retention-reconciliation-fixture";
const now = Date.now();
const queued = [];
const ctx = {
  db: h.db,
  scheduler: { runAfter: async (_delay, reference, args) => queued.push({ reference: String(reference), args }) },
  storage: { delete: async () => { throw Error("retention review must not delete bytes"); } },
};

async function runNext() {
  const task = queued.shift();
  assert(task, "a paginated continuation is queued");
  assert.equal(task.reference, "verificationRetentionReview.run");
  await reviewApi.run.handler(ctx, task.args);
}

async function drain(limit = 1000) {
  let steps = 0;
  while (queued.length) {
    assert(++steps < limit, "retention scan terminates");
    await runNext();
  }
}

async function paginatedHistoryAndInvalidation() {
  const account = h.put("accounts", { email: "history@example.invalid" });
  const source = h.put("bookings", { accountId: account._id, status: "returned", returnedAt: now - 10 * 86400000, diditSessionId: "history-session" });
  const archive = h.put("verification_archives", { accountId: account._id, bookingId: source._id, sessionId: source.diditSessionId, status: "complete", createdAt: now - 100 * 86400000 });
  for (let index = 0; index < 33; index++) {
    const booking = h.put("bookings", { accountId: account._id, status: "returned", returnedAt: now - (20 + index) * 86400000, verificationReusedFrom: source._id });
    if (index === 0) {
      for (let caseIndex = 0; caseIndex < 101; caseIndex++) h.put("rental_damage_cases", { bookingId: booking._id, accountId: account._id, status: "closed", openedAt: now - 300000, closedAt: now - 200000 });
    }
  }
  const started = await reviewApi.start.handler(ctx, { token: process.env.ADMIN_TOKEN, archiveId: archive._id, accountId: account._id, reason: "Reconcile complete rental history" });
  assert.equal(started.state, "running");
  await runNext(); // source
  await runNext(); // first 25 reused rentals
  const firstGeneration = h.tables.get("verification_archive_retention_reviews")[0].generation;
  const activeBooking = h.put("bookings", { accountId: account._id, status: "active", verificationReusedFrom: source._id });
  await revisionApi.bumpVerificationRetentionRevision(ctx, activeBooking);
  await runNext(); // detects revision change and restarts from the first page
  const reviewRow = h.tables.get("verification_archive_retention_reviews")[0];
  assert.equal(reviewRow.generation, firstGeneration + 1, "new linked rental invalidates and restarts the paginated scan");
  assert.equal((await archiveApi.archiveRetention(ctx, archive)).viewable, false, "incomplete history remains fail-closed");

  while (!(reviewRow.stage === "cases" && reviewRow.casesScanned >= 25)) await runNext();
  h.put("rental_damage_cases", { bookingId: source._id, accountId: account._id, status: "open", openedAt: now - 1000 });
  await revisionApi.bumpVerificationRetentionRevision(ctx, source);
  await runNext(); // detects the open case and restarts
  assert(reviewRow.generation >= firstGeneration + 2, "new linked case invalidates and restarts the scan");
  await drain();
  assert.equal(reviewRow.state, "complete");
  assert.equal(reviewRow.linkedRentals, 35, "the scan includes the source, more than 30 reused rentals, and the active rental");
  assert.equal(reviewRow.casesScanned, 102, "the scan paginates all 101 closed cases and the newly opened case");
  assert.equal(reviewRow.activeRentals, 1);
  assert.equal(reviewRow.openCases, 1);
  const retention = await archiveApi.archiveRetention(ctx, archive);
  assert.equal(retention.status, "active-rental", "active linked rentals continue to hold copies");
  assert.equal(retention.viewable, true);
}

async function exactAccountLinkAndAudit() {
  const owner = h.put("accounts", { email: "owner@example.invalid" });
  const stranger = h.put("accounts", { email: "stranger@example.invalid" });
  const missingBookingId = "bookings-deleted-source";
  const archive = h.put("verification_archives", { accountId: owner._id, bookingId: missingBookingId, sessionId: "source-session", status: "complete", createdAt: now });
  const sameAccount = h.put("bookings", { accountId: owner._id, status: "returned", returnedAt: now - 10 * 86400000, diditSessionId: "source-session" });
  const otherAccount = h.put("bookings", { accountId: stranger._id, status: "returned", returnedAt: now - 10 * 86400000, diditSessionId: "source-session" });
  await reviewApi.start.handler(ctx, { token: process.env.ADMIN_TOKEN, archiveId: archive._id, accountId: owner._id, reason: "Resolve missing source rental" });
  await runNext();
  const job = h.tables.get("verification_archive_retention_reviews").find(row => row.archiveId === archive._id);
  assert.equal(job.state, "needs_link");
  const candidatePage = await reviewApi.candidates.handler(ctx, { token: process.env.ADMIN_TOKEN, archiveId: archive._id, cursor: null });
  assert.deepEqual(candidatePage.candidates.map(row => row.bookingId), [sameAccount._id], "candidate search never crosses account ownership");
  const args = { token: process.env.ADMIN_TOKEN, archiveId: archive._id, generation: job.generation, missingBookingId, replacementBookingId: otherAccount._id, reason: "This other account owns the record" };
  await assert.rejects(() => reviewApi.repairLink.handler(ctx, args), /exact existing rental from this account/);
  await reviewApi.repairLink.handler(ctx, { ...args, replacementBookingId: sameAccount._id, reason: "The original Didit session matches exactly" });
  await drain();
  assert.equal(job.state, "complete");
  assert.equal(job.linkedRentals, 1);
  assert(h.tables.get("verification_retention_audits").some(row => row.event === "history_linked" && row.archiveId === archive._id && row.actorHash === "legacy-admin"), "the successful repair has a stable admin audit row");
  const retention = await archiveApi.archiveRetention(ctx, archive);
  assert.equal(retention.status, "expires");
  assert.equal(retention.expiresAt, sameAccount.returnedAt + 90 * 86400000, "the reconciled real closure timestamp controls retention");
}

(async () => {
  await paginatedHistoryAndInvalidation();
  await exactAccountLinkAndAudit();
  console.log("PASS admin-only full-history retention reconciliation: >30 rentals, >100 cases, mid-scan invalidation for new active rental/open case, fail-closed progress, exact same-account repair, audit, and real closure date.");
})().catch(error => { console.error(error); process.exitCode = 1; });
