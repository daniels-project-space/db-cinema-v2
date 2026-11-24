import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { linkVerificationCopies } from "./lib/verificationOwnership";
import { queueOwnerNotification } from "./lib/adminPush";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { adminSessionMigrationReady, assertCustomerReadSession, assertCustomerWriteSession } from "./adminAccountSessionV2";

export const reviewStatus = query({
  args:{token:v.string(),accountId:v.id("accounts")},
  handler:async(ctx,{token,accountId})=>{
    if (process.env.ADMIN_SESSION_CUSTOMER_READ_V2 === "enabled") {
      if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
      await assertCustomerReadSession(ctx,token);
    } else if (!checkAdminToken(token)) throw Error("unauthorized");
    const job=await ctx.db.query("guest_rental_claim_jobs").withIndex("by_account",q=>q.eq("accountId",accountId)).unique();
    return job?.state === "review" ? {needsReview:true} : null;
  },
});

export const retryReview = mutation({
  args:{token:v.string(),accountId:v.id("accounts")},
  handler:async(ctx,{token,accountId})=>{
    if (process.env.ADMIN_SESSION_CUSTOMER_WRITE_V2 === "enabled") {
      if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
      await assertCustomerWriteSession(ctx,token);
      await ctx.db.insert("admin_audit_log",{at:Date.now(),success:true,limited:false,fn:"guestRentalClaims.retryReview"});
    } else await assertAdmin(ctx,token,"guestRentalClaims.retryReview");
    const job=await ctx.db.query("guest_rental_claim_jobs").withIndex("by_account",q=>q.eq("accountId",accountId)).unique();
    const account=await ctx.db.get(accountId);
    if (!job || job.state !== "review" || !account || account.blockedAt != null || !account.emailVerifiedAt || account.emailVerificationRequired) throw Error("This account cannot be retried.");
    const now=Date.now();
    await ctx.db.patch(job._id,{expectedEmail:account.email,state:"pending",cursor:null,attempts:0,generation:job.generation+1,nextAttemptAt:now,conflicts:0,updatedAt:now});
    await ctx.scheduler.runAfter(0,(internal as any).guestRentalClaims.dispatchDue,{});
  },
});

export const dispatchDue = internalMutation({
  args: {},
  handler: async ctx => {
    const now = Date.now();
    const jobs = await ctx.db.query("guest_rental_claim_jobs").withIndex("by_state_due", q => q.eq("state","pending").lte("nextAttemptAt",now)).take(20);
    for (const job of jobs) {
      if (job.attempts >= 5) {
        await ctx.db.patch(job._id, {state:"review",updatedAt:now});
        await queueOwnerNotification(ctx,{eventKey:`guest-claim:${job._id}:${job.generation}`,kind:"verification_failure",accountId:job.accountId,title:"Rental account link needs review",body:"Automatic linking could not finish. Check the renter’s account and rental history."});
        continue;
      }
      const generation = job.generation + 1;
      await ctx.db.patch(job._id,{generation,attempts:job.attempts+1,nextAttemptAt:now+5*60_000,updatedAt:now});
      await ctx.scheduler.runAfter(0,(internal as any).guestRentalClaims.claimVerifiedPage,{jobId:job._id,generation});
    }
  },
});

export const claimVerifiedPage = internalMutation({
  args: { jobId:v.id("guest_rental_claim_jobs"), generation:v.number() },
  handler: async (ctx, {jobId,generation}) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "pending" || job.generation !== generation) return;
    const accountId = job.accountId;
    const account = await ctx.db.get(accountId);
    if (!account || account.blockedAt != null || !account.emailVerifiedAt || account.emailVerificationRequired) {await ctx.db.patch(jobId,{state:"done",updatedAt:Date.now()});return;}
    const email = account.email.trim().toLowerCase();
    if (!email || email !== account.email || email !== job.expectedEmail) {
      await ctx.db.patch(jobId,{state:"review",updatedAt:Date.now()});
      await queueOwnerNotification(ctx,{eventKey:`guest-claim-email:${jobId}:${generation}`,kind:"verification_failure",accountId,title:"Rental account link needs review",body:"The account email changed or is not normalized. No further rentals were linked."});
      return;
    }
    const unique = await ctx.db.query("accounts").withIndex("by_email", q => q.eq("email", email)).take(2);
    if (unique.length !== 1 || unique[0]._id !== accountId) {
      await ctx.db.patch(jobId,{state:"review",updatedAt:Date.now()});
      await queueOwnerNotification(ctx,{eventKey:`guest-claim-identity:${jobId}:${generation}`,kind:"verification_failure",accountId,title:"Rental account link needs review",body:"The account email does not identify one unique account. No rentals were linked."});
      return;
    }
    const page = await ctx.db.query("bookings").withIndex("by_account_guestEmail", q => q.eq("accountId", undefined).eq("guestEmail", email)).paginate({cursor:job.cursor,numItems:10});
    let conflicts = job.conflicts;
    let linked = 0;
    for (const booking of page.page) {
      if (booking.accountId || booking.guestEmail !== email) continue;
      if (!["confirmed", "active", "returned", "cancelled", "pending_verification"].includes(booking.status)) continue;
      if (["pending_verification", "cancelled"].includes(booking.status) && !(Number.isSafeInteger(booking.checkoutPaidAt) && booking.checkoutPaidAt! > 0)) continue;
      const threads = await ctx.db.query("chat_threads").withIndex("by_booking_updated", q => q.eq("bookingId",booking._id)).take(21);
      if (threads.length > 20 || threads.some(thread => thread.accountId !== accountId)) {conflicts++;continue;}
      const archives = await ctx.db.query("verification_archives").withIndex("by_booking", q => q.eq("bookingId",booking._id)).take(6);
      if (archives.length > 5 || archives.some(archive => archive.accountId && archive.accountId !== accountId)) {conflicts++;continue;}
      let unsafe = false;
      for (const archive of archives) {
        const documents = await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId",archive._id)).take(21);
        if (documents.length > 20 || documents.some(document => document.bookingId !== booking._id || document.sessionId !== archive.sessionId || (document.accountId && document.accountId !== accountId))) { unsafe = true; break; }
      }
      if (unsafe) {conflicts++;continue;}
      await linkVerificationCopies(ctx, booking._id, accountId);
      await ctx.db.patch(booking._id, {accountId});
      linked++;
    }
    const now = Date.now();
    await ctx.db.patch(jobId,{state:page.isDone?(conflicts?"review":"done"):"pending",cursor:page.isDone?null:page.continueCursor,conflicts,attempts:0,nextAttemptAt:now,updatedAt:now});
    if (linked) {
      await ctx.scheduler.runAfter(0,internal.verificationArchive.linkVerifiedAccount,{accountId,cursor:null});
      await ctx.scheduler.runAfter(0,internal.emailInbox.linkVerifiedHistory,{accountId,cursor:null});
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0,(internal as any).guestRentalClaims.dispatchDue,{});
    else if (conflicts) await queueOwnerNotification(ctx,{eventKey:`guest-claim-conflict:${jobId}:${generation}`,kind:"verification_failure",accountId,title:"Rental account link needs review",body:"Some rentals have conflicting ownership records and were not linked."});
  },
});
