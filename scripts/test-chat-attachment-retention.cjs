const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");

const now = Date.now();
const day = 24 * 60 * 60_000;
const originalNow = Date.now;
const bytes = Buffer.from("89504e470d0a1a0a", "hex");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const blobs = new Map();
const scheduled = [];
process.env.ADMIN_TOKEN = "fixture-admin";
const ctx = {
  db,
  scheduler: { runAfter: async (delay, reference, args) => scheduled.push({ delay, reference, args }) },
  storage: {
    delete: async id => { blobs.delete(id); await db.delete(id); },
  },
};

setMock("./renterPush", { queueRenterNotification: async () => {} });
setMock("./adminPush", { queueOwnerNotification: async () => {} });
setMock("./rentalAccount", { belongsToRentalAccount: () => true });
const attachments = load("convex/chatAttachments.ts");
const caseArchive = load("convex/lib/chatCaseArchive.ts");
const cronJobs = load("convex/crons.ts").default.crons;
const { postRentalMessage } = load("convex/lib/rentalChat.ts");

assert.deepEqual(cronJobs["auto-close-inactive-support-chats"], {
  name: "chatAttachments.closeInactiveSupportThreads",
  args: [{}],
  schedule: { hourUTC: 3, minuteUTC: 20, type: "daily" },
}, "general chats have a daily 90-day close schedule");
assert.equal(cronJobs["purge-expired-chat-attachments"].name, "chatAttachments.purgeExpired");
assert.deepEqual(cronJobs["purge-expired-chat-attachments"].schedule, { hours: 1, type: "interval" });
assert.equal(cronJobs["purge-chat-attachment-audit-history"].name, "chatAttachments.purgeExpiredActionAudits");
assert.deepEqual(cronJobs["purge-chat-attachment-audit-history"].schedule, { hours: 24, type: "interval" });
assert.equal(cronJobs["backfill-legacy-case-chat-archives"].name, "lib.chatCaseArchive.backfillLegacyCaseArchives");

function addAttachment({ account, booking, thread, closedAt, createdAt = now, hold, brokenBinding = false }) {
  const idSuffix = String(Math.random()).slice(2).padEnd(32, "0").slice(0, 32);
  const marker = `application/vnd.dbcinema.chat-${idSuffix}`;
  const storageId = put("_storage", {
    size: bytes.length,
    contentType: marker,
    sha256: Buffer.from(sha256, "hex").toString("base64"),
  })._id;
  blobs.set(storageId, new Blob([bytes], { type: marker }));
  const message = put("messages", {
    accountId: account._id,
    bookingId: booking?._id,
    sender: "renter",
    text: "Attachment: evidence.png",
    at: createdAt,
    meta: { kind: "attachment", attachmentId: brokenBinding ? "wrong-attachment" : undefined, name: "evidence.png" },
  });
  const messageId = message._id;
  const attempt = put("chat_attachment_attempts", {
    accountId: account._id,
    bookingId: booking?._id,
    admin: false,
    requestKey: idSuffix,
    marker,
    createdAt,
    status: "published",
    sha256,
    size: bytes.length,
    contentType: "image/png",
    engine: "fixture",
    signatureVersion: "fixture",
    signatureUpdatedAt: createdAt,
    storageId,
    messageId,
    name: "evidence.png",
    retentionHoldReason: hold,
  });
  message.meta.attachmentId = brokenBinding ? "wrong-attachment" : attempt._id;
  if (thread) thread.closedAt = closedAt;
  return { attempt, messageId, storageId };
}

(async () => {
  Date.now = () => now;
  const old = now - 91 * day;

  const retryAccount = put("accounts", { email: "retry-expired@example.invalid" });
  const retryBooking = put("bookings", { accountId: retryAccount._id, status: "returned", returnedAt: old });
  const retryFile = addAttachment({ account: retryAccount, booking: retryBooking });
  const deleteStorage = ctx.storage.delete;
  let failDeleteOnce = true;
  ctx.storage.delete = async id => {
    if (id === retryFile.storageId && failDeleteOnce) {
      failDeleteOnce = false;
      throw Error("temporary storage deletion failure");
    }
    return deleteStorage(id);
  };
  await assert.rejects(attachments.purgeExpired.handler(ctx, {}), /temporary storage deletion failure/, "a storage outage fails the sweep without marking the file removed");
  assert.equal(retryFile.attempt.status, "published");
  assert.equal(blobs.has(retryFile.storageId), true, "failed storage cleanup leaves the original bytes intact");
  assert.equal((await db.query("chat_attachment_actions").withIndex("by_attachment", q => q.eq("attachmentId", retryFile.attempt._id)).collect()).length, 0, "failed cleanup does not write a false deletion audit");
  await attachments.purgeExpired.handler(ctx, {});
  assert.equal(retryFile.attempt.status, "removed", "the next scheduled sweep retries the still-published expired file");
  assert.equal(blobs.has(retryFile.storageId), false);
  assert.equal((await db.query("chat_attachment_actions").withIndex("by_attachment", q => q.eq("attachmentId", retryFile.attempt._id)).collect()).filter(row => row.action === "retention_removed").length, 1, "a successful retry writes exactly one deletion audit");
  ctx.storage.delete = deleteStorage;

  const expiredAccount = put("accounts", { email: "expired@example.invalid" });
  const expiredBooking = put("bookings", { accountId: expiredAccount._id, status: "returned", returnedAt: old });
  const expired = addAttachment({ account: expiredAccount, booking: expiredBooking });

  const caseAccount = put("accounts", { email: "case@example.invalid" });
  const caseBooking = put("bookings", { accountId: caseAccount._id, status: "returned", returnedAt: old });
  const protectedByCase = addAttachment({ account: caseAccount, booking: caseBooking });
  const claim = put("rental_damage_cases", { accountId: caseAccount._id, bookingId: caseBooking._id, status: "open", openedAt: old });
  put("sessions", { token: "case-archive-download-session", accountId: caseAccount._id, expiresAt: now + 60_000 });
  const caseThread = put("chat_threads", { accountId: caseAccount._id, bookingId: caseBooking._id, escalated: false, updatedAt: now });
  const caseSupportThread = put("chat_threads", { accountId: caseAccount._id, escalated: false, updatedAt: now, closedAt: old });
  const caseSupportFile = addAttachment({ account: caseAccount, thread: caseSupportThread, closedAt: old });
  const legacyCases = Array.from({ length: 26 }, (_, index) => put("rental_damage_cases", {
    accountId: caseAccount._id,
    bookingId: caseBooking._id,
    itemKey: `legacy-${index}`,
    title: `Legacy case ${index}`,
    details: "Historical case",
    status: "closed",
    openedAt: old + index,
    closedAt: old + index + 1,
  }));

  const manualCaseAccount = put("accounts", { email: "manual-case@example.invalid" });
  const manualCaseBooking = put("bookings", { accountId: manualCaseAccount._id, status: "returned", returnedAt: now - 10 * day });
  const closedCase = put("rental_damage_cases", { accountId: manualCaseAccount._id, bookingId: manualCaseBooking._id, status: "closed", openedAt: now - 5 * day, closedAt: now - day });
  const manualCaseThread = put("chat_threads", { accountId: manualCaseAccount._id, bookingId: manualCaseBooking._id, escalated: false, updatedAt: now });
  const manualArchiveFile = addAttachment({ account: manualCaseAccount, booking: manualCaseBooking });

  const activeAccount = put("accounts", { email: "active@example.invalid" });
  const activeBooking = put("bookings", { accountId: activeAccount._id, status: "confirmed" });
  const active = addAttachment({ account: activeAccount, booking: activeBooking });

  const supportAccount = put("accounts", { email: "support@example.invalid" });
  const supportThread = put("chat_threads", {
    accountId: supportAccount._id,
    escalated: false,
    updatedAt: old,
    closedAt: old,
  });
  const closedSupport = addAttachment({ account: supportAccount, thread: supportThread, closedAt: old });

  const reopenedAccount = put("accounts", { email: "reopened@example.invalid" });
  const reopenedThread = put("chat_threads", {
    accountId: reopenedAccount._id,
    escalated: false,
    updatedAt: old,
    closedAt: old,
  });
  const reopenedSupport = addAttachment({ account: reopenedAccount, thread: reopenedThread, closedAt: old });
  await postRentalMessage(ctx, { accountId: reopenedAccount._id, sender: "renter", text: "I have another question." });
  assert.equal(reopenedThread.closedAt, undefined, "A new message reopens a closed support conversation");
  assert(reopenedThread.updatedAt > old, "Reopening advances the support inactivity clock");

  const ambiguousSupportAccount = put("accounts", { email: "ambiguous-support@example.invalid" });
  put("chat_threads", { accountId: ambiguousSupportAccount._id, escalated: false, updatedAt: old, closedAt: old });
  const duplicateSupportThread = put("chat_threads", { accountId: ambiguousSupportAccount._id, escalated: false, updatedAt: old, closedAt: old });
  const ambiguousSupport = addAttachment({ account: ambiguousSupportAccount, thread: duplicateSupportThread, closedAt: old });

  const heldAccount = put("accounts", { email: "held@example.invalid" });
  const heldBooking = put("bookings", { accountId: heldAccount._id, status: "returned", returnedAt: old });
  const held = addAttachment({ account: heldAccount, booking: heldBooking, hold: "Open case review" });

  const corruptAccount = put("accounts", { email: "corrupt@example.invalid" });
  const corruptBooking = put("bookings", { accountId: corruptAccount._id, status: "returned", returnedAt: old });
  const corrupt = addAttachment({ account: corruptAccount, booking: corruptBooking, brokenBinding: true });

  const staleAccount = put("accounts", { email: "stale@example.invalid" });
  const staleThread = put("chat_threads", { accountId: staleAccount._id, escalated: false, updatedAt: old });
  const notYetClosed = addAttachment({ account: staleAccount, thread: staleThread });
  const exactIdleAccount = put("accounts", { email: "exact-idle@example.invalid" });
  const exactIdleThread = put("chat_threads", { accountId: exactIdleAccount._id, escalated: false, updatedAt: now - 90 * day });
  const exactExpiryAccount = put("accounts", { email: "exact-expiry@example.invalid" });
  const exactExpiryBooking = put("bookings", { accountId: exactExpiryAccount._id, status: "returned", returnedAt: now - 90 * day });
  const exactExpiry = addAttachment({ account: exactExpiryAccount, booking: exactExpiryBooking });
  const nearExpiryAccount = put("accounts", { email: "near-expiry@example.invalid" });
  const nearExpiryBooking = put("bookings", { accountId: nearExpiryAccount._id, status: "returned", returnedAt: now - 90 * day + 1 });
  const nearExpiry = addAttachment({ account: nearExpiryAccount, booking: nearExpiryBooking });
  const heldExpiryAccount = put("accounts", { email: "held-expiry@example.invalid" });
  const heldExpiryBooking = put("bookings", { accountId: heldExpiryAccount._id, status: "returned", returnedAt: now - 91 * day });
  const heldExpiry = addAttachment({ account: heldExpiryAccount, booking: heldExpiryBooking, hold: "Active support case" });
  put("sessions", { token: "retention-download-session", accountId: nearExpiryAccount._id, expiresAt: now + 60_000 });
  put("sessions", { token: "expired-download-session", accountId: expiredAccount._id, expiresAt: now + 60_000 });
  put("sessions", { token: "held-download-session", accountId: heldExpiryAccount._id, expiresAt: now + 60_000 });
  put("sessions", { token: "archived-download-session", accountId: caseAccount._id, expiresAt: now + 60_000 });
  await attachments.download.handler(ctx, { token: "retention-download-session", admin: false, bookingId: nearExpiryBooking._id, id: nearExpiry.attempt._id });
  await assert.rejects(attachments.download.handler(ctx, { token: "expired-download-session", admin: false, bookingId: expiredBooking._id, id: expired.attempt._id }), /Attachment unavailable/, "private download is refused at the 90-day boundary even before the hourly purge runs");
  await attachments.download.handler(ctx, { token: "held-download-session", admin: false, bookingId: heldExpiryBooking._id, id: heldExpiry.attempt._id });
  await attachments.download.handler(ctx, { token: "archived-download-session", admin: false, bookingId: caseBooking._id, id: protectedByCase.attempt._id });
  const manuallyDeletedAccount = put("accounts", { email: "manually-deleted@example.invalid" });
  const manuallyDeletedBooking = put("bookings", { accountId: manuallyDeletedAccount._id, status: "returned", returnedAt: now - 10 * day });
  const manuallyDeleted = addAttachment({ account: manuallyDeletedAccount, booking: manuallyDeletedBooking });
  await attachments.removePublished.handler(ctx, {
    token: "fixture-admin",
    id: manuallyDeleted.attempt._id,
    reason: "Renter requested file removal",
    confirmed: true,
    expectedRevision: 0,
  });
  assert.equal(manuallyDeleted.attempt.status, "removed", "the interactive admin removal path deletes verified private bytes");
  assert.equal(blobs.has(manuallyDeleted.storageId), false);
  const legacyDeletionAudit = put("chat_attachment_actions", {
    attachmentId: expired.attempt._id,
    accountId: expiredAccount._id,
    bookingId: expiredBooking._id,
    action: "removed",
    reason: "Legacy deletion audit without an expiry field",
    at: now,
  });
  const orphanedAttachmentId = "chat_attachment_attempts-missing-legacy";
  const orphanedHoldAudit = put("chat_attachment_actions", {
    attachmentId: orphanedAttachmentId,
    accountId: expiredAccount._id,
    bookingId: expiredBooking._id,
    action: "hold_added",
    reason: "Legacy retention hold",
    at: now - day,
  });
  const orphanedDeletionAudit = put("chat_attachment_actions", {
    attachmentId: orphanedAttachmentId,
    accountId: expiredAccount._id,
    bookingId: expiredBooking._id,
    action: "retention_removed",
    reason: "Legacy removal event without its attempt row",
    at: now,
  });

  const closedResult = await attachments.closeInactiveSupportThreads.handler(ctx, {});
  assert.equal(closedResult.closed, 2, "Only general chats idle for at least 90 days are closed");
  assert.equal(staleThread.closedAt, now, "The support conversation closes at the idle cutoff job time");
  assert.equal(exactIdleThread.closedAt, now, "The exact 90-day idle boundary is included");
  assert.equal(closedSupport.attempt.status, "published", "An open case is not required for retaining a recently closed thread file");
  const backfill = await caseArchive.backfillLegacyCaseArchives.handler(ctx, {});
  assert.equal(backfill.complete, false, "legacy archive migration processes a bounded page");
  assert(scheduled.some(job => job.reference === "lib.chatCaseArchive.backfillLegacyCaseArchives"), "the legacy archive continuation is scheduled");
  let archiveContinuationCount = 0;
  let archiveMigration = backfill;
  while (!archiveMigration.complete) {
    const index = scheduled.findIndex(job => job.reference === "lib.chatCaseArchive.backfillLegacyCaseArchives");
    assert.notEqual(index, -1, "unfinished case backfill keeps a durable continuation");
    const continuation = scheduled.splice(index, 1)[0];
    archiveMigration = await caseArchive.backfillLegacyCaseArchives.handler(ctx, continuation.args);
    archiveContinuationCount++;
    assert(archiveContinuationCount < 5, "case archive backfill completes in bounded pages");
  }
  assert.equal(archiveContinuationCount, 1, "the scheduled case archive continuation was executed");
  assert.equal((await db.query("chat_case_archives").withIndex("by_case", q => q.eq("caseId", claim._id)).first()).bookingId, caseBooking._id);
  assert.equal(caseThread.caseArchivedAt, old, "The permanent archive is attached to the case's rental conversation");
  const legacyArchiveRows = await db.query("chat_case_archives").withIndex("by_booking", q => q.eq("bookingId", caseBooking._id)).collect();
  assert(legacyCases.every(caseRecord => legacyArchiveRows.some(archive => archive.caseId === caseRecord._id)), "legacy cases are permanently archived after the scheduled continuation");
  assert.equal((await attachments.retention.handler(ctx,{token:"fixture-admin",id:caseSupportFile.attempt._id})).caseArchived,false,"An unrelated account support chat is not made permanent by a rental case");
  const manualArchive = await db.query("chat_case_archives").withIndex("by_case", q => q.eq("caseId", closedCase._id)).first();
  assert.equal(manualArchive.threadId, manualCaseThread._id, "Closed case chats remain in the permanent archive");
  const manualWindow = await attachments.retention.handler(ctx,{token:"fixture-admin",id:manualArchiveFile.attempt._id});
  assert.equal(manualWindow.caseArchived,true, "A case-linked rental attachment belongs to the permanent archive");
  assert.equal(manualWindow.expiresAt, null, "Archived case attachments have no expiry date");
  await assert.rejects(attachments.removePublished.handler(ctx, { token: "fixture-admin", id: manualArchiveFile.attempt._id, reason: "Remove file after review", confirmed: true, expectedRevision: 0 }), /permanent rental case archive/);
  await assert.rejects(attachments.setRetentionHold.handler(ctx, { token: "fixture-admin", id: manualArchiveFile.attempt._id, hold: true, reason: "Archive retention is permanent", confirmed: true, expectedRevision: 0 }), /permanent rental case archive/);
  assert.equal(manualArchiveFile.attempt.status, "published", "An archived rental attachment cannot be removed by the ordinary admin action");

  let sweep = await attachments.purgeExpired.handler(ctx, {});
  const firstSweepScanned = sweep.scanned;
  while (scheduled.some(job => job.reference === "chatAttachments.purgeExpired")) {
    const index = scheduled.findIndex(job => job.reference === "chatAttachments.purgeExpired");
    const continuation = scheduled.splice(index, 1)[0];
    sweep = await attachments.purgeExpired.handler(ctx, continuation.args);
  }
  assert(firstSweepScanned >= 8);
  assert.equal(expired.attempt.status, "removed", "Rental attachments expire 90 days after return");
  assert.equal(exactExpiry.attempt.status, "removed", "Rental files expire at the exact 90-day boundary");
  assert.equal(blobs.has(expired.storageId), false);
  assert.equal((await db.get(expired.messageId)).text, "Attachment removed");
  assert.equal(protectedByCase.attempt.status, "published", "Open case evidence is retained after the 90-day date");
  assert.equal(caseSupportFile.attempt.status, "removed", "An open rental case does not hold an unrelated support-chat attachment");
  assert.equal(active.attempt.status, "published", "Active rental files have no expiry date");
  assert.equal(closedSupport.attempt.status, "removed", "Closed support attachments expire 90 days after closure");
  assert.equal(reopenedSupport.attempt.status, "published", "A reopened support chat pauses expiry of its attachments");
  assert.equal(ambiguousSupport.attempt.status, "published", "Ambiguous legacy support threads fail closed rather than selecting one closure date and deleting evidence");
  assert.equal(ambiguousSupport.attempt.retentionNeedsReview, true, "Duplicate account-level support threads require retention review");
  assert.equal(blobs.has(ambiguousSupport.storageId), true, "Ambiguous thread history never deletes attachment bytes");
  assert.equal(held.attempt.status, "published", "A manual retention hold prevents deletion");
  assert.equal(corrupt.attempt.status, "published");
  assert.equal(corrupt.attempt.retentionNeedsReview, true, "A mismatched message binding fails closed for review");
  assert.equal(blobs.has(corrupt.storageId), true, "A corrupt binding never deletes its file");
  assert.equal(notYetClosed.attempt.status, "published", "The 90-day idle period starts from the actual closure time");

  const action = (await db.query("chat_attachment_actions").collect()).find(row => row.attachmentId === expired.attempt._id && row.action === "retention_removed");
  assert.equal(action.action, "retention_removed");
  assert.match(action.reason, /90-day retention/);

  claim.status = "closed";
  claim.closedAt = now;
  sweep = await attachments.purgeExpired.handler(ctx, {});
  assert.equal(protectedByCase.attempt.status, "published", "Closing a case does not expire its permanently archived attachment");
  assert.equal((await db.get(protectedByCase.messageId)).text, "Attachment: evidence.png", "The archived rental chat retains its attachment entry");
  assert(blobs.has(protectedByCase.storageId), "The archived attachment bytes remain available after case closure");
  assert.equal((await db.query("chat_case_archives").withIndex("by_case", q => q.eq("caseId", claim._id)).first()).threadId, caseThread._id, "The case chat archive remains linked to its rental thread");

  let currentNow = now + 90 * day - 1;
  Date.now = () => currentNow;
  await attachments.purgeExpiredActionAudits.handler(ctx, {});
  assert((await db.query("chat_attachment_actions").withIndex("by_attachment", q => q.eq("attachmentId", expired.attempt._id)).collect()).length > 0, "Deletion audit remains until the full 90 days elapse");
  assert.equal(legacyDeletionAudit.purgeAfter, now + 90 * day, "legacy deletion rows are backfilled to the correct 90-day expiry");
  assert.equal(orphanedHoldAudit.purgeAfter, now + 90 * day, "legacy hold history is tied to the surviving removal event when its attempt row is gone");
  assert.equal(orphanedDeletionAudit.purgeAfter, now + 90 * day, "an orphaned legacy removal audit receives a 90-day expiry from its own deletion time");
  assert.equal(notYetClosed.attempt.status, "published", "A closure-based file remains through 90 days minus one millisecond");

  currentNow = now + 90 * day;
  sweep = await attachments.purgeExpired.handler(ctx, {});
  assert.equal(notYetClosed.attempt.status, "removed", "An attachment expires 90 days after automatic conversation closure");
  assert.equal(staleThread.closedAt, now);
  await attachments.purgeExpiredActionAudits.handler(ctx, {});
  assert.equal((await db.query("chat_attachment_actions").withIndex("by_attachment", q => q.eq("attachmentId", expired.attempt._id)).collect()).length, 0, "Deletion audit metadata expires 90 days after the attachment is deleted");
  assert.equal((await db.query("chat_attachment_actions").withIndex("by_attachment", q => q.eq("attachmentId", orphanedAttachmentId)).collect()).length, 0, "legacy audit rows without an attempt are removed after 90 days from the surviving deletion event");
  assert.equal((await db.query("chat_attachment_actions").withIndex("by_attachment", q => q.eq("attachmentId", manuallyDeleted.attempt._id)).collect()).length, 0, "interactive-removal audit rows follow the same 90-day lifecycle");
  assert.equal(await db.get(expired.attempt._id), null, "The removed upload metadata and its account/booking link expire with the final deletion-audit row");
  assert.equal(await db.get(manuallyDeleted.attempt._id), null, "interactive removal metadata is cleaned up after its audit expires");
  assert.equal((await db.query("chat_attachment_actions").withIndex("by_attachment", q => q.eq("attachmentId", protectedByCase.attempt._id)).collect()).length, 0, "No deletion audit is written for permanently archived bytes");
  assert.equal((await db.get(protectedByCase.attempt._id)).status, "published", "Case attachment metadata remains with its permanent archive");
  assert((await db.query("chat_case_archives").withIndex("by_case", q => q.eq("caseId", claim._id)).first()), "The permanent chat archive remains linked to the attachment");
  assert.equal(caseThread.caseArchivedAt, old, "The preserved rental conversation remains marked as a case archive");

  const manyThreads = Array.from({ length: 51 }, (_, index) => put("chat_threads", {
    accountId: put("accounts", { email: `batch-${index}@example.invalid` })._id,
    escalated: false,
    updatedAt: currentNow - 91 * day,
  }));
  const batchOne = await attachments.closeInactiveSupportThreads.handler(ctx, {});
  assert.equal(batchOne.closed, 50);
  assert.equal(batchOne.continued, true);
  assert.equal(scheduled.at(-1).reference, "chatAttachments.closeInactiveSupportThreads");
  const closeContinuationIndex = scheduled.findIndex(job => job.reference === "chatAttachments.closeInactiveSupportThreads");
  assert.notEqual(closeContinuationIndex, -1, "the closure continuation is durably queued");
  const closeContinuation = scheduled.splice(closeContinuationIndex, 1)[0];
  const batchTwo = await attachments.closeInactiveSupportThreads.handler(ctx, closeContinuation.args);
  assert(batchTwo.closed >= 1, "The follow-up sweep closes remaining inactive support threads");
  assert.equal(batchTwo.continued, false);
  assert(manyThreads.every(thread => thread.closedAt === currentNow));

  const pagedExpired = Array.from({ length: 12 }, (_, index) => {
    const account = put("accounts", { email: `paged-expired-${index}@example.invalid` });
    const booking = put("bookings", { accountId: account._id, status: "returned", returnedAt: old });
    return addAttachment({ account, booking });
  });
  const purgePageOne = await attachments.purgeExpired.handler(ctx, {});
  assert.equal(purgePageOne.scanned, 10, "attachment expiry is bounded to one indexed page");
  assert.equal(purgePageOne.continued, true);
  let purgeContinuations = 0;
  while (scheduled.some(job => job.reference === "chatAttachments.purgeExpired")) {
    const index = scheduled.findIndex(job => job.reference === "chatAttachments.purgeExpired");
    const continuation = scheduled.splice(index, 1)[0];
    await attachments.purgeExpired.handler(ctx, continuation.args);
    purgeContinuations++;
    assert(purgeContinuations < 5, "attachment expiry continuation terminates after bounded pages");
  }
  assert(purgeContinuations > 0, "the scheduled attachment-purge continuation was executed");
  assert(pagedExpired.every(file => file.attempt.status === "removed"), "scheduled pages remove all remaining expired attachments");

  Date.now = originalNow;
  console.log("PASS 90-day expiry, permanent case-chat attachments, unrelated support expiry, manual holds, integrity fail-closed, and support reopen.");
})().catch(error => { Date.now = originalNow; console.error(error); process.exitCode = 1; });
