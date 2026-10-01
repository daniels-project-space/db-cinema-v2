"use node";
import Stripe from "stripe";
import { action,internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
const stripe=()=>new Stripe(process.env.STRIPE_SECRET_KEY!);
export const start=action({args:{token:v.string(),projectId:v.id("film_fund_projects"),roundSlug:v.string(),termsVersion:v.string()},handler:async(ctx,a):Promise<{included:boolean;url?:string;paid?:boolean}>=>{
 const reservation:any=await ctx.runMutation(internal.filmFundEntries.reserve,a);if(reservation.included)return {included:true};
 const e=reservation.entry;
 if(e.sessionId){const session=await stripe().checkout.sessions.retrieve(e.sessionId);if(session.status==="complete")return ctx.runAction(internal.filmFundPayments.fulfill,{sessionId:session.id});if(session.status==="open"&&session.url)return {included:false,url:session.url};await ctx.runMutation(internal.filmFundEntries.terminal,{id:e._id,refunded:false});throw Error("Entry checkout expired. Try again to open a new checkout.");}
 if(!e.sessionParams&&e.expiresAt-Date.now()<30*60000){await ctx.runMutation(internal.filmFundEntries.terminal,{id:e._id,refunded:false});throw Error("This checkout reservation expired. Try again to open a fresh payment.");}
 const app=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
 let params:Stripe.Checkout.SessionCreateParams=e.sessionParams?JSON.parse(e.sessionParams):{mode:"payment",customer_email:reservation.email,adaptive_pricing:{enabled:false},payment_method_types:["card"],line_items:[{price_data:{currency:"gbp",unit_amount:1500,product_data:{name:"DB Cinema Film Fund · single project application"}},quantity:1}],expires_at:Math.floor(e.expiresAt/1000),metadata:{filmFundEntryId:e._id,filmFundProjectId:e.projectId,roundSlug:e.roundSlug,termsVersion:e.termsVersion},payment_intent_data:{metadata:{filmFundEntryId:e._id}},success_url:`${app}/film-fund?entry_session={CHECKOUT_SESSION_ID}#application`,cancel_url:`${app}/film-fund#application`};
 if(!e.sessionParams)await ctx.runMutation(internal.filmFundEntries.saveParams,{id:e._id,sessionParams:JSON.stringify(params)});
 const session=await stripe().checkout.sessions.create(params,{idempotencyKey:`dbc-film-fund-entry-${e._id}`});await ctx.runMutation(internal.filmFundEntries.bind,{id:e._id,sessionId:session.id});await ctx.scheduler.runAfter(Math.max(0,reservation.deadline-Date.now()),internal.filmFundPayments.expireAtDeadline,{id:e._id});if(!session.url)throw Error("Entry checkout URL is unavailable.");return {included:false,url:session.url};
}});
export const finalize=action({args:{sessionId:v.string()},handler:async(ctx,a):Promise<{included:false;paid:boolean}>=>ctx.runAction(internal.filmFundPayments.fulfill,a)});
export const fulfill=internalAction({args:{sessionId:v.string()},handler:async(ctx,a):Promise<{included:false;paid:boolean}>=>{
 const s=await stripe().checkout.sessions.retrieve(a.sessionId);if(!s.metadata?.filmFundEntryId)throw Error("Not a Film Fund payment.");if(s.status!=="complete"||s.payment_status!=="paid")return {included:false,paid:false};
 const entry:any=await ctx.runQuery(internal.filmFundEntries.byExternalId,{id:s.metadata.filmFundEntryId});if(!entry||entry.sessionId!==s.id)return {included:false,paid:false};
 const pi=typeof s.payment_intent==="string"?s.payment_intent:s.payment_intent?.id;if(!pi)throw Error("Entry payment receipt missing.");
 const payment=await stripe().paymentIntents.retrieve(pi);const charge=typeof payment.latest_charge==="string"?await stripe().charges.retrieve(payment.latest_charge):payment.latest_charge;
 if(charge?.refunded){await ctx.runMutation(internal.filmFundEntries.terminal,{id:s.metadata.filmFundEntryId as any,refunded:true});return {included:false,paid:false};}
 const result:any=await ctx.runMutation(internal.filmFundEntries.paid,{id:s.metadata.filmFundEntryId as any,sessionId:s.id,paymentIntentId:pi,amount:s.amount_total??0,currency:s.currency??"",paidAt:(charge?.created??payment.created)*1000});
 if(result.refund){await stripe().refunds.create({payment_intent:pi,metadata:{filmFundEntryId:s.metadata.filmFundEntryId}},{idempotencyKey:`dbc-fund-closed-${s.id}`});await ctx.runMutation(internal.filmFundEntries.terminal,{id:s.metadata.filmFundEntryId as any,refunded:true});}
 return {included:false,paid:result.paid};
}});

/** Shared Stripe accounts can deliver another deployment's events. Only update
 * a locally bound entry after Stripe confirms its entire charge is refunded. */
export const reconcileRefund=internalAction({args:{refundId:v.string()},handler:async(ctx,a):Promise<void>=>{
 const sb=stripe(),refund=await sb.refunds.retrieve(a.refundId);
 if(refund.status!=="succeeded")return;
 const pi=typeof refund.payment_intent==="string"?refund.payment_intent:refund.payment_intent?.id;if(!pi)return;
 const payment=await sb.paymentIntents.retrieve(pi),id=payment.metadata?.filmFundEntryId;if(!id)return;
 const entry:any=await ctx.runQuery(internal.filmFundEntries.byExternalId,{id});if(!entry||entry.paymentIntentId!==pi)return;
 const charge=typeof payment.latest_charge==="string"?await sb.charges.retrieve(payment.latest_charge):payment.latest_charge;
 if(charge?.refunded&&charge.amount_refunded===charge.amount)await ctx.runMutation(internal.filmFundEntries.terminal,{id:entry._id,refunded:true});
}});

export const expireAtDeadline=internalAction({args:{id:v.id("film_fund_entries")},handler:async(ctx,a):Promise<void>=>{
 const entry:any=await ctx.runQuery(internal.filmFundEntries.byId,a);if(!entry?.sessionId||["paid","refunded","expired"].includes(entry.state))return;
 const session=await stripe().checkout.sessions.retrieve(entry.sessionId);
 if(session.status==="complete"){await ctx.runAction(internal.filmFundPayments.fulfill,{sessionId:session.id});return;}
 if(session.status==="open"){
  try{await stripe().checkout.sessions.expire(session.id);}catch{
   const latest=await stripe().checkout.sessions.retrieve(session.id);if(latest.status==="complete"){await ctx.runAction(internal.filmFundPayments.fulfill,{sessionId:session.id});return;}if(latest.status!=="expired")throw Error("Could not expire Film Fund checkout at its deadline.");
  }
 }
 await ctx.runMutation(internal.filmFundEntries.terminal,{id:entry._id,refunded:false});
}});
