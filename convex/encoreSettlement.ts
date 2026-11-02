"use node";
import Stripe from "stripe";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { encoreGate } from "./lib/loyalty";
import { reviewSettlementFingerprint } from "./lib/reviewEligibility";
import { providerReviewGate } from "./reviewFollowUp";

export const processCheck=internalAction({args:{checkId:v.id("encore_settlement_checks")},handler:async(ctx,{checkId}):Promise<void>=>{
 const claim=await ctx.runMutation(internal.encoreSettlementState.claim,{checkId});if(!claim)return;
 const booking=await ctx.runQuery(internal.encoreSettlementState.context,{bookingId:claim.bookingId});
 let result:"eligible"|"ineligible"|"retry"="retry",error:string|undefined;
 if(!booking)result="ineligible";
 else {
  const reason=encoreGate(booking);
  if(reason && !["refund_not_settled","return_settlement_pending","late_settlement_pending"].includes(reason))result="ineligible";
  else if(reason)error=reason;
  else if(!process.env.STRIPE_SECRET_KEY)error="provider_unconfigured";
  else try {const providerReason=await providerReviewGate(booking,new Stripe(process.env.STRIPE_SECRET_KEY));if(providerReason)error=providerReason;else result="eligible";} catch {error="provider_unavailable";}
 }
 await ctx.runMutation(internal.encoreSettlementState.finish,{checkId,generation:claim.generation,result,...(booking?{fingerprint:reviewSettlementFingerprint(booking)}:{}),...(error?{error}:{})});
}});
