import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { encoreAccountOwnsRental, loyaltyProgress, unlockLoyalty } from "./lib/loyalty";
import { validEncoreEvidence } from "./lib/encoreRollup";
import { queueRentalEmail } from "./lib/rentalEmailQueue";

export async function queueEncoreNotice(ctx:any,bookingId:any,accountId:any,beforeLevel:number){
 const existing=await ctx.db.query("encore_notice_events").withIndex("by_booking",(query:any)=>query.eq("bookingId",bookingId)).unique();
 if(existing){
  if(existing.state==="pending"&&existing.accountId!==accountId)await ctx.db.patch(existing._id,{accountId,beforeLevel,updatedAt:Date.now()});
  if(existing.state==="queued"&&existing.accountId===accountId){const previous=await ctx.db.query("rental_email_deliveries").withIndex("by_booking_kind",(query:any)=>query.eq("bookingId",bookingId).eq("kind","encore")).order("desc").first();if(previous?.state==="skipped"&&previous.attempts===0&&previous.encoreAccountId===accountId)await queueRentalEmail(ctx,bookingId,"encore",{encoreLevel:previous.encoreLevel,encoreAccountId:accountId});}
  return;
 }
 const now=Date.now();await ctx.db.insert("encore_notice_events",{bookingId,accountId,beforeLevel,state:"pending",createdAt:now,updatedAt:now});
}
export const dispatch=internalMutation({args:{accountId:v.id("accounts")},handler:async(ctx,{accountId})=>{
 if(process.env.ENCORE_EVIDENCE_READ_ENABLED!=="true")return;
 const account=await ctx.db.get(accountId),rollup=await ctx.db.query("encore_account_rollups").withIndex("by_account",query=>query.eq("accountId",accountId)).unique();
 if(!account||!rollup||rollup.state!=="ready")return;
 const progress=await loyaltyProgress(ctx,account),events=await ctx.db.query("encore_notice_events").withIndex("by_account_state",query=>query.eq("accountId",accountId).eq("state","pending")).order("asc").take(25);
 let lastLevel=account.loyaltyNoticeLevel??0;
 for(const event of events){
  const booking=await ctx.db.get(event.bookingId),evidence=await ctx.db.query("encore_eligibility_evidence").withIndex("by_booking",query=>query.eq("bookingId",event.bookingId)).unique();
  if(!encoreAccountOwnsRental(booking,account)||!await validEncoreEvidence(ctx,account,evidence)){await ctx.db.patch(event._id,{state:"skipped",updatedAt:Date.now()});continue;}
  const base=Math.max(lastLevel,event.beforeLevel);
  if(progress.level<=base){await ctx.db.patch(event._id,{state:"skipped",updatedAt:Date.now()});continue;}
  const level=Math.min(progress.level,base+1);
  await queueRentalEmail(ctx,event.bookingId,"encore",{encoreLevel:level,encoreAccountId:account._id});
  lastLevel=level;await ctx.db.patch(event._id,{state:"queued",updatedAt:Date.now()});
 }
  if(lastLevel!==(account.loyaltyNoticeLevel??0))await ctx.db.patch(account._id,{loyaltyNoticeLevel:lastLevel});
  if(progress.eligible)await unlockLoyalty(ctx,account);
}});
