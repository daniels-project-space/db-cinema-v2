import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { rentalHasStarted } from "../src/lib/cancellationPolicy";
import { stockWindow } from "./lib/stockWindows";
import { replacementValues } from "./lib/rentalExposure";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { query, mutation, internalMutation } from "./_generated/server";
import { additionalSwapStock, paidSwapEligible } from "./lib/rentalSwapSettlement";
import { completeRefundSwap, refundSwapEligible, failedRefundHasNoMoney } from "./lib/rentalSwapRefund";
import { prepareRentalRefund } from "./rentalOperations";
import { v } from "convex/values";
import { checkAdminToken, assertAdmin } from "./adminAuth";
import { approvedKitRequest } from "./lib/kitRequestBinding";
import { rentalSwapQuote, swapQuoteKey } from "./lib/rentalSwapQuote";
import { listingImages } from "./lib/catalogImages";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { queueOwnerNotification } from "./lib/adminPush";
function equalPriceSwapReady(booking:any,row:any){
 return booking.status==="confirmed" && !rentalHasStarted(booking,Date.now()) &&
  row.differencePence===0 && row.chargePence===0 && row.refundPence===0 && row.nonCashDifferencePence===0 &&
  row.securityChargePence===0 && row.holdTotalPence===Math.round((booking.depositHoldAmount??0)*100);
}
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
async function proposalFor(ctx:any,booking:any,request:any):Promise<Doc<"rental_swap_proposals">|null>{
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
 const settlement=row.settlementAdditionId?await ctx.db.get(row.settlementAdditionId):null;
 const refund=row.settlementRefundId?await ctx.db.get(row.settlementRefundId):null;
 if(row.settlementRefundId&&(!refund||refund.swapProposalId!==row._id||refund.bookingId!==booking._id))throw Error("The saved swap refund needs reconciliation.");
 if(row.settlementAdditionId&&(!settlement||settlement.swapProposalId!==row._id||settlement.bookingId!==booking._id||settlement.changeRequestId!==request._id||request.additionRequestId!==settlement._id))throw Error("The saved swap payment needs reconciliation.");
 const freshness=!settlement&&!refund&&["offered","accepted"].includes(row.state)?await isCurrent(ctx,booking,request,row,!!args.admin):{current:false,reason:null};
 const sourceImages=listingImages(await ctx.db.get(row.sourceListingId)),targetImages=listingImages(await ctx.db.get(row.targetListingId));
 return {id:row._id,state:row.state,quoteKey:row.quoteKey,...freshness,...(args.admin?{canApply:row.state==="accepted"&&freshness.current&&equalPriceSwapReady(booking,row),canWithdrawRefund:row.state==="accepted"&&booking.activeSwapRefundId===refund?._id&&failedRefundHasNoMoney(refund),canStartRefund:row.state==="accepted"&&freshness.current&&refundSwapEligible(booking,row),canStartPayment:row.state==="accepted"&&freshness.current&&paidSwapEligible(booking,row)}:{}),refundSettlement:refund?{id:refund._id,status:refund.status,amount:refund.amountPence/100,confirmedAmount:(refund.parts?refund.parts.filter(p=>p.status==="succeeded").reduce((sum,p)=>sum+p.amountPence,0):refund.status==="succeeded"?refund.amountPence:0)/100,...(args.admin?{error:row.settlementError??null}:{})}:null,settlement:settlement?{id:settlement._id,status:settlement.status,paymentUrl:settlement.status==="awaiting_payment"&&!settlement.withdrawalRequestedAt?settlement.paymentUrl??null:null}:null,appliedAt:row.appliedAt??null,activeRental:booking.status==="active",expiresAt:row.expiresAt,decidedAt:row.decidedAt??null,source:{title:row.sourceTitle,qty:row.quantity,heroImage:sourceImages[0]??null,imageSources:sourceImages},replacement:{title:row.targetTitle,qty:row.quantity,heroImage:targetImages[0]??null,imageSources:targetImages},start:row.start,end:row.end,pickupTime:row.pickupTime??null,returnTime:row.returnTime??null,originalAmount:row.originalPence/100,replacementAmount:row.replacementPence/100,difference:row.differencePence/100,charge:row.chargePence/100,refund:row.refundPence/100,nonCashDifference:row.nonCashDifferencePence/100,securityCharge:row.securityChargePence/100,holdTotal:row.holdTotalPence/100};
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
 if(row.settlementRefundId)throw Error("Finish or reconcile the saved original-method refund before closing this swap.");
 if(row.settlementAdditionId)throw Error("Withdraw the saved payment settlement in the rental controls before closing this proposal.");
 if(!["offered","accepted"].includes(row.state))throw Error("This proposal is already closed.");
 await ctx.db.patch(row._id,{state:"withdrawn",updatedAt:Date.now()});
 await postRentalMessage(ctx,{accountId:row.accountId,bookingId:booking._id,sender:"owner",text:"The team withdrew this swap proposal. Your original rental and payments remain unchanged. Reply here to discuss a new proposal.",meta:{type:"rental_swap_withdrawn",changeRequestId:request._id,swapProposalId:row._id}});
 return {id:row._id,state:"withdrawn" as const};
}});

/** Bind a genuine difference-only checkout to the exact accepted proposal. The
 * existing update pipeline owns payment, hold, recovery and withdrawal. */
export const preparePaidSwap=internalMutation({args:{...scopeArgs,quoteKey:v.string()},handler:async(ctx,args)=>{
 await assertAdmin(ctx,args.token,"rentalSwaps.preparePaidSwap");
 const {booking,request}=await scopedRequest(ctx,args,true),row=await proposalFor(ctx,booking,request);
 if(!row||row.quoteKey!==args.quoteKey)throw Error("This is not the accepted swap proposal.");
 if(row.settlementAdditionId){
  const saved=await ctx.db.get(row.settlementAdditionId);
  if(!saved||saved.swapProposalId!==row._id||saved.changeRequestId!==request._id||saved.bookingId!==booking._id)throw Error("The saved swap settlement needs reconciliation.");
  if(["expired","refunded"].includes(saved.status))throw Error("This swap settlement is closed. Agree a new request.");
  if(saved.status!=="applied"&&booking.activeAdditionId!==saved._id)throw Error("The saved swap settlement is no longer active.");
  return saved;
 }
 if(row.state!=="accepted"||row.consentVersion!=="rental-swap-price-difference-v1"||!paidSwapEligible(booking,row))throw Error("This swap needs an accepted pre-pickup payment proposal. Refunds, credit differences and collected equipment require their separate settlement.");
 if(row.expiresAt<Date.now()+35*60000)throw Error("This proposal is too close to expiry. Agree a new proposal before preparing payment.");
 const freshness=await isCurrent(ctx,booking,request,row,true);if(!freshness.current)throw Error(freshness.reason!);
 const quote=await rentalSwapQuote(ctx,booking,request);
 if(await swapQuoteKey(booking,request,quote)!==row.quoteKey||JSON.stringify(quote.finalLines)!==row.finalLines)throw Error("The accepted swap changed. Review a new proposal.");
 const reservations=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",booking._id)).take(201);
 if(reservations.length>200||reservations.some(r=>r.extensionRequestId&&["confirmed","active"].includes(r.status)))throw Error("The stock ledger needs reconciliation before this swap.");
 const holds=await additionalSwapStock(ctx,quote.finalLines,quote.allocationMode,reservations),now=Date.now();
 const id=await ctx.db.insert("rental_additions",{
  bookingId:booking._id,requestId:`swap-${row._id}`,changeRequestId:request._id,swapProposalId:row._id,
  listingId:row.targetListingId,title:row.targetTitle,start:row.start,end:row.end,qty:row.quantity,dailyRate:quote.replacement.dailyRate,
  lineTotal:row.differencePence/100,securityCharge:row.securityChargePence/100,holdTotal:row.holdTotalPence/100,oldHoldId:booking.stripeDepositIntentId,
  status:"prepared",reason:`Accepted swap: ${row.sourceTitle} → ${row.targetTitle}`.slice(0,400),createdAt:row.createdAt,updatedAt:now,
 });
 await ctx.db.patch(row._id,{settlementAdditionId:id,updatedAt:now});
 await ctx.db.patch(request._id,{additionRequestId:id});
 await ctx.db.patch(booking._id,{activeAdditionId:id});
 for(const hold of holds)await ctx.db.insert("reservations",{...hold,bookingId:booking._id,source:"site",status:"hold",externalRef:`addition:${id}`,holdExpiresAt:Math.min(row.expiresAt,now+35*60000)});
 return (await ctx.db.get(id))!;
}});

/** Reserve the final physical delta before contacting the bank. Confirmed
 * allocations intentionally have no timeout while a financial result is unknown. */
export const prepareRefundSwap=internalMutation({args:{...scopeArgs,quoteKey:v.string()},handler:async(ctx,args)=>{
 await assertAdmin(ctx,args.token,"rentalSwaps.prepareRefundSwap");
 const {booking,request}=await scopedRequest(ctx,args,true),row=await proposalFor(ctx,booking,request);
 if(!row||row.quoteKey!==args.quoteKey)throw Error("This is not the accepted swap proposal.");
 if(row.settlementRefundId){
  const saved=await ctx.db.get(row.settlementRefundId);
  if(!saved||saved.swapProposalId!==row._id||saved.bookingId!==booking._id||saved.amountPence!==row.refundPence||row.state!=="applied"&&booking.activeSwapRefundId!==saved._id)throw Error("The saved swap refund needs reconciliation.");
  return saved;
 }
 if(row.settlementAdditionId||row.state!=="accepted"||row.consentVersion!=="rental-swap-price-difference-v1"||!refundSwapEligible(booking,row))throw Error("This swap needs a current accepted pre-pickup original-method refund proposal and settled security.");
 const freshness=await isCurrent(ctx,booking,request,row,true);if(!freshness.current)throw Error(freshness.reason!);
 const quote=await rentalSwapQuote(ctx,booking,request);
 if(await swapQuoteKey(booking,request,quote)!==row.quoteKey||JSON.stringify(quote.finalLines)!==row.finalLines)throw Error("The accepted swap changed. Review a new proposal.");
 const reservations=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",booking._id)).take(201);
 if(reservations.length>200||reservations.some(r=>r.extensionRequestId&&["confirmed","active"].includes(r.status)))throw Error("The swap stock ledger needs reconciliation.");
 const holds=await additionalSwapStock(ctx,quote.finalLines,quote.allocationMode,reservations);
 const refund=await prepareRentalRefund(ctx,{token:args.token,bookingId:booking._id,requestId:`swap-refund-${row.quoteKey}`,amountPence:row.refundPence,reason:`Accepted swap: ${row.sourceTitle} → ${row.targetTitle}`});
 await ctx.db.patch(refund._id,{swapProposalId:row._id});
 await ctx.db.patch(row._id,{settlementRefundId:refund._id,updatedAt:Date.now()});
 await ctx.db.patch(booking._id,{activeSwapRefundId:refund._id});
 for(const hold of holds)await ctx.db.insert("reservations",{...hold,bookingId:booking._id,source:"site",status:"confirmed",externalRef:`swap-refund:${refund._id}`});
 return (await ctx.db.get(refund._id))!;
}});
export const finishRefundSwap=internalMutation({args:{id:v.id("rental_refunds")},handler:async(ctx,{id})=>completeRefundSwap(ctx,id)});
/** A bank-confirmed failure with no successful or pending parts can be closed by
 * the owner. Unknown and partly returned money must remain locked for review. */
export const withdrawFailedRefundSwap=mutation({args:scopeArgs,handler:async(ctx,args)=>{
 await assertAdmin(ctx,args.token,"rentalSwaps.withdrawFailedRefundSwap");
 const {booking,request}=await scopedRequest(ctx,args,true),row=await proposalFor(ctx,booking,request);
 if(!row?.settlementRefundId)throw Error("No saved refund settlement.");
 const refund=await ctx.db.get(row.settlementRefundId);
 if(!refund||refund.swapProposalId!==row._id||refund.bookingId!==booking._id)throw Error("The saved swap refund needs reconciliation.");
 if(row.state==="withdrawn")return {state:"withdrawn"};
 if(row.state!=="accepted"||booking.activeSwapRefundId!==refund._id||!failedRefundHasNoMoney(refund))
  throw Error("Only a confirmed failed refund with no money returned can be withdrawn. Reconcile pending or partially refunded payments first.");
 const reservations=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",booking._id)).take(201);
 if(reservations.length>200)throw Error("The swap stock history needs reconciliation.");
 for(const r of reservations)if(r.externalRef===`swap-refund:${refund._id}`&&r.status==="confirmed")await ctx.db.patch(r._id,{status:"cancelled"});
 await ctx.db.patch(booking._id,{activeSwapRefundId:undefined});
 await ctx.db.patch(row._id,{state:"withdrawn",updatedAt:Date.now(),settlementError:undefined});
 await postRentalMessage(ctx,{accountId:row.accountId,bookingId:booking._id,sender:"owner",text:"The team closed the failed swap refund. No rental payment was returned and the original kit remains booked. Reply here to agree a new proposal.",meta:{type:"rental_swap_withdrawn",changeRequestId:request._id,swapProposalId:row._id}});
 return {state:"withdrawn"};
}});


/** Atomically exchange pre-pickup inventory when no payment or security change is
 * required. Paid/refunded swaps must go through their separate settlement path. */
export const applyAgreedSwap=mutation({args:{...scopeArgs,quoteKey:v.string()},handler:async(ctx,args)=>{
 await assertAdmin(ctx,args.token,"rentalSwaps.applyAgreedSwap");
 const {booking,request}=await scopedRequest(ctx,args,true),row=await proposalFor(ctx,booking,request);
 if(!row||row.quoteKey!==args.quoteKey)throw Error("This is not the accepted swap proposal.");
 const operationKey=`kit-swap:${booking._id}:${row._id}:${row.quoteKey}`;
 if(row.state==="applied"){
  if(request.execution?.operation!=="kit_swap"||request.execution.operationKey!==operationKey||request.execution.status!=="applied"||row.appliedAt!==request.execution.appliedAt||!Number.isSafeInteger(row.appliedAt))throw Error("The saved swap receipt needs reconciliation.");
  return {id:row._id,state:"applied" as const};
 }
 if(row.state!=="accepted"||row.consentVersion!=="rental-swap-price-difference-v1")throw Error("The renter must accept this exact proposal before changing the kit.");
 if(!equalPriceSwapReady(booking,row))throw Error("This swap requires payment/refund, security settlement or a recorded return and handover before it can be applied.");
 const freshness=await isCurrent(ctx,booking,request,row,true);if(!freshness.current)throw Error(freshness.reason!);
 const q=await rentalSwapQuote(ctx,booking,request);
 if(q.differencePence!==0||q.chargePence!==0||q.refundPence!==0||q.nonCashDifferencePence!==0||q.securityCharge!==0||Math.round(q.holdTotal*100)!==row.holdTotalPence)throw Error("The accepted swap requires a separate financial or security settlement.");
 if(await swapQuoteKey(booking,request,q)!==row.quoteKey||JSON.stringify(q.finalLines)!==row.finalLines||q.allocationMode!==row.allocationMode)throw Error("The accepted swap changed. Agree a new proposal.");
 const reservations=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",booking._id)).take(201);
 if(reservations.length>200)throw Error("The stock ledger needs paged reconciliation before applying this swap.");
 if(reservations.some(r=>r.extensionRequestId&&["confirmed","active"].includes(r.status)))throw Error("The extension stock ledger needs a team reconciliation before this swap.");
 // Inventory checks above and these writes share one Convex transaction: another
 // booking cannot take the replacement between consent validation and allocation.
 const values=await replacementValues(ctx,booking,q.finalLines);
 for(const r of reservations)if(r.status==="confirmed")await ctx.db.patch(r._id,{status:"cancelled"});
 for(const line of q.finalLines){
  const listing=await ctx.db.get(line.listingId as Id<"listings">);
  if(!listing?.components.length)throw Error("The replacement inventory mapping needs review.");
  const window=q.allocationMode==="legacy"?{start:line.start,end:line.end}:stockWindow(line,q.allocationMode==="precise");
  for(const component of listing.components)await ctx.db.insert("reservations",{bookingId:booking._id,listingId:line.listingId,inventoryUnitId:component.inventoryUnitId,...window,qty:line.qty*component.qty,status:"confirmed",source:"site"});
 }
 const now=Date.now();
 await ctx.db.patch(booking._id,{lineItems:q.finalLines,replacementValues:values});
 const detail=`${row.quantity}× ${row.sourceTitle} → ${row.targetTitle}. Agreed rental charges and security are unchanged.`;
 await ctx.db.patch(request._id,{execution:{operation:"kit_swap",operationKey,status:"applied",startedAt:now,appliedAt:now,detail}});
 await ctx.db.patch(row._id,{state:"applied",updatedAt:now,appliedAt:now});
 await postRentalMessage(ctx,{accountId:row.accountId,bookingId:booking._id,sender:"system",text:`The agreed equipment swap is confirmed: ${detail}`,meta:{type:"rental_swap_applied",changeRequestId:request._id,swapProposalId:row._id}});
 await ctx.scheduler.runAfter(0,internal.notify.changeEmail,{bookingId:booking._id,kind:"kit updated",detail});
 await queueRmv2Sync(ctx,booking._id);
 return {id:row._id,state:"applied" as const};
}});
