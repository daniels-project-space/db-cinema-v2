"use node";
import Stripe from "stripe";
import {action,internalAction} from "./_generated/server";
import {internal,api} from "./_generated/api";
import {v} from "convex/values";
import {checkAdminToken} from "./adminAuth";
import {recoverApprovedRefund} from "./lib/approvedRefund";

function stripe(){if(!process.env.STRIPE_SECRET_KEY)throw Error("Stripe is not configured.");return new Stripe(process.env.STRIPE_SECRET_KEY)}
async function ensureSession(ctx:any,r:any){
 if(r.status==="applied")return {applied:true};
 if(r.sessionId)return stripe().checkout.sessions.retrieve(r.sessionId);
 // Never recreate a session after the accepted quote expires or its key may be pruned.
 if(r.expiresAt<=Date.now()){
  let scanned=0;for await(const found of stripe().checkout.sessions.list({created:{gte:Math.floor(r.acceptedAt/1000)-5},limit:100})){if(++scanned>100)throw Error("Payment history needs receipt review; no new payment was created.");if(found.metadata?.priceAdjustmentId===r._id){await ctx.runMutation(internal.rentalPriceState.bindSession,{id:r._id,sessionId:found.id,url:found.url??""});return found;}}
  await ctx.runMutation(internal.rentalPriceState.close,{id:r._id,status:"expired"});throw Error("The price proposal expired. Ask for a fresh proposal.")}
 if(process.env.RENTAL_CHECKOUT_ENABLED!=="true"&&!/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY??""))throw Error("Rental payments are not enabled.");
 const origin=new URL(process.env.APP_URL??"https://dbcinemarentals.com").origin;
 const s=await stripe().checkout.sessions.create({mode:"payment",adaptive_pricing:{enabled:false},customer_email:r.acceptedEmail,expires_at:Math.floor(r.expiresAt/1000),line_items:[{quantity:1,price_data:{currency:"gbp",unit_amount:Math.round(r.delta*100),product_data:{name:"DB Cinema · accepted rental price adjustment",description:`Revised rental payment £${r.newTotal.toFixed(2)}. Deposit and damage/late-fee permission unchanged.`}}}],success_url:`${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${origin}/account?rental=${r.bookingId}#chat`,metadata:{priceAdjustmentId:r._id},payment_intent_data:{metadata:{priceAdjustmentId:r._id}}},{idempotencyKey:`dbc-rental-price-${r._id}`});
 if(!s.url)throw Error("Payment link is unavailable. Retry to recover the original link.");
 await ctx.runMutation(internal.rentalPriceState.bindSession,{id:r._id,sessionId:s.id,url:s.url});return s;
}
export const accept=action({args:{token:v.string(),id:v.id("rental_price_adjustments"),expectedNewTotal:v.number(),expectedDelta:v.number()},handler:async(ctx,a):Promise<any>=>ensureSession(ctx,await ctx.runMutation(internal.rentalPriceState.accept,a))});
export const decrease=action({args:{token:v.string(),bookingId:v.id("bookings"),requestId:v.string(),newTotal:v.number(),expectedSnapshot:v.string(),confirmed:v.boolean()},handler:async(ctx,a):Promise<any>=>{
 if(!checkAdminToken(a.token))throw Error("unauthorized");if(!a.confirmed)throw Error("Review and confirm the refund first.");
 const prior=await ctx.runQuery(internal.rentalPriceState.refundRetry,{bookingId:a.bookingId,requestId:a.requestId,newTotal:a.newTotal});if(prior)return ctx.runAction(api.checkout.refundRental,{token:a.token,bookingId:a.bookingId,requestId:a.requestId,...prior});
 const q:any=await ctx.runQuery(api.rentalPriceState.preview,{token:a.token,bookingId:a.bookingId,newTotal:a.newTotal});if(q.direction!=="decrease"||q.snapshot!==a.expectedSnapshot)throw Error("The rental changed. Review the new price again.");
 return ctx.runAction(api.checkout.refundRental,{token:a.token,bookingId:a.bookingId,requestId:a.requestId,amountPence:Math.round(-q.delta*100),reason:`Rental price adjusted to £${q.newTotal.toFixed(2)}`,expectedSnapshot:a.expectedSnapshot});
}});
async function fulfill(ctx:any,s:Stripe.Checkout.Session){
 const id=s.metadata?.priceAdjustmentId;if(!id)throw Error("Price payment metadata missing.");const c:any=await ctx.runQuery(internal.rentalPriceState.context,{id});if(!c)throw Error("Price proposal missing.");let r=c.request;
 if(s.status!=="complete"||s.payment_status!=="paid")return {bookingId:r.bookingId,paid:false,closed:false};
 if(!r.sessionId&&r.acceptedAt&&s.currency==="gbp"&&s.amount_total===Math.round(r.delta*100)){await ctx.runMutation(internal.rentalPriceState.bindSession,{id,sessionId:s.id,url:s.url??""});r={...r,sessionId:s.id};}
 if(s.id!==r.sessionId||s.currency!=="gbp"||s.amount_total!==Math.round(r.delta*100))throw Error("Price checkout receipt mismatch.");
 const pi=typeof s.payment_intent==="string"?s.payment_intent:s.payment_intent?.id;if(!pi)throw Error("Price payment missing.");const intent=await stripe().paymentIntents.retrieve(pi);
 if(intent.status!=="succeeded"||intent.currency!=="gbp"||intent.amount_received!==s.amount_total||intent.metadata.priceAdjustmentId!==id)throw Error("Stripe has not confirmed the accepted price payment.");
 const result:any=await ctx.runMutation(internal.rentalPriceState.applyPaid,{id,sessionId:s.id,paymentIntentId:pi,amountPence:intent.amount_received});
 if(result.closed){const initial=r.refundReceipt??{paymentIntentId:pi,amountPence:intent.amount_received,attemptedAt:Date.now(),status:"unknown"};const persist=async(receipt:any)=>{await ctx.runMutation(internal.rentalPriceState.recordRefund,{id,receipt})};await persist(initial);const receipt=await recoverApprovedRefund(stripe(),initial,{currency:"GBP",now:Date.now(),idempotencyKey:`dbc-closed-price-${id}`,metadata:{dbc_price_adjustment:id},maxRefunds:100,persist});await persist(receipt);}
 return {bookingId:r.bookingId,paid:true,closed:!!result.closed};
}
export const finalize=internalAction({args:{sessionId:v.string()},handler:async(ctx,a):Promise<any>=>fulfill(ctx,await stripe().checkout.sessions.retrieve(a.sessionId))});
export const withdraw=action({args:{token:v.string(),id:v.id("rental_price_adjustments")},handler:async(ctx,a):Promise<any>=>{
 if(!checkAdminToken(a.token))throw Error("unauthorized");const c:any=await ctx.runQuery(internal.rentalPriceState.context,{id:a.id});if(!c)throw Error("Price proposal missing.");const r=c.request;
 if(r.sessionId){const s=await stripe().checkout.sessions.retrieve(r.sessionId);if(s.status==="complete")return fulfill(ctx,s);if(s.status==="open")await stripe().checkout.sessions.expire(s.id);}
 // A creation response may have been lost; recover the original session before withdrawing.
 else if(r.status==="accepted"){const s:any=await ensureSession(ctx,r);if(s.status==="complete")return fulfill(ctx,s);if(s.status==="open")await stripe().checkout.sessions.expire(s.id);}
 await ctx.runMutation(internal.rentalPriceState.close,{id:a.id,status:"withdrawn"});return {withdrawn:true};
}});
export const reconcile=internalAction({args:{},handler:async(ctx):Promise<void>=>{const rows:any[]=await ctx.runQuery(internal.rentalPriceState.pending,{});for(const r of rows){try{if(r.sessionId){const s=await stripe().checkout.sessions.retrieve(r.sessionId);if(s.status==="complete")await fulfill(ctx,s);else if(s.status==="expired")await ctx.runMutation(internal.rentalPriceState.close,{id:r._id,status:"expired"});}else if(r.status==="awaiting_acceptance"&&r.expiresAt<=Date.now())await ctx.runMutation(internal.rentalPriceState.close,{id:r._id,status:"expired"});else if(r.status==="accepted")await ensureSession(ctx,r);await ctx.runMutation(internal.rentalPriceState.reconciliationResult,{id:r._id});}catch(e){await ctx.runMutation(internal.rentalPriceState.reconciliationResult,{id:r._id,error:e instanceof Error?e.message:"Payment receipt needs review"});}}}});
