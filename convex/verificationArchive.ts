import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { accountForRental } from "./lib/rentalAccount";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { linkVerificationCopies } from "./lib/verificationOwnership";
import { queueOwnerNotification } from "./lib/adminPush";
import { deletePrivateFile } from "./lib/privateStorage";

const DOCUMENT_RETENTION_MS = 30 * 86400000;
const CAPTURE_LEASE_MS = 5 * 60000;
async function flagArchiveFailure(ctx:any,archive:any){
 const booking=await ctx.db.get(archive.bookingId),account=await accountForRental(ctx,booking);
 if(account)await queueOwnerNotification(ctx,{eventKey:`verification-archive-failed:${archive._id}:${archive.generation??0}`,kind:"verification_archive",accountId:account._id,bookingId:archive.bookingId,
  title:"Verification documents need attention",body:"Document copying could not finish after repeated attempts. Open this rental and retry its account document archive. Handover remains blocked."});
}
function rentalClosedAt(booking: any): number | undefined {
  return booking?.status === "returned" ? booking.returnedAt : booking?.status === "cancelled" ? booking.cancelledAt : undefined;
}

/** One retention decision shared by the admin screen and byte deletion. */
async function archiveRetention(ctx: any, archive: any) {
  if (archive.status === "deleted") return { status: "deleted" as const, expiresAt: null, activeRentals: 0, openCases: 0, viewable: false };
  const booking = await ctx.db.get(archive.bookingId);
  const reused = await ctx.db.query("bookings").withIndex("by_verification_reused", (q: any) => q.eq("verificationReusedFrom", archive.bookingId)).collect();
  const rentals = [booking, ...reused].filter(Boolean);
  const activeRentals = rentals.filter((b: any) => !["returned", "cancelled"].includes(b.status)).length;
  let openCases = 0;
  for (const id of [archive.bookingId, ...reused.map((b: any) => b._id)]) {
    const cases = await ctx.db.query("rental_damage_cases").withIndex("by_booking", (q: any) => q.eq("bookingId", id)).collect();
    openCases += cases.filter((c: any) => c.status === "open").length;
  }
  const base = { expiresAt: null as number | null, activeRentals, openCases, viewable: true };
  if (activeRentals) return { ...base, status: "active-rental" as const };
  if (openCases) return { ...base, status: "insurance-case" as const };
  if (archive.retentionHoldReason) return { ...base, status: "manual-hold" as const };
  if (!booking || rentals.some((b: any) => !rentalClosedAt(b))) return { ...base, status: "unknown-closure" as const };
  const expiresAt = Math.max(...rentals.map((b: any) => rentalClosedAt(b)!)) + DOCUMENT_RETENTION_MS;
  return { ...base, status: "expires" as const, expiresAt, viewable: expiresAt > Date.now() };
}

export async function queueVerificationArchive(ctx: any, booking: any,refresh=false) {
  if (!booking.diditSessionId) return;
  const account = await accountForRental(ctx, booking);
  if (account) await linkVerificationCopies(ctx, booking._id, account._id);
  const existing = await ctx.db.query("verification_archives").withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).collect();
  const previous = existing.find((a: any) => a.sessionId === booking.diditSessionId);
  if (previous) {
    if (previous.status === "deleted" || !(await archiveRetention(ctx,previous)).viewable) return;
    if(!refresh && previous.status!=="complete")return;
    // A new provider event invalidates an older in-flight report. Its worker
    // must not save stale bytes or declare the newer revision complete.
    await ctx.db.patch(previous._id, { status: "pending", attempts: 0, dueAt: Date.now(),
      generation:(previous.generation??0)+1,leaseUntil:undefined,error:undefined });
    await ctx.scheduler.runAfter(0, internal.verificationArchiveWorker.capture, { archiveId: previous._id });
    return;
  }
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
export const claim=internalMutation({args:{archiveId:v.id("verification_archives")},handler:async(ctx,{archiveId})=>{
 const archive=await ctx.db.get(archiveId),now=Date.now();
 if(!archive || archive.status!=="pending" || archive.dueAt>now || (archive.leaseUntil??0)>now || !(await archiveRetention(ctx,archive)).viewable)return null;
 if(archive.attempts>=12){await ctx.db.patch(archiveId,{status:"attention",leaseUntil:undefined,error:"Document copying could not finish. Retry the archive from account documents."});await flagArchiveFailure(ctx,archive);return null;}
 const patch={generation:(archive.generation??0)+1,leaseUntil:now+CAPTURE_LEASE_MS,dueAt:now+CAPTURE_LEASE_MS,attempts:archive.attempts+1};
 await ctx.db.patch(archiveId,patch);
 return {...archive,...patch,documents:await ctx.db.query("verification_documents").withIndex("by_archive",q=>q.eq("archiveId",archiveId)).collect()};
}});
export const save = internalMutation({ args: { archiveId: v.id("verification_archives"), generation:v.number(),kind: v.string(), storageId: v.id("_storage"), sha256: v.string(), size: v.number(), contentType: v.string(), replaceStorageId: v.optional(v.id("_storage")) }, handler: async (ctx, args) => {
  const archive = await ctx.db.get(args.archiveId);
  if (!archive || archive.status!=="pending" || archive.generation!==args.generation || (archive.leaseUntil??0)<=Date.now() || !(await archiveRetention(ctx,archive)).viewable) { await deletePrivateFile(ctx,args.storageId); return false; }
  const documents = await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", args.archiveId)).collect();
  const existing = documents.find(d => d.kind === args.kind && d.sha256 === args.sha256);
  if (existing) {
    if (args.replaceStorageId === existing.storageId) {
      const replacedStorageId = existing.storageId;
      await ctx.db.patch(existing._id, { storageId: args.storageId, size: args.size, contentType: args.contentType });
      await deletePrivateFile(ctx,replacedStorageId);
    } else await deletePrivateFile(ctx,args.storageId);
    return true;
  }
  const { replaceStorageId: _replaceStorageId,generation:_generation, ...document } = args;
  await ctx.db.insert("verification_documents", { ...document, bookingId: archive.bookingId, accountId: archive.accountId, sessionId: archive.sessionId, savedAt: Date.now() });
  return true;
} });
export const finish = internalMutation({ args: { archiveId: v.id("verification_archives"),generation:v.number(), complete: v.boolean() }, handler: async (ctx, args) => {
  const archive = await ctx.db.get(args.archiveId);
  if (!archive || archive.status!=="pending" || archive.generation!==args.generation || (archive.leaseUntil??0)<=Date.now() || !(await archiveRetention(ctx,archive)).viewable) return;
  const attempts = archive.attempts;
  await ctx.db.patch(archive._id, {leaseUntil:undefined,...(args.complete ? { status: "complete", completedAt: Date.now(), error: undefined } : { status: attempts >= 12 ? "attention" : "pending", attempts, dueAt: Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7)), error: "Document archive incomplete. Available copies are saved; remaining provider documents must be checked and retried." })});
  if(!args.complete && attempts>=12)await flagArchiveFailure(ctx,archive);
  if (args.complete) {
    const reused = await ctx.db.query("bookings").withIndex("by_verification_reused", (q: any) => q.eq("verificationReusedFrom", archive.bookingId)).collect();
    for (const bookingId of [archive.bookingId, ...reused.map((b: any) => b._id)]) {
      const booking = await ctx.db.get(bookingId as typeof archive.bookingId);
      if (booking && ["confirmed", "active"].includes(booking.status)) await queueRmv2Sync(ctx, bookingId);
    }
  }
} });
export const due = internalQuery({ args: {}, handler: async ctx => ctx.db.query("verification_archives").withIndex("by_status_due", q => q.eq("status", "pending").lte("dueAt", Date.now())).take(10) });
export const accountDocuments = query({ args: { token: v.string(), accountId: v.id("accounts") }, handler: async (ctx, args) => {
  if (!checkAdminToken(args.token)) throw Error("unauthorized");
  const jobs = await ctx.db.query("verification_archives").withIndex("by_account", q => q.eq("accountId", args.accountId)).collect();
  return Promise.all(jobs.map(async archive => ({ ...archive, email: undefined, retention: await archiveRetention(ctx, archive), documents: (await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", archive._id)).collect()).map(d => ({ id: d._id, kind: d.kind, size: d.size, sha256: d.sha256, savedAt: d.savedAt, contentType: d.contentType })) })));
} });
export const retry = mutation({ args: { token: v.string(), archiveId: v.id("verification_archives") }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "verificationArchive.retry");
  const archive = await ctx.db.get(args.archiveId);
  if (!archive || archive.status === "deleted") throw Error("Document retention period ended. Expired archives cannot be reopened.");
  if (archive.status === "complete") return;
  if(!(await archiveRetention(ctx,archive)).viewable)throw Error("Document retention period ended.");
  await ctx.db.patch(archive._id, { status: "pending", attempts: 0, dueAt: Date.now(), error: undefined,generation:(archive.generation??0)+1,leaseUntil:undefined });
  await ctx.scheduler.runAfter(0, internal.verificationArchiveWorker.capture, { archiveId: archive._id });
} });
export const downloadAccess = internalMutation({ args: { token: v.string(), documentId: v.id("verification_documents") }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "verificationArchive.viewDocument");
  const document = await ctx.db.get(args.documentId);
  if (!document) throw Error("Document not found");
  const archive = await ctx.db.get(document.archiveId);
  if (!archive || !(await archiveRetention(ctx, archive)).viewable) throw Error("Document retention period ended");
  return { storageId: document.storageId, kind: document.kind, contentType: document.contentType };
} });

/** Walk both ownership indexes without truncating an account's rental history. */
async function backfillPage(ctx: any, accountId: any, legacy: boolean, cursor: string | null) {
  const account = await ctx.db.get(accountId);
  if (!account) return;
  const rentals = legacy
    ? ctx.db.query("bookings").withIndex("by_account_guestEmail", (q: any) => q.eq("accountId", undefined).eq("guestEmail", account.email))
    : ctx.db.query("bookings").withIndex("by_account", (q: any) => q.eq("accountId", accountId));
  const page = await rentals.order("desc").paginate({ numItems: 25, cursor });
  for (const booking of page.page) {
    if (!booking.diditSessionId) continue;
    const archives = await ctx.db.query("verification_archives").withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).collect();
    const existing = archives.find((a: any) => a.sessionId === booking.diditSessionId);
    // The same decision preserves active reuse and claims, without recopying
    // expired documents or resurrecting an archive whose bytes were deleted.
    const retention = await archiveRetention(ctx, existing ?? { bookingId: booking._id, status: "pending" });
    if (retention.viewable) await queueVerificationArchive(ctx, booking);
  }
  if (!page.isDone || !legacy) {
    await ctx.scheduler.runAfter(0, internal.verificationArchive.backfillNext, {
      accountId, legacy: page.isDone ? true : legacy,
      cursor: page.isDone ? null : page.continueCursor,
    });
  }
}
export const backfillAccount = mutation({ args: { token: v.string(), accountId: v.id("accounts") }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "verificationArchive.backfillAccount");
  if (!await ctx.db.get(args.accountId)) throw Error("Account not found");
  await backfillPage(ctx, args.accountId, false, null);
} });
export const backfillNext = internalMutation({
  args: { accountId: v.id("accounts"), legacy: v.boolean(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => backfillPage(ctx, args.accountId, args.legacy, args.cursor),
});
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
    const retention = await archiveRetention(ctx, archive);
    if (retention.status !== "expires" || retention.expiresAt === null || retention.expiresAt > Date.now()) continue;
    const documents = await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", archive._id)).collect();
    for (const document of documents) await deletePrivateFile(ctx,document.storageId);
    await ctx.db.patch(archive._id, { status: "deleted", deletedAt: Date.now(), error: undefined });
    removed++;
  }
  return removed;
} });
