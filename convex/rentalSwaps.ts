import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken, assertAdmin } from "./adminAuth";
import { approvedKitRequest } from "./lib/kitRequestBinding";
import { rentalSwapQuote, swapQuoteKey } from "./lib/rentalSwapQuote";
import { listingImages } from "./lib/catalogImages";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { queueOwnerNotification } from "./lib/adminPush";
/** Scoped owner preview: exact selected source, replacement and actual cash difference. */
export const preview=query({args:{token:v.string(),bookingId:v.id("bookings"),id:v.id("rental_change_requests"),refreshKey:v.optional(v.number())},handler:async(ctx,{token,bookingId,id})=>{
 if(!checkAdminToken(token))return null;
 try{
  const booking=await ctx.db.get(bookingId);if(!booking)throw Error("Rental unavailable.");
  const request=await approvedKitRequest(ctx,booking,id),q=await rentalSwapQuote(ctx,booking,request);
  const sourceImages=listingImages(q.source?await ctx.db.get(q.source.listingId):null),targetImages=listingImages(q.target);
  return {available:true as const,reason:null,quoteKey:await swapQuoteKey(booking,request,q),source:{title:q.source.title,qty:q.selection.quantity,heroImage:sourceImages[0]??null,imageSources:sourceImages},replacement:{title:q.target.title,qty:q.selection.quantity,heroImage:targetImages[0]??null,imageSources:targetImages},start:q.source.start,end:q.source.end,pickupTime:q.replacement.pickupTime??null,returnTime:q.replacement.returnTime??null,originalAmount:q.removedLinePence/100,replacementAmount:q.replacementLinePence/100,difference:q.differencePence/100,charge:q.chargePence/100,refund:q.refundPence/100,nonCashDifference:q.nonCashDifferencePence/100,securityCharge:q.securityCharge,holdTotal:q.holdTotal,activeRental:booking.status==="active"};
 }catch(e:any){return {available:false as const,reason:e.message??"The swap needs review."};}
}});

const scopeArgs={token:v.string(),bookingId:v.id("bookings"),id:v.id("rental_change_requests")};
async function scopedRequest(ctx:any,args:any,admin:boolean){
 const account=admin?null:await accountForToken(ctx,args.token,true);
 if(admin){if(!checkAdminToken(args.token))throw Error("unauthorized");}else if(!account)throw Error("Please sign in.");
 const booking=admin?await ctx.db.get(args.bookingId):await ownedBooking(ctx,account,args.bookingId);
 const request=await ctx.db.get(args.id),owner=request?await ctx.db.get(request.accountId):null;
 if(!booking||!request||request.bookingId!==booking._id||request.kind!=="items"||request.kitSelection?.change!=="swap"||!belongsToRentalAccount(booking,owner)||account&&request.accountId!==account._id)throw Error("This swap is not available for your rental.");
 return {booking,request};
}
async function proposalFor(ctx:any,booking:any,request:any){
 const row=await ctx.db.query("rental_swap_proposals").withIndex("by_request",(q:any)=>q.eq("changeRequestId",request._id)).first();
 if(row&&(row.bookingId!==booking._id||row.accountId!==request.accountId||request.swapProposalId!==row._id))throw Error("This saved proposal belongs to another rental or account.");
 return row;
}
async function isCurrent(ctx:any,booking:any,request:any,row:any,exposeInternal=false){
 if(row.expiresAt<=Date.now())return {current:false,reason:"This proposal has expired. Ask the team for a new proposal."};
 try{
  await approvedKitRequest(ctx,booking,request._id);
  const q=await rentalSwapQuote(ctx,booking,request);
  if(await swapQuoteKey(booking,request,q)!==row.quoteKey)throw Error("The kit, price or security changed. Ask the team for a new proposal.");
  return {current:true,reason:null};
 }catch(e:any){return {current:false,reason:exposeInternal?(e.message??"This proposal needs a new team review."):"Availability, kit pricing or security has changed. Ask the team to review this proposal."};}
}
/** Public projection contains the agreed amounts, never saved stock/payment internals. */
export const proposal=query({args:{...scopeArgs,admin:v.optional(v.boolean()),refreshKey:v.optional(v.number())},handler:async(ctx,args)=>{
 const {booking,request}=await scopedRequest(ctx,args,!!args.admin),row=await proposalFor(ctx,booking,request);
 if(!row)return null;
 const freshness=["offered","accepted"].includes(row.state)?await isCurrent(ctx,booking,request,row,!!args.admin):{current:false,reason:null};
 const sourceImages=listingImages(await ctx.db.get(row.sourceListingId)),targetImages=listingImages(await ctx.db.get(row.targetListingId));
 return {id:row._id,state:row.state,quoteKey:row.quoteKey,...freshness,activeRental:booking.status==="active",expiresAt:row.expiresAt,decidedAt:row.decidedAt??null,source:{title:row.sourceTitle,qty:row.quantity,heroImage:sourceImages[0]??null,imageSources:sourceImages},replacement:{title:row.targetTitle,qty:row.quantity,heroImage:targetImages[0]??null,imageSources:targetImages},start:row.start,end:row.end,pickupTime:row.pickupTime??null,returnTime:row.returnTime??null,originalAmount:row.originalPence/100,replacementAmount:row.replacementPence/100,difference:row.differencePence/100,charge:row.chargePence/100,refund:row.refundPence/100,nonCashDifference:row.nonCashDifferencePence/100,securityCharge:row.securityChargePence/100,holdTotal:row.holdTotalPence/100};
}});

/** Saving an offer records the exact consent basis; it does not reserve stock or execute money. */
export const offer=mutation({args:{...scopeArgs,quoteKey:v.string()},handler:async(ctx,args)=>{
 await assertAdmin(ctx,args.token,"rentalSwaps.offer");
 const {booking,request}=await scopedRequest(ctx,args,true),existing=await proposalFor(ctx,booking,request);
 if(existing){if(existing.quoteKey!==args.quoteKey)throw Error("This request already has a different saved proposal. Withdraw it and agree a new request.");return {id:existing._id,state:existing.state};}
 await approvedKitRequest(ctx,booking,request._id);
 const q=await rentalSwapQuote(ctx,booking,request),key=await swapQuoteKey(booking,request,q);
 if(!/^[a-f0-9]{64}$/.test(args.quoteKey)||args.quoteKey!==key)throw Error("The swap quote changed. Review the current amounts before sending.");
 const now=Date.now(),id=await ctx.db.insert("rental_swap_proposals",{
  bookingId:booking._id,accountId:request.accountId,changeRequestId:request._id,state:"offered",quoteKey:key,snapshot:q.snapshot,finalLines:JSON.stringify(q.finalLines),allocationMode:q.allocationMode,
  sourceListingId:q.source.listingId,targetListingId:q.target._id,sourceTitle:q.source.title,targetTitle:q.target.title,quantity:q.selection.quantity,start:q.source.start,end:q.source.end,
  ...(q.replacement.pickupTime?{pickupTime:q.replacement.pickupTime}:{}),...(q.replacement.returnTime?{returnTime:q.replacement.returnTime}:{}),
  originalPence:q.removedLinePence,replacementPence:q.replacementLinePence,differencePence:q.differencePence,chargePence:q.chargePence,refundPence:q.refundPence,nonCashDifferencePence:q.nonCashDifferencePence,securityChargePence:Math.round(q.securityCharge*100),holdTotalPence:Math.round(q.holdTotal*100),createdAt:now,updatedAt:now,expiresAt:now+24*3600000,
 });
 await ctx.db.patch(request._id,{swapProposalId:id});
 const messageId=await postRentalMessage(ctx,{accountId:request.accountId,bookingId:booking._id,sender:"owner",text:`Please review the proposed swap: ${q.selection.quantity}× ${q.source.title} → ${q.target.title}. Additional payment £${(q.chargePence/100).toFixed(2)}; proposed refund to the original payment method £${(q.refundPence/100).toFixed(2)}; replacement card authorisation £${q.holdTotal.toFixed(2)}. Review and accept or decline the proposal in your rental requests. The original rental remains unchanged until settlement and the kit update are confirmed.`,meta:{type:"rental_swap_proposal",changeRequestId:request._id,swapProposalId:id}});
 await ctx.db.patch(id,{messageId});return {id,state:"offered" as const};
}});

/** A renter accepts the exact saved offer, not whatever happens to be in the kit now. */
export const respond=mutation({args:{...scopeArgs,quoteKey:v.string(),decision:v.union(v.literal("accepted"),v.literal("declined"))},handler:async(ctx,args)=>{
 const {booking,request}=await scopedRequest(ctx,args,false),row=await proposalFor(ctx,booking,request);
 if(!row||row.quoteKey!==args.quoteKey)throw Error("This is not the saved swap proposal.");
 if(row.state===args.decision)return {id:row._id,state:row.state};
 if(row.state!=="offered")throw Error("This proposal has already been answered or withdrawn.");
 if(args.decision==="accepted"){
  const freshness=await isCurrent(ctx,booking,request,row);if(!freshness.current)throw Error(freshness.reason!);
  const accepted=await ctx.db.query("rental_swap_proposals").withIndex("by_booking_state",q=>q.eq("bookingId",booking._id).eq("state","accepted")).first();
  if(accepted)throw Error("Finish or withdraw the accepted swap before accepting another proposal.");
 }
 const now=Date.now();
 await ctx.db.patch(row._id,{state:args.decision,decidedAt:now,updatedAt:now,...(args.decision==="accepted"?{consentVersion:"rental-swap-price-difference-v1"}:{})});
 const messageId=await postRentalMessage(ctx,{accountId:row.accountId,bookingId:booking._id,sender:"renter",text:args.decision==="accepted"?`I accept the swap proposal for ${row.quantity}× ${row.sourceTitle} → ${row.targetTitle}, including additional payment £${(row.chargePence/100).toFixed(2)}, proposed original-method refund £${(row.refundPence/100).toFixed(2)} and replacement card authorisation £${(row.holdTotalPence/100).toFixed(2)}. I understand the original rental remains unchanged until payment/refund, security and the kit update are confirmed.`:`I decline the swap proposal for ${row.quantity}× ${row.targetTitle}. Please keep my original rental.`,meta:{type:"rental_swap_response",changeRequestId:request._id,swapProposalId:row._id,decision:args.decision}});
 await ctx.db.patch(row._id,{decisionMessageId:messageId});
 await queueOwnerNotification(ctx,{eventKey:`rental-swap-response:${row._id}`,kind:"rental_change",accountId:row.accountId,bookingId:booking._id,title:args.decision==="accepted"?"Swap proposal accepted":"Swap proposal declined",body:"Review the renter’s response in the linked rental conversation."});
 return {id:row._id,state:args.decision};
}});

export const withdrawOffer=mutation({args:scopeArgs,handler:async(ctx,args)=>{
 await assertAdmin(ctx,args.token,"rentalSwaps.withdrawOffer");
 const {booking,request}=await scopedRequest(ctx,args,true),row=await proposalFor(ctx,booking,request);
 if(!row)throw Error("No saved swap proposal.");
 if(row.state==="withdrawn")return {id:row._id,state:row.state};
 if(!["offered","accepted"].includes(row.state))throw Error("This proposal is already closed.");
 await ctx.db.patch(row._id,{state:"withdrawn",updatedAt:Date.now()});
 await postRentalMessage(ctx,{accountId:row.accountId,bookingId:booking._id,sender:"owner",text:"The team withdrew this swap proposal. Your original rental and payments remain unchanged. Reply here to discuss a new proposal.",meta:{type:"rental_swap_withdrawn",changeRequestId:request._id,swapProposalId:row._id}});
 return {id:row._id,state:"withdrawn" as const};
}});
