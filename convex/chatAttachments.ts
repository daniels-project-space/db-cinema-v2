import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { internal } from "./_generated/api";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { accountForRental } from "./lib/rentalAccount";
import { chatAttachmentScannerHealthy, chatAttachmentsReady } from "./lib/chatAttachmentScanner";
import { deletePrivateFile } from "./lib/privateStorage";
import { bookingHasCaseArchive } from "./lib/chatCaseArchive";
import { bump } from "./rateLimit";
import { chatAttachmentName } from "./lib/chatAttachmentName";
import { adminSessionMigrationReady, assertAdminScopeSession } from "./adminAccountSessionV2";
import { isChatImageType, CHAT_IMAGE_LIMIT } from "../shared/chatAttachmentPolicy";

const CHAT_FILE_RETENTION_MS = 90 * 24 * 60 * 60_000;
const SUPPORT_IDLE_CLOSE_MS = 90 * 24 * 60 * 60_000;
const CHAT_AUDIT_RETENTION_MS = 90 * 24 * 60 * 60_000;

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

export const availabilityAccess = internalQuery({args:scope,handler:async(ctx,args)=>{
  if(args.admin&&!await attachmentAdminRead(ctx,args.token))throw Error("Unauthorized.");
  await resolveScope(ctx,args);
  return true;
}});

export const availability = action({args:scope,handler:async(ctx,args)=>{
  await ctx.runQuery(internal.chatAttachments.availabilityAccess,args);
  if(!chatAttachmentsReady())return false;
  return chatAttachmentScannerHealthy();
}});

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

async function attachmentRetentionWindow(ctx:any,attempt:any) {
  let closedAt:number|undefined;
  if(attempt.bookingId){
    if(await bookingHasCaseArchive(ctx,attempt.bookingId))return {closedAt:null,expiresAt:null,needsReview:false,caseArchived:true};
    const booking=await ctx.db.get(attempt.bookingId);
    if(!booking)return {closedAt:null,expiresAt:null,needsReview:true,caseArchived:false};
    if(booking.status==="returned")closedAt=booking.returnedAt;
    else if(booking.status==="cancelled")closedAt=booking.cancelledAt;
    else if(booking.status!=="returned"&&booking.status!=="cancelled")return {closedAt:null,expiresAt:null,needsReview:false,caseArchived:false};
  }else{
    const thread=await ctx.db.query("chat_threads").withIndex("by_account_booking",(q:any)=>q.eq("accountId",attempt.accountId).eq("bookingId",undefined)).unique();
    if(!thread)return {closedAt:null,expiresAt:null,needsReview:true,caseArchived:false};
    if(thread.closedAt===undefined)return {closedAt:null,expiresAt:null,needsReview:false,caseArchived:false};
    closedAt=thread.closedAt;
  }
  if(closedAt===undefined)return {closedAt:null,expiresAt:null,needsReview:true,caseArchived:false};
  if(!Number.isSafeInteger(closedAt)||closedAt<=0||closedAt>Date.now())return {closedAt:null,expiresAt:null,needsReview:true,caseArchived:false};
  return {closedAt,expiresAt:closedAt+CHAT_FILE_RETENTION_MS,needsReview:false,caseArchived:false};
}

async function removePublishedBytes(ctx:any,attempt:any,reason:string,action:"removed"|"retention_removed") {
  const message=await ctx.db.get(attempt.messageId);
  if(!message||message.accountId!==attempt.accountId||message.bookingId!==attempt.bookingId||message.meta?.attachmentId!==attempt._id)return false;
  const actionHistory=await ctx.db.query("chat_attachment_actions").withIndex("by_attachment",(q:any)=>q.eq("attachmentId",attempt._id)).take(101);
  if(actionHistory.length>100)return false;
  const metadata=await ctx.db.system.get(attempt.storageId),hash=attempt.sha256&&/^[a-f0-9]{64}$/.test(attempt.sha256)?btoa(String.fromCharCode(...attempt.sha256.match(/../g)!.map((byte:string)=>parseInt(byte,16)))):null;
  if(metadata&&(!hash||metadata.contentType!==attempt.marker||metadata.size!==attempt.size||(metadata.sha256!==attempt.sha256&&metadata.sha256!==hash)))return false;
  await deletePrivateFile(ctx,attempt.storageId);
  const removedAt=Date.now(),purgeAfter=removedAt+CHAT_AUDIT_RETENTION_MS;
  await ctx.db.patch(message._id,{text:"Attachment removed",meta:{kind:"attachment_removed"}});
  await ctx.db.patch(attempt._id,{status:"removed",removedAt,storageId:undefined,sha256:undefined,contentType:undefined,size:undefined,name:undefined,engine:undefined,signatureVersion:undefined,signatureUpdatedAt:undefined,retentionNeedsReview:undefined});
  for(const row of actionHistory)await ctx.db.patch(row._id,{purgeAfter});
  await ctx.db.insert("chat_attachment_actions",{attachmentId:attempt._id,accountId:attempt.accountId,...(attempt.bookingId?{bookingId:attempt.bookingId}:{}),action,reason,at:removedAt,purgeAfter});
  return true;
}

export const retention=query({args:{token:v.string(),id:v.id("chat_attachment_attempts")},handler:async(ctx,args)=>{
  if(!await attachmentAdminRead(ctx,args.token))return null;
  const attempt=await ctx.db.get(args.id);if(!attempt||attempt.status!=="published")return null;
  try{const window=await attachmentRetentionWindow(ctx,attempt);return {holdReason:attempt.retentionHoldReason??null,holdRevision:attempt.retentionHoldRevision??0,openCases:await openCases(ctx,attempt),closedAt:window.closedAt,expiresAt:window.expiresAt,expired:window.expiresAt!==null&&window.expiresAt<=Date.now(),needsReview:attempt.retentionNeedsReview===true||window.needsReview,caseArchived:window.caseArchived};}
  catch{return {holdReason:attempt.retentionHoldReason??null,holdRevision:attempt.retentionHoldRevision??0,openCases:0,needsReview:true};}
}});

export const setRetentionHold=mutation({args:{token:v.string(),id:v.id("chat_attachment_attempts"),hold:v.boolean(),reason:v.string(),confirmed:v.boolean(),expectedRevision:v.number()},handler:async(ctx,args)=>{
  await attachmentAdminMutation(ctx,args.token,"customers:write","chatAttachments.setRetentionHold");
  const reason=args.reason.trim();if(!args.confirmed||reason.length<10||reason.length>500)throw Error("Confirm and record a reason of 10–500 characters.");
  const attempt=await ctx.db.get(args.id);if(!attempt||attempt.status!=="published")throw Error("Attachment unavailable.");
  if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<0||args.expectedRevision>=Number.MAX_SAFE_INTEGER||args.expectedRevision!==(attempt.retentionHoldRevision??0))throw Error("The retention hold changed. Review it and confirm again.");
  if(args.hold&&attempt.retentionHoldReason===reason||!args.hold&&!attempt.retentionHoldReason)return;
  await ctx.db.patch(attempt._id,{retentionHoldReason:args.hold?reason:undefined,retentionHoldRevision:args.expectedRevision+1});
  await ctx.db.insert("chat_attachment_actions",{attachmentId:attempt._id,accountId:attempt.accountId,...(attempt.bookingId?{bookingId:attempt.bookingId}:{}),action:args.hold?"hold_added":"hold_removed",reason,at:Date.now()});
}});

export const removePublished=mutation({args:{token:v.string(),id:v.id("chat_attachment_attempts"),reason:v.string(),confirmed:v.boolean(),expectedRevision:v.number()},handler:async(ctx,args)=>{
  await attachmentAdminMutation(ctx,args.token,"customers:write","chatAttachments.removePublished");
  const reason=args.reason.trim();if(!args.confirmed||reason.length<10||reason.length>500)throw Error("Confirm and record a reason of 10–500 characters.");
  const attempt=await ctx.db.get(args.id);if(!attempt)throw Error("Attachment unavailable.");if(attempt.status==="removed")return;
  if(attempt.status!=="published"||!attempt.storageId||!attempt.messageId)throw Error("Attachment unavailable.");
  if(attempt.retentionNeedsReview)throw Error("The file needs a retention review before removal.");
  if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision!==(attempt.retentionHoldRevision??0))throw Error("The retention hold changed. Review it and confirm again.");
  if(attempt.bookingId&&await bookingHasCaseArchive(ctx,attempt.bookingId))throw Error("This rental conversation is preserved in the permanent case archive.");
  if(attempt.retentionHoldReason||await openCases(ctx,attempt))throw Error("This attachment is protected by an open case or retention hold.");
  if(!await removePublishedBytes(ctx,attempt,reason,"removed"))throw Error("The file needs a retention review before removal.");
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

export const closeInactiveSupportThreads=internalMutation({args:{},handler:async ctx=>{
  const now=Date.now(),inactiveBefore=now-SUPPORT_IDLE_CLOSE_MS;
  const rows=await ctx.db.query("chat_threads").withIndex("by_support_open_updated",(q:any)=>q.eq("bookingId",undefined).eq("closedAt",undefined).lt("updatedAt",inactiveBefore)).take(50);
  let closed=0;
  for(const row of rows){
    const current=await ctx.db.get(row._id);
    if(!current||current.bookingId!==undefined||current.closedAt!==undefined||current.updatedAt>inactiveBefore)continue;
    await ctx.db.patch(current._id,{closedAt:now});closed++;
  }
  if(rows.length===50)await ctx.scheduler.runAfter(0,internal.chatAttachments.closeInactiveSupportThreads,{});
  return {closed,continued:rows.length===50};
}});

export const purgeExpired=internalMutation({args:{},handler:async ctx=>{
  let state=await ctx.db.query("chat_attachment_retention_sweep").withIndex("by_key",(q:any)=>q.eq("key","published")).first();
  if(!state){const id=await ctx.db.insert("chat_attachment_retention_sweep",{key:"published",updatedAt:Date.now()});state=await ctx.db.get(id);}
  if(!state)return {scanned:0,removed:0};
  const now=Date.now();
  const page=await ctx.db.query("chat_attachment_attempts").withIndex("by_status_created",(q:any)=>q.eq("status","published")).paginate({cursor:state.cursor??null,numItems:10});
  let removed=0;
  for(const attempt of page.page){
    if(attempt.retentionHoldReason||attempt.retentionNeedsReview||!attempt.storageId||!attempt.messageId)continue;
    let window:{closedAt:number|null;expiresAt:number|null;needsReview:boolean;caseArchived?:boolean};
    try{window=await attachmentRetentionWindow(ctx,attempt);}catch{window={closedAt:null,expiresAt:null,needsReview:true,caseArchived:false};}
    if(window.needsReview){await ctx.db.patch(attempt._id,{retentionNeedsReview:true});continue;}
    if(window.caseArchived)continue;
    if(window.expiresAt===null||window.expiresAt>now)continue;
    let open=0;
    try{open=await openCases(ctx,attempt);}catch{await ctx.db.patch(attempt._id,{retentionNeedsReview:true});continue;}
    if(open>0)continue;
    if(await removePublishedBytes(ctx,attempt,"Automatic 90-day retention expiry","retention_removed"))removed++;
    else await ctx.db.patch(attempt._id,{retentionNeedsReview:true});
  }
  await ctx.db.patch(state._id,{cursor:page.isDone?undefined:page.continueCursor,updatedAt:now});
  if(!page.isDone)await ctx.scheduler.runAfter(0,internal.chatAttachments.purgeExpired,{});
  return {scanned:page.page.length,removed,continued:!page.isDone};
}});

export const purgeExpiredActionAudits=internalMutation({args:{},handler:async ctx=>{
  const now=Date.now();
  let migration=await ctx.db.query("chat_attachment_retention_sweep").withIndex("by_key",(q:any)=>q.eq("key","action-audit-backfill")).first();
  if(!migration){const id=await ctx.db.insert("chat_attachment_retention_sweep",{key:"action-audit-backfill",updatedAt:now});migration=await ctx.db.get(id);}
  let migrated=0,backfillDone=migration?.completedAt!==undefined;
  if(migration&&!backfillDone){
    const page=await ctx.db.query("chat_attachment_actions").withIndex("by_at",(q:any)=>q.gte("at",0)).paginate({cursor:migration.cursor??null,numItems:100});
    for(const row of page.page){
      if(row.purgeAfter!==undefined)continue;
      const attempt=await ctx.db.get(row.attachmentId);
      const removedAt=attempt?.removedAt;
      if(!attempt||attempt.status!=="removed"||typeof removedAt!=="number"||!Number.isSafeInteger(removedAt))continue;
      if(attempt.bookingId&&await bookingHasCaseArchive(ctx,attempt.bookingId))continue;
      await ctx.db.patch(row._id,{purgeAfter:removedAt+CHAT_AUDIT_RETENTION_MS});migrated++;
    }
    backfillDone=page.isDone;
    await ctx.db.patch(migration._id,page.isDone?{cursor:undefined,completedAt:now,updatedAt:now}:{cursor:page.continueCursor,updatedAt:now});
    if(!page.isDone)await ctx.scheduler.runAfter(0,internal.chatAttachments.purgeExpiredActionAudits,{});
  }
  let state=await ctx.db.query("chat_attachment_retention_sweep").withIndex("by_key",(q:any)=>q.eq("key","action-audit-purge")).first();
  if(!state){const id=await ctx.db.insert("chat_attachment_retention_sweep",{key:"action-audit-purge",updatedAt:now});state=await ctx.db.get(id);}
  const page=await ctx.db.query("chat_attachment_actions").withIndex("by_purge_after",(q:any)=>q.lte("purgeAfter",now)).paginate({cursor:state?.cursor??null,numItems:100});
  let deleted=0;
  for(const row of page.page){
    const attempt=await ctx.db.get(row.attachmentId);
    const caseArchived=!!row.bookingId&&await bookingHasCaseArchive(ctx,row.bookingId);
    if(caseArchived){await ctx.db.patch(row._id,{purgeAfter:undefined});continue;}
    if(attempt&&attempt.status!=="removed"){await ctx.db.patch(row._id,{purgeAfter:undefined});continue;}
    const removedAt=attempt?.removedAt;
    if(attempt&&(typeof removedAt!=="number"||!Number.isSafeInteger(removedAt)||removedAt+CHAT_AUDIT_RETENTION_MS>now)){await ctx.db.patch(row._id,{purgeAfter:undefined});continue;}
    const attachmentId=row.attachmentId;
    await ctx.db.delete(row._id);deleted++;
    // The removal audit is the 90-day record of who/which rental, why, and
    // when. Once its final row expires, discard the now-unreferenced upload
    // attempt too; otherwise its account/booking linkage would live forever.
    if(attempt?.status==="removed"&&!(await ctx.db.query("chat_attachment_actions").withIndex("by_attachment",(q:any)=>q.eq("attachmentId",attachmentId)).first()))
      await ctx.db.delete(attempt._id);
  }
  const continued=!page.isDone||!backfillDone;
  await ctx.db.patch(state!._id,{cursor:page.isDone?undefined:page.continueCursor,updatedAt:now});
  if(!page.isDone)await ctx.scheduler.runAfter(0,internal.chatAttachments.purgeExpiredActionAudits,{});
  return {migrated,deleted,continued};
}});
