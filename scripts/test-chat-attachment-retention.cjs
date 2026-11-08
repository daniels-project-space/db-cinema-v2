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
const { postRentalMessage } = load("convex/lib/rentalChat.ts");

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

  const expiredAccount = put("accounts", { email: "expired@example.invalid" });
  const expiredBooking = put("bookings", { accountId: expiredAccount._id, status: "returned", returnedAt: old });
  const expired = addAttachment({ account: expiredAccount, booking: expiredBooking });

  const caseAccount = put("accounts", { email: "case@example.invalid" });
  const caseBooking = put("bookings", { accountId: caseAccount._id, status: "returned", returnedAt: old });
  const protectedByCase = addAttachment({ account: caseAccount, booking: caseBooking });
  const claim = put("rental_damage_cases", { accountId: caseAccount._id, bookingId: caseBooking._id, status: "open", openedAt: old });
  const caseThread = put("chat_threads", { accountId: caseAccount._id, bookingId: caseBooking._id, escalated: false, updatedAt: now });
  const caseSupportThread = put("chat_threads", { accountId: caseAccount._id, escalated: false, updatedAt: now, closedAt: old });
  const caseSupportFile = addAttachment({ account: caseAccount, thread: caseSupportThread, closedAt: old });

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

  const heldAccount = put("accounts", { email: "held@example.invalid" });
  const heldBooking = put("bookings", { accountId: heldAccount._id, status: "returned", returnedAt: old });
  const held = addAttachment({ account: heldAccount, booking: heldBooking, hold: "Open case review" });

  const corruptAccount = put("accounts", { email: "corrupt@example.invalid" });
  const corruptBooking = put("bookings", { accountId: corruptAccount._id, status: "returned", returnedAt: old });
  const corrupt = addAttachment({ account: corruptAccount, booking: corruptBooking, brokenBinding: true });

  const staleAccount = put("accounts", { email: "stale@example.invalid" });
  const staleThread = put("chat_threads", { accountId: staleAccount._id, escalated: false, updatedAt: old });
  const notYetClosed = addAttachment({ account: staleAccount, thread: staleThread });

  const closedResult = await attachments.closeInactiveSupportThreads.handler(ctx, {});
  assert.equal(closedResult.closed, 1, "Only inactive open support threads are closed");
  assert.equal(staleThread.closedAt, now, "The support conversation closes at the idle cutoff job time");
  assert.equal(closedSupport.attempt.status, "published", "An open case is not required for retaining a recently closed thread file");
  const backfill = await caseArchive.backfillLegacyCaseArchives.handler(ctx, {});
  assert.equal(backfill.complete, true);
  assert.equal((await db.query("chat_case_archives").withIndex("by_case", q => q.eq("caseId", claim._id)).first()).bookingId, caseBooking._id);
  assert.equal(caseThread.caseArchivedAt, old, "The permanent archive is attached to the case's rental conversation");
  assert.equal((await attachments.retention.handler(ctx,{token:"fixture-admin",id:caseSupportFile.attempt._id})).caseArchived,false,"An unrelated account support chat is not made permanent by a rental case");

  let sweep = await attachments.purgeExpired.handler(ctx, {});
  assert(sweep.scanned >= 7);
  assert.equal(expired.attempt.status, "removed", "Rental attachments expire 90 days after return");
  assert.equal(blobs.has(expired.storageId), false);
  assert.equal((await db.get(expired.messageId)).text, "Attachment removed");
  assert.equal(protectedByCase.attempt.status, "published", "Open case evidence is retained after the 90-day date");
  assert.equal(caseSupportFile.attempt.status, "published", "An open case temporarily protects unrelated account support files without archiving that thread");
  assert.equal(active.attempt.status, "published", "Active rental files have no expiry date");
  assert.equal(closedSupport.attempt.status, "removed", "Closed support attachments expire 90 days after closure");
  assert.equal(reopenedSupport.attempt.status, "published", "A reopened support chat pauses expiry of its attachments");
  assert.equal(held.attempt.status, "published", "A manual retention hold prevents deletion");
  assert.equal(corrupt.attempt.status, "published");
  assert.equal(corrupt.attempt.retentionNeedsReview, true, "A mismatched message binding fails closed for review");
  assert.equal(blobs.has(corrupt.storageId), true, "A corrupt binding never deletes its file");
  assert.equal(notYetClosed.attempt.status, "published", "The 90-day idle period starts from the actual closure time");

  const action = (await db.query("chat_attachment_actions").collect()).find(row => row.attachmentId === expired.attempt._id);
  assert.equal(action.action, "retention_removed");
  assert.match(action.reason, /90-day retention/);

  claim.status = "closed";
  claim.closedAt = now;
  sweep = await attachments.purgeExpired.handler(ctx, {});
  assert.equal(protectedByCase.attempt.status, "published", "The case rental chat stays archived after the case closes");
  assert.equal(caseSupportFile.attempt.status, "removed", "A separate support chat returns to normal expiry after the case closes");
  process.env.ADMIN_TOKEN = "fixture-admin";
  await assert.rejects(attachments.removePublished.handler(ctx, { token: "fixture-admin", id: protectedByCase.attempt._id, reason: "Attempt to remove archived case evidence", confirmed: true, expectedRevision: 0 }), /permanent case archive/);

  const currentNow = now + 91 * day;
  Date.now = () => currentNow;
  sweep = await attachments.purgeExpired.handler(ctx, {});
  assert.equal(notYetClosed.attempt.status, "removed", "An attachment expires 90 days after automatic conversation closure");
  assert.equal(staleThread.closedAt, now);
  await attachments.purgeExpiredActionAudits.handler(ctx, {});
  assert.equal((await db.query("chat_attachment_actions").withIndex("by_attachment", q => q.eq("attachmentId", expired.attempt._id)).collect()).length, 0, "Deletion audit metadata expires 90 days after the attachment is deleted");

  const manyThreads = Array.from({ length: 51 }, (_, index) => put("chat_threads", {
    accountId: put("accounts", { email: `batch-${index}@example.invalid` })._id,
    escalated: false,
    updatedAt: currentNow - 91 * day,
  }));
  const batchOne = await attachments.closeInactiveSupportThreads.handler(ctx, {});
  assert.equal(batchOne.closed, 50);
  assert.equal(batchOne.continued, true);
  assert.equal(scheduled.at(-1).reference, "chatAttachments.closeInactiveSupportThreads");
  const batchTwo = await attachments.closeInactiveSupportThreads.handler(ctx, {});
  assert(batchTwo.closed >= 1, "The follow-up sweep closes remaining inactive support threads");
  assert.equal(batchTwo.continued, false);
  assert(manyThreads.every(thread => thread.closedAt === currentNow));

  Date.now = originalNow;
  console.log("PASS 90-day attachment expiry, case holds, manual holds, integrity fail-closed, support auto-close and chat reopen.");
})().catch(error => { Date.now = originalNow; console.error(error); process.exitCode = 1; });
