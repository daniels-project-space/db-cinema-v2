import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { rentalsForAccount } from "./lib/rentalAccount";

const DOCUMENT_RETENTION_MS = 30 * 86400000;
function rentalClosedAt(booking: any): number | undefined {
  return booking?.status === "returned" ? booking.returnedAt : booking?.status === "cancelled" ? booking.cancelledAt : undefined;
}

export async function queueVerificationArchive(ctx: any, booking: any) {
  if (!booking.diditSessionId) return;
  const existing = await ctx.db.query("verification_archives").withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).collect();
  const previous = existing.find((a: any) => a.sessionId === booking.diditSessionId);
  if (previous) {
    if (previous.status === "complete") {
      await ctx.db.patch(previous._id, { status: "pending", attempts: 0, dueAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.verificationArchiveWorker.capture, { archiveId: previous._id });
    }
    return;
  }
  const account = booking.accountId ? await ctx.db.get(booking.accountId) : await ctx.db.query("accounts").withIndex("by_email", (q: any) => q.eq("email", (booking.guestEmail ?? "").trim().toLowerCase())).first();
  const archiveId = await ctx.db.insert("verification_archives", { bookingId: booking._id, accountId: account?._id, sessionId: booking.diditSessionId, email: booking.guestEmail ?? account?.email ?? "", status: "pending", attempts: 0, dueAt: Date.now(), createdAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.verificationArchiveWorker.capture, { archiveId });
}
export async function assertVerificationArchive(ctx: any, booking: any) {
  const source = booking.verificationReusedFrom ? await ctx.db.get(booking.verificationReusedFrom) : booking;
  if (!source?.diditSessionId) return;
  const archives = await ctx.db.query("verification_archives").withIndex("by_booking", (q: any) => q.eq("bookingId", source._id)).collect();
  if (!archives.some((a: any) => a.sessionId === source.diditSessionId && a.status === "complete")) throw Error("Verification document copies must be fully archived before handover. Check account documents and retry the archive.");
}
export const context = internalQuery({ args: { archiveId: v.id("verification_archives") }, handler: async (ctx, { archiveId }) => {
  const archive = await ctx.db.get(archiveId);
  if (!archive) return null;
  return { ...archive, documents: await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", archiveId)).collect() };
} });
export const save = internalMutation({ args: { archiveId: v.id("verification_archives"), kind: v.string(), storageId: v.id("_storage"), sha256: v.string(), size: v.number(), contentType: v.string(), replaceStorageId: v.optional(v.id("_storage")) }, handler: async (ctx, args) => {
  const archive = await ctx.db.get(args.archiveId);
  if (!archive || archive.status === "deleted") { await ctx.storage.delete(args.storageId); throw Error("Archive missing or expired"); }
  const documents = await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", args.archiveId)).collect();
  const existing = documents.find(d => d.kind === args.kind && d.sha256 === args.sha256);
  if (existing) {
    if (args.replaceStorageId === existing.storageId) {
      const replacedStorageId = existing.storageId;
      await ctx.db.patch(existing._id, { storageId: args.storageId, size: args.size, contentType: args.contentType });
      await ctx.storage.delete(replacedStorageId);
    } else await ctx.storage.delete(args.storageId);
    return;
  }
  const { replaceStorageId: _replaceStorageId, ...document } = args;
  await ctx.db.insert("verification_documents", { ...document, bookingId: archive.bookingId, accountId: archive.accountId, sessionId: archive.sessionId, savedAt: Date.now() });
} });
export const finish = internalMutation({ args: { archiveId: v.id("verification_archives"), complete: v.boolean() }, handler: async (ctx, args) => {
  const archive = await ctx.db.get(args.archiveId);
  if (!archive || archive.status === "complete" || archive.status === "deleted") return;
  const attempts = archive.attempts + 1;
  await ctx.db.patch(archive._id, args.complete ? { status: "complete", completedAt: Date.now(), error: undefined } : { status: attempts >= 12 ? "attention" : "pending", attempts, dueAt: Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7)), error: "Document archive incomplete. Provider documents must be checked and retried." });
} });
export const due = internalQuery({ args: {}, handler: async ctx => ctx.db.query("verification_archives").withIndex("by_status_due", q => q.eq("status", "pending").lte("dueAt", Date.now())).take(10) });
export const accountDocuments = query({ args: { token: v.string(), accountId: v.id("accounts") }, handler: async (ctx, args) => {
  if (!checkAdminToken(args.token)) throw Error("unauthorized");
  const jobs = await ctx.db.query("verification_archives").withIndex("by_account", q => q.eq("accountId", args.accountId)).collect();
  return Promise.all(jobs.map(async archive => ({ ...archive, email: undefined, documents: (await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", archive._id)).collect()).map(d => ({ id: d._id, kind: d.kind, size: d.size, sha256: d.sha256, savedAt: d.savedAt, contentType: d.contentType })) })));
} });
export const retry = mutation({ args: { token: v.string(), archiveId: v.id("verification_archives") }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "verificationArchive.retry");
  const archive = await ctx.db.get(args.archiveId);
  if (!archive || archive.status === "deleted") throw Error("Document retention period ended. Expired archives cannot be reopened.");
  if (archive.status === "complete") return;
  await ctx.db.patch(archive._id, { status: "pending", attempts: 0, dueAt: Date.now(), error: undefined });
  await ctx.scheduler.runAfter(0, internal.verificationArchiveWorker.capture, { archiveId: archive._id });
} });
export const downloadAccess = internalMutation({ args: { token: v.string(), documentId: v.id("verification_documents") }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "verificationArchive.viewDocument");
  const document = await ctx.db.get(args.documentId);
  if (!document) throw Error("Document not found");
  const archive = await ctx.db.get(document.archiveId);
  if (!archive || archive.status === "deleted") throw Error("Document retention period ended");
  return { storageId: document.storageId, kind: document.kind, contentType: document.contentType };
} });

export const backfillAccount = mutation({ args: { token: v.string(), accountId: v.id("accounts") }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "verificationArchive.backfillAccount");
  const account = await ctx.db.get(args.accountId);
  if (!account) throw Error("Account not found");
  const bookings = await rentalsForAccount(ctx, account, 100);
  for (const booking of bookings) {
    const closedAt = rentalClosedAt(booking);
    if (booking.diditSessionId && (!closedAt || closedAt + DOCUMENT_RETENTION_MS > Date.now())) await queueVerificationArchive(ctx, booking);
  }
} });
export const retentionHold = mutation({ args: { token: v.string(), archiveId: v.id("verification_archives"), reason: v.string() }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "verificationArchive.retentionHold");
  const archive = await ctx.db.get(args.archiveId);
  if (!archive || archive.status === "deleted") throw Error("Archive unavailable");
  if (args.reason && args.reason.trim().length < 10) throw Error("Record the open case or insurance claim reason.");
  await ctx.db.patch(archive._id, { retentionHoldReason: args.reason.trim().slice(0, 500) || undefined });
} });
/** Retain during rental/claim; remove bytes 30 days after actual return or cancellation. */
export const purgeExpired = internalMutation({ args: {}, handler: async ctx => {
  const archives = await ctx.db.query("verification_archives").collect();
  let removed = 0;
  for (const archive of archives) {
    if (removed >= 25 || archive.status === "deleted" || archive.retentionHoldReason) continue;
    const booking = await ctx.db.get(archive.bookingId);
    const reused = await ctx.db.query("bookings").withIndex("by_verification_reused", q => q.eq("verificationReusedFrom", archive.bookingId)).collect();
    if (reused.some(b => !["returned", "cancelled"].includes(b.status))) continue;
    let openCase = false;
    for (const id of [archive.bookingId, ...reused.map(b => b._id)]) {
      const cases = await ctx.db.query("rental_damage_cases").withIndex("by_booking", q => q.eq("bookingId", id)).collect();
      if (cases.some(c => c.status === "open")) { openCase = true; break; }
    }
    if (openCase) continue;
    const closedAt = rentalClosedAt(booking);
    if (!closedAt || closedAt + DOCUMENT_RETENTION_MS > Date.now()) continue;
    if (reused.some(b => !rentalClosedAt(b) || rentalClosedAt(b)! + DOCUMENT_RETENTION_MS > Date.now())) continue;
    const documents = await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", archive._id)).collect();
    for (const document of documents) await ctx.storage.delete(document.storageId);
    await ctx.db.patch(archive._id, { status: "deleted", deletedAt: Date.now(), error: undefined });
    removed++;
  }
  return removed;
} });
