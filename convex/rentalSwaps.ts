import { query } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken } from "./adminAuth";
import { approvedKitRequest } from "./lib/kitRequestBinding";
import { rentalSwapQuote } from "./lib/rentalSwapQuote";
import { listingImages } from "./lib/catalogImages";
/** Scoped owner preview: exact selected source, replacement and actual cash difference. */
export const preview=query({args:{token:v.string(),bookingId:v.id("bookings"),id:v.id("rental_change_requests"),refreshKey:v.optional(v.number())},handler:async(ctx,{token,bookingId,id})=>{
 if(!checkAdminToken(token))return null;
 try{
  const booking=await ctx.db.get(bookingId);if(!booking)throw Error("Rental unavailable.");
  const request=await approvedKitRequest(ctx,booking,id),q=await rentalSwapQuote(ctx,booking,request);
  const sourceImages=listingImages(q.source?await ctx.db.get(q.source.listingId):null),targetImages=listingImages(q.target);
  return {available:true as const,reason:null,source:{title:q.source.title,qty:q.selection.quantity,heroImage:sourceImages[0]??null,imageSources:sourceImages},replacement:{title:q.target.title,qty:q.selection.quantity,heroImage:targetImages[0]??null,imageSources:targetImages},start:q.source.start,end:q.source.end,pickupTime:q.replacement.pickupTime??null,returnTime:q.replacement.returnTime??null,originalAmount:q.removedLinePence/100,replacementAmount:q.replacementLinePence/100,difference:q.differencePence/100,charge:q.chargePence/100,refund:q.refundPence/100,nonCashDifference:q.nonCashDifferencePence/100,securityCharge:q.securityCharge,holdTotal:q.holdTotal,activeRental:booking.status==="active"};
 }catch(e:any){return {available:false as const,reason:e.message??"The swap needs review."};}
}});
