"use node";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const attest=internalAction({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
 const source:any=await ctx.runQuery(internal.referrals.paymentContext,{bookingId});
 if(!source||!process.env.STRIPE_SECRET_KEY)return {checked:false};
 try{
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY),b=source.booking;
  const intentId=b.stripeDepositIntentId??b.stripePaymentIntentId;
  if(!intentId)return {checked:false};
  const intent=await stripe.paymentIntents.retrieve(intentId);
  if(intent.metadata?.bookingId!==String(b._id))return {checked:false};
  const method=typeof intent.payment_method==="string"?await stripe.paymentMethods.retrieve(intent.payment_method):intent.payment_method;
  if(!method?.card?.fingerprint)return {checked:false};
  const hash=createHash("sha256").update("stripe-card:"+method.card.fingerprint).digest("hex");
  // A referrer may have bought membership separately before renting.
  if(source.referrer?.stripeCustomerId){
   const customer=await stripe.customers.retrieve(source.referrer.stripeCustomerId);
   if(!customer.deleted){
    const id=customer.invoice_settings.default_payment_method;
    const own=typeof id==="string"?await stripe.paymentMethods.retrieve(id):id;
    if(own?.card?.fingerprint){const ownHash=createHash("sha256").update("stripe-card:"+own.card.fingerprint).digest("hex");await ctx.runMutation(internal.referrals.rememberIdentity,{accountId:source.referrer._id,paymentHash:ownHash});}
   }
  }
  await ctx.runMutation(internal.referrals.recordPayment,{bookingId,paymentHash:hash});
  await ctx.runMutation(internal.referrals.qualify,{bookingId});return {checked:true};
 }catch{return {checked:false};} // The durable paid row retries; an outage never invents a reward.
}});
