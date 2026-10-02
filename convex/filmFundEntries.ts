import { internalMutation,internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { accountForToken } from "./lib/rentalChat";
import { rounds } from "./filmFund";
import { FILM_FUND_TERMS_VERSION,fundSubmissionErrors,fundEntryPence } from "../shared/filmFund";
import { isProPlus,membershipActiveNow,membershipTierFor } from "../shared/membership";
export const reserve=internalMutation({args:{token:v.string(),projectId:v.id("film_fund_projects"),roundSlug:v.string(),termsVersion:v.string()},handler:async(ctx,a)=>{
 const account=await accountForToken(ctx,a.token),p=await ctx.db.get(a.projectId);
 if(!account||!p||p.accountId!==account._id||p.state!=="draft")throw Error("Application is not available.");
 const round=(await rounds(ctx)).find((r:any)=>r.slug===a.roundSlug);
 if(!round||round.state!=="open"||Date.now()<round.opensAt||Date.now()>round.deadline)throw Error("Film Fund entry payments are closed.");
 if(a.termsVersion!==FILM_FUND_TERMS_VERSION)throw Error("Accept the current Film Fund terms.");
 const errors=fundSubmissionErrors(p);if(errors.length)throw Error(errors.join(" "));
 for(const id of [p.scriptId,p.moodboardId,p.videoId,...p.documentIds]){const f=await ctx.db.get(id!);if(!f||f.projectId!==p._id||f.accountId!==account._id||f.kind==="video"&&(!f.durationSeconds||f.durationSeconds<55||f.durationSeconds>65))throw Error("Complete and verify all application files before paying.");}
 if(isProPlus(membershipTierFor(account),membershipActiveNow(account)))return {included:true as const};
 const entries=await ctx.db.query("film_fund_entries").withIndex("by_project",q=>q.eq("projectId",p._id)).collect();
 if(p.entryPaid||entries.some(e=>e.state==="paid"))throw Error("This project has already purchased its single entry. Multiple tickets are not allowed.");
 const existing=entries.find(e=>["creating","open"].includes(e.state));
 if(existing){if(existing.roundSlug!==a.roundSlug)throw Error("Finish or expire the existing entry checkout first.");return {included:false as const,entry:existing,email:account.email,deadline:round.deadline};}
 // Stripe requires a checkout lifetime of at least 30 minutes. Accept starts
 // until the actual deadline; the provider session is separately expired then.
 const id=await ctx.db.insert("film_fund_entries",{projectId:p._id,accountId:account._id,roundSlug:a.roundSlug,termsVersion:a.termsVersion,consentAt:Date.now(),amountPence:fundEntryPence(account),createdAt:Date.now(),expiresAt:Date.now()+31*60000,state:"creating"});
 return {included:false as const,entry:(await ctx.db.get(id))!,email:account.email,deadline:round.deadline};
}});
export const saveParams=internalMutation({args:{id:v.id("film_fund_entries"),sessionParams:v.string()},handler:async(ctx,a)=>{
 const e=await ctx.db.get(a.id);if(!e||e.state!=="creating")throw Error("Entry checkout is unavailable.");
 if(e.sessionParams&&e.sessionParams!==a.sessionParams)throw Error("Entry checkout already prepared.");await ctx.db.patch(e._id,{sessionParams:a.sessionParams});
}});
export const bind=internalMutation({args:{id:v.id("film_fund_entries"),sessionId:v.string()},handler:async(ctx,a)=>{const e=await ctx.db.get(a.id);if(!e||e.sessionId&&e.sessionId!==a.sessionId)throw Error("Entry checkout mismatch.");await ctx.db.patch(e._id,{sessionId:a.sessionId,state:e.state==="creating"?"open":e.state});}});
export const byId=internalQuery({args:{id:v.id("film_fund_entries")},handler:async(ctx,a)=>ctx.db.get(a.id)});
export const byExternalId=internalQuery({args:{id:v.string()},handler:async(ctx,a)=>{const id=ctx.db.normalizeId("film_fund_entries",a.id);return id?ctx.db.get(id):null;}});
export const paid=internalMutation({args:{id:v.id("film_fund_entries"),sessionId:v.string(),paymentIntentId:v.string(),amount:v.number(),currency:v.string(),paidAt:v.number()},handler:async(ctx,a)=>{
 const e=await ctx.db.get(a.id);if(!e||e.sessionId!==a.sessionId||a.amount!==(e.amountPence??1500)||a.currency!=="gbp")throw Error("Film Fund payment does not match its entry.");
 if(e.state==="paid"||e.state==="refunded")return {paid:e.state==="paid",refund:false};
 const round=(await rounds(ctx)).find((r:any)=>r.slug===e.roundSlug),p=await ctx.db.get(e.projectId);
 if(!p||p.accountId!==e.accountId)throw Error("Entry project ownership mismatch.");
 const windowAccepted=round&&(round.state==="open"||round.state==="closed"&&round.closedAt!==undefined&&a.paidAt<=round.closedAt)&&a.paidAt<=round.deadline&&a.paidAt>=round.opensAt;
 if(!windowAccepted||p.state!=="draft"||fundSubmissionErrors(p).length)return {paid:false,refund:true};
 for(const id of [p.scriptId,p.moodboardId,p.videoId,...p.documentIds]){const file=await ctx.db.get(id!);if(!file||file.projectId!==p._id||file.accountId!==p.accountId||file.kind==="video"&&(!file.durationSeconds||file.durationSeconds<55||file.durationSeconds>65))return {paid:false,refund:true};}
 await ctx.db.patch(e._id,{state:"paid",paymentIntentId:a.paymentIntentId});
 await ctx.db.patch(p._id,{entryPaid:true,entrySessionId:a.sessionId,entryPaymentIntentId:a.paymentIntentId,entryRoundSlug:e.roundSlug,entryIncluded:false,state:"submitted",roundSlug:e.roundSlug,submittedAt:a.paidAt,termsVersion:e.termsVersion,reviewStatus:"new",updatedAt:Date.now()});return {paid:true,refund:false};
}});
export const terminal=internalMutation({args:{id:v.id("film_fund_entries"),refunded:v.boolean()},handler:async(ctx,a)=>{const e=await ctx.db.get(a.id);if(!e||e.state==="paid"&&!a.refunded)return;await ctx.db.patch(e._id,{state:a.refunded?"refunded":"expired"});if(a.refunded){const p=await ctx.db.get(e.projectId);if(p&&p.entrySessionId===e.sessionId)await ctx.db.patch(p._id,{entryPaid:false,entryRefundedAt:Date.now(),...(!p.entryIncluded&&p.state==="submitted"?{reviewStatus:"not_selected"}:{}),updatedAt:Date.now()});}}});
