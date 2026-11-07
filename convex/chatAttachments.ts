import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { accountForRental } from "./lib/rentalAccount";
import { chatAttachmentsReady } from "./lib/chatAttachmentScanner";
import { deletePrivateFile } from "./lib/privateStorage";
import { bump } from "./rateLimit";
import { chatAttachmentName } from "./lib/chatAttachmentName";
import { adminSessionMigrationReady, assertAdminScopeSession } from "./adminAccountSessionV2";
import { isChatImageType, CHAT_IMAGE_LIMIT } from "../shared/chatAttachmentPolicy";

async function attachmentAdminRead(ctx: QueryCtx, token: string): Promise<boolean> {
  if (process.env.ADMIN_SESSION_ATTACHMENTS_V2 === "enabled") {
    if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx, token, "customers:read"); return true;
  }
  return checkAdminToken(token);
}
async function attachmentAdminMutation(ctx: MutationCtx, token: string, scope: "customers:read" | "customers:write", fn: string): Promise<void> {
  if (process.env.ADMIN_SESSION_ATTACHMENTS_V2 === "enabled") {
    if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
    await assertAdminScopeSession(ctx, token, scope);
    await ctx.db.insert("admin_audit_log", { at: Date.now(), success: true, limited: false, fn }); return;
  }
  await assertAdmin(ctx, token, fn);
}

export const availability = query({ args: {}, handler: async () => chatAttachmentsReady() });

const scope = { token: v.string(), admin: v.boolean(), bookingId: v.optional(v.id("bookings")), accountId: v.optional(v.id("accounts")) };
const markerPattern = /^application\/vnd\.dbcinema\.chat-[a-f0-9]{32}$/;

async function resolveScope(ctx: any, args: any) {
  if (args.admin) {
    const booking = args.bookingId ? await ctx.db.get(args.bookingId) : null;
    const account = booking ? await accountForRental(ctx, booking) : args.accountId ? await ctx.db.get(args.accountId) : null;
    if (!account || (args.accountId && String(account._id) !== String(args.accountId))) throw Error("Conversation unavailable.");
    if (args.bookingId) await ownedBooking(ctx, account, args.bookingId);
    return account;
  }
  const account = await accountForToken(ctx, args.token, true);
  if (!account || (args.accountId && String(account._id) !== String(args.accountId))) throw Error("Access denied.");
  if (args.bookingId) await ownedBooking(ctx, account, args.bookingId);
  return account;
}

export const reserve = internalMutation({ args: { ...scope, marker: v.string(), requestKey: v.string() }, handler: async (ctx, args) => {
  if (args.admin) await attachmentAdminMutation(ctx, args.token, "customers:write", "chatAttachments.reserve");
  const account = await resolveScope(ctx, args);
  if (!markerPattern.test(args.marker) || !/^[a-f0-9]{32}$/.test(args.requestKey)) throw Error("Invalid upload.");
  const previous = await ctx.db.query("chat_attachment_attempts").withIndex("by_scope_request", q => q.eq("accountId", account._id).eq("bookingId", args.bookingId).eq("admin", args.admin).eq("requestKey", args.requestKey)).first();
  if (previous?.status === "removed") throw Error("This attachment was removed; start a new upload if needed.");
  if (previous?.status === "published") {
    if (!(await bump(ctx, `chat-attachment-replay:${account._id}`, 12, 60_000)).allowed) throw Error("Too many attempts.");
    return { status: "published" as const, sha256: previous.sha256, size: previous.size, contentType: previous.contentType, name: previous.name };
  }
  if (previous && previous.status !== "failed" && previous.createdAt > Date.now() - 5 * 60_000) return { status: "pending" as const };
  const now = Date.now(), cutoff = now - 60_000;
  const recent = await ctx.db.query("chat_attachment_attempts").withIndex("by_account_created", q => q.eq("accountId", account._id).gte("createdAt", cutoff)).take(12);
  const attempts = recent.reduce((count, row) => count + (row.recentAttemptTimes ?? [row.createdAt]).filter(at => at >= cutoff).length, 0);
  if (attempts >= 12) throw Error("Too many attempts.");
  if (await ctx.db.query("chat_attachment_attempts").withIndex("by_marker", q => q.eq("marker", args.marker)).first()) throw Error("Invalid upload.");
  const sweep = await ctx.db.query("chat_attachment_sweep").withIndex("by_key", q => q.eq("key", "uploads")).first();
  if (!sweep) await ctx.db.insert("chat_attachment_sweep", { key: "uploads", watermark: Date.now() - 60_000 });
  if (previous) {
    const recentAttemptTimes = (previous.recentAttemptTimes ?? [previous.createdAt]).filter(at => at >= cutoff);
    await ctx.db.patch(previous._id, { marker: args.marker, createdAt: now, recentAttemptTimes: [...recentAttemptTimes, now], status: "pending" });
    return { status: "ready" as const, id: previous._id };
  }
  const id = await ctx.db.insert("chat_attachment_attempts", { accountId: account._id, bookingId: args.bookingId, admin: args.admin, requestKey: args.requestKey, marker: args.marker, createdAt: now, recentAttemptTimes: [now], status: "pending" });
  return { status: "ready" as const, id };
} });

export const recordScan = internalMutation({ args: { id: v.id("chat_attachment_attempts"), marker: v.string(), sha256: v.string(), size: v.number(), contentType: v.string(), engine: v.string(), signatureVersion: v.string(), signatureUpdatedAt: v.number() }, handler: async (ctx, args) => {
  const attempt = await ctx.db.get(args.id);
  if (!attempt || attempt.marker !== args.marker || attempt.status !== "pending" || attempt.createdAt < Date.now() - 5 * 60_000 || !/^[a-f0-9]{64}$/.test(args.sha256) || !Number.isSafeInteger(args.size) || args.size < 1 || args.size > CHAT_IMAGE_LIMIT || !isChatImageType(args.contentType)) throw Error("Invalid scan.");
  await ctx.db.patch(attempt._id, { status: "scanned", sha256: args.sha256, size: args.size, contentType: args.contentType, engine: args.engine, signatureVersion: args.signatureVersion, signatureUpdatedAt: args.signatureUpdatedAt });
} });

export const publish = internalMutation({ args: { ...scope, id: v.id("chat_attachment_attempts"), marker: v.string(), storageId: v.id("_storage"), name: v.string() }, handler: async (ctx, args) => {
  if (args.admin) await attachmentAdminMutation(ctx, args.token, "customers:write", "chatAttachments.publish");
  const account = await resolveScope(ctx, args);
  const attempt = await ctx.db.get(args.id);
  const metadata = await ctx.db.system.get(args.storageId);
  const expectedHash = attempt?.sha256 && /^[a-f0-9]{64}$/.test(attempt.sha256) ? btoa(String.fromCharCode(...attempt.sha256.match(/../g)!.map(byte => parseInt(byte, 16)))) : null;
  if (!attempt || attempt.status !== "scanned" || attempt.marker !== args.marker || attempt.accountId !== account._id || attempt.bookingId !== args.bookingId || attempt.admin !== args.admin || attempt.createdAt < Date.now() - 5 * 60_000 || !metadata || metadata.contentType !== attempt.marker || metadata.size !== attempt.size || !expectedHash || (metadata.sha256 !== attempt.sha256 && metadata.sha256 !== expectedHash)) throw Error("Attachment unavailable.");
  const name = chatAttachmentName(args.name, attempt.contentType ?? "");
  const messageId = await postRentalMessage(ctx, { accountId: account._id, bookingId: args.bookingId, sender: args.admin ? "owner" : "renter", text: `Attachment: ${name}`, meta: { kind: "attachment", attachmentId: attempt._id, name } });
  await ctx.db.patch(attempt._id, { status: "published", storageId: args.storageId, messageId, name });
} });

export const fail = internalMutation({ args: { id: v.id("chat_attachment_attempts"), marker: v.string(), storageId: v.optional(v.id("_storage")) }, handler: async (ctx, args) => {
  const attempt = await ctx.db.get(args.id);
  if (!attempt || attempt.marker !== args.marker || ["published","removed"].includes(attempt.status)) return;
  if (args.storageId) {
    const file = await ctx.db.system.get(args.storageId);
    if (file?.contentType === args.marker) await ctx.storage.delete(args.storageId);
  }
  await ctx.db.patch(attempt._id, { status: "failed" });
} });

export const download = internalMutation({ args: { ...scope, id: v.id("chat_attachment_attempts") }, handler: async (ctx, args) => {
  if (args.admin) await attachmentAdminMutation(ctx, args.token, "customers:read", "chatAttachments.download");
  const account = await resolveScope(ctx, args);
  const attempt = await ctx.db.get(args.id);
  if (!attempt || attempt.status !== "published" || attempt.accountId !== account._id || attempt.bookingId !== args.bookingId || !attempt.storageId || !attempt.messageId || !attempt.sha256 || !attempt.size || !attempt.name) throw Error("Attachment unavailable.");
  const message = await ctx.db.get(attempt.messageId);
  if (!message || message.accountId !== account._id || message.bookingId !== args.bookingId || message.meta?.attachmentId !== attempt._id) throw Error("Attachment unavailable.");
  return { storageId: attempt.storageId, messageId: attempt.messageId, sha256: attempt.sha256, size: attempt.size, name: attempt.name };
} });

async function openCases(ctx:any,attempt:any) {
  const cases=new Map<string,any>();
  const collect=async(query:any)=>{const rows=await query.take(101);if(rows.length>100)throw Error("Case history needs review before changing this file.");for(const row of rows)cases.set(String(row._id),row);};
  if(attempt.bookingId)await collect(ctx.db.query("rental_damage_cases").withIndex("by_booking",(q:any)=>q.eq("bookingId",attempt.bookingId)));
  else {
    const account=await ctx.db.get(attempt.accountId);if(!account?.email)throw Error("Account ownership needs review before changing this file.");
    await collect(ctx.db.query("rental_damage_cases").withIndex("by_account",(q:any)=>q.eq("accountId",attempt.accountId)));
    const linked=await ctx.db.query("bookings").withIndex("by_account",(q:any)=>q.eq("accountId",attempt.accountId)).take(51);
    const legacy=await ctx.db.query("bookings").withIndex("by_guestEmail",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase())).filter((q:any)=>q.eq(q.field("accountId"),undefined)).take(51);
    if(linked.length>50||legacy.length>50)throw Error("Rental history needs review before changing this file.");
    for(const booking of [...linked,...legacy])await collect(ctx.db.query("rental_damage_cases").withIndex("by_booking",(q:any)=>q.eq("bookingId",booking._id)));
  }
  for(const item of cases.values())if(item.status==="closed"&&(!Number.isFinite(item.openedAt)||item.openedAt<=0||!Number.isFinite(item.closedAt)||item.closedAt<item.openedAt||item.closedAt>Date.now()))throw Error("Case dates need review before changing this file.");
  return [...cases.values()].filter((item:any)=>item.status!=="closed").length;
}

export const retention=query({args:{token:v.string(),id:v.id("chat_attachment_attempts")},handler:async(ctx,args)=>{
  if(!await attachmentAdminRead(ctx,args.token)||!chatAttachmentsReady())return null;
  const attempt=await ctx.db.get(args.id);if(!attempt||attempt.status!=="published")return null;
  try{return {holdReason:attempt.retentionHoldReason??null,holdRevision:attempt.retentionHoldRevision??0,openCases:await openCases(ctx,attempt),needsReview:false};}
  catch{return {holdReason:attempt.retentionHoldReason??null,holdRevision:attempt.retentionHoldRevision??0,openCases:0,needsReview:true};}
}});

export const setRetentionHold=mutation({args:{token:v.string(),id:v.id("chat_attachment_attempts"),hold:v.boolean(),reason:v.string(),confirmed:v.boolean(),expectedRevision:v.number()},handler:async(ctx,args)=>{
  await attachmentAdminMutation(ctx,args.token,"customers:write","chatAttachments.setRetentionHold");if(!chatAttachmentsReady())throw Error("Attachments are unavailable.");
  const reason=args.reason.trim();if(!args.confirmed||reason.length<10||reason.length>500)throw Error("Confirm and record a reason of 10–500 characters.");
  const attempt=await ctx.db.get(args.id);if(!attempt||attempt.status!=="published")throw Error("Attachment unavailable.");
  if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<0||args.expectedRevision>=Number.MAX_SAFE_INTEGER||args.expectedRevision!==(attempt.retentionHoldRevision??0))throw Error("The retention hold changed. Review it and confirm again.");
  if(args.hold&&attempt.retentionHoldReason===reason||!args.hold&&!attempt.retentionHoldReason)return;
  await ctx.db.patch(attempt._id,{retentionHoldReason:args.hold?reason:undefined,retentionHoldRevision:args.expectedRevision+1});
  await ctx.db.insert("chat_attachment_actions",{attachmentId:attempt._id,accountId:attempt.accountId,...(attempt.bookingId?{bookingId:attempt.bookingId}:{}),action:args.hold?"hold_added":"hold_removed",reason,at:Date.now()});
}});

export const removePublished=mutation({args:{token:v.string(),id:v.id("chat_attachment_attempts"),reason:v.string(),confirmed:v.boolean(),expectedRevision:v.number()},handler:async(ctx,args)=>{
  await attachmentAdminMutation(ctx,args.token,"customers:write","chatAttachments.removePublished");if(!chatAttachmentsReady())throw Error("Attachments are unavailable.");
  const reason=args.reason.trim();if(!args.confirmed||reason.length<10||reason.length>500)throw Error("Confirm and record a reason of 10–500 characters.");
  const attempt=await ctx.db.get(args.id);if(!attempt)throw Error("Attachment unavailable.");if(attempt.status==="removed")return;
  if(attempt.status!=="published"||!attempt.storageId||!attempt.messageId)throw Error("Attachment unavailable.");
  if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision!==(attempt.retentionHoldRevision??0))throw Error("The retention hold changed. Review it and confirm again.");
  if(attempt.retentionHoldReason||await openCases(ctx,attempt))throw Error("This attachment is protected by an open case or retention hold.");
  const message=await ctx.db.get(attempt.messageId);if(!message||message.accountId!==attempt.accountId||message.bookingId!==attempt.bookingId||message.meta?.attachmentId!==attempt._id)throw Error("The attachment conversation needs review.");
  const metadata=await ctx.db.system.get(attempt.storageId),hash=attempt.sha256&&/^[a-f0-9]{64}$/.test(attempt.sha256)?btoa(String.fromCharCode(...attempt.sha256.match(/../g)!.map(byte=>parseInt(byte,16)))):null;
  if(metadata&&(!hash||metadata.contentType!==attempt.marker||metadata.size!==attempt.size||(metadata.sha256!==attempt.sha256&&metadata.sha256!==hash)))throw Error("The stored attachment needs review before removal.");
  await deletePrivateFile(ctx,attempt.storageId);
  await ctx.db.patch(message._id,{text:"Attachment removed",meta:{kind:"attachment_removed"}});
  await ctx.db.patch(attempt._id,{status:"removed",removedAt:Date.now(),storageId:undefined,sha256:undefined,contentType:undefined,size:undefined,name:undefined,engine:undefined,signatureVersion:undefined,signatureUpdatedAt:undefined});
  await ctx.db.insert("chat_attachment_actions",{attachmentId:attempt._id,accountId:attempt.accountId,...(attempt.bookingId?{bookingId:attempt.bookingId}:{}),action:"removed",reason,at:Date.now()});
}});

export const sweep = internalMutation({ args: {}, handler: async ctx => {
  const state = await ctx.db.query("chat_attachment_sweep").withIndex("by_key", q => q.eq("key", "uploads")).first();
  if (!state) return;
  const cutoff = state.cutoff ?? Date.now() - 30 * 60_000;
  if (cutoff <= state.watermark) return;
  const page = await ctx.db.system.query("_storage").withIndex("by_creation_time", q => q.gte("_creationTime", state.watermark).lt("_creationTime", cutoff)).paginate({ cursor: state.cursor ?? null, numItems: 100 });
  for (const file of page.page) {
    if (!file.contentType || !markerPattern.test(file.contentType)) continue;
    const attempt = await ctx.db.query("chat_attachment_attempts").withIndex("by_marker", q => q.eq("marker", file.contentType!)).first();
    if (!attempt || attempt.status !== "published" || attempt.storageId !== file._id) {
      await ctx.storage.delete(file._id);
      if (attempt && !["published","removed"].includes(attempt.status)) await ctx.db.patch(attempt._id, { status: "failed" });
    }
  }
  await ctx.db.patch(state._id, page.isDone ? { watermark: cutoff, cutoff: undefined, cursor: undefined } : { cutoff, cursor: page.continueCursor });
  const expiredBefore = Math.min(state.watermark - 5 * 60_000, Date.now() - 48 * 60 * 60_000);
  for (const status of ["pending", "scanned", "failed"] as const) {
    const expired = await ctx.db.query("chat_attachment_attempts").withIndex("by_status_created", q => q.eq("status", status).lt("createdAt", expiredBefore)).take(50);
    for (const attempt of expired) await ctx.db.delete(attempt._id);
  }
} });
