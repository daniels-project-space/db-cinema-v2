import { internal } from "../_generated/api";

export async function enqueueVerifiedGuestClaims(ctx: any, accountId: any) {
  const job = await ctx.db.query("guest_rental_claim_jobs").withIndex("by_account", (query:any) => query.eq("accountId",accountId)).unique();
  const account = await ctx.db.get(accountId);
  if (!account) return;
  const now = Date.now();
  if (job?.state === "pending" || job?.state === "review") return;
  if (job) await ctx.db.patch(job._id, {expectedEmail:account.email,state:"pending",cursor:null,attempts:0,generation:job.generation+1,nextAttemptAt:now,conflicts:0,updatedAt:now});
  else await ctx.db.insert("guest_rental_claim_jobs", {accountId,expectedEmail:account.email,state:"pending",cursor:null,attempts:0,generation:0,nextAttemptAt:now,conflicts:0,updatedAt:now});
  await ctx.scheduler.runAfter(0,(internal as any).guestRentalClaims.dispatchDue,{});
}
