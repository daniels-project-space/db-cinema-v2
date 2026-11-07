import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertSwapStockReconciled } from "./lib/swapStockFence";
import { internal } from "./_generated/api";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { accountForToken, ownedBooking, postRentalMessage } from "./lib/rentalChat";
import { accountForRental, belongsToRentalAccount } from "./lib/rentalAccount";
import { rentalControlsSnapshot } from "./lib/rentalControlsSnapshot";
import { bookingStockLines } from "../shared/rentalWindow";
import { verificationValidUntil } from "../shared/verificationProgress";
import { rentalPricingDays } from "../shared/rentalDuration";
import { quote } from "./lib/pricing";
import { assertRentalInventory } from "./lib/rentalInventory";
import { assertRenterExposure, replacementValues } from "./lib/rentalExposure";
import { cardHoldFor, cardLimitForPolicy, depositForBookingPolicy, isCardHoldSecurityPolicy, ASSESSMENT_SECURITY_POLICY_VERSION } from "../shared/rentalSecurity";
import { adjustedSwapCreditBalances, quoteSwapFunding, restoreSwapCredit } from "./lib/rentalSwapFunding";
import { reserveSwapStock, applySwapStock } from "./lib/rentalSwapStock";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { queueOwnerNotification } from "./lib/adminPush";
import { depositReturnReceipt } from "./lib/depositReturnReceipt";
import { assertFreshSharedStock } from "./lib/shared_stock_sync";
import { assertSwapAuthorityAvailable, swapAuthorityAvailable } from "./lib/rentalSwapAuthority";
import { assertStockExecution, releaseClosedClaim, queueCompensatedRelease } from "./swapStockOperations";

function enabled() {
  if (process.env.RENTAL_ITEM_SWAP_ENABLED !== "true") throw Error("Equipment swaps are not enabled.");
  assertSwapAuthorityAvailable();
}

function canonicalFunding(value:any):any {
  if(Array.isArray(value))return value.map(canonicalFunding);
  if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalFunding(value[key])]));
  return value;
}

async function notifySettlement(ctx:any, swap:any, booking:any, text:string, kind:string, detail:string) {
  const account = await ctx.db.get(swap.accountId);
  if (!belongsToRentalAccount(booking, account)) {
    await queueOwnerNotification(ctx,{eventKey:swap.refundJobId ? `refund-owner-changed:${swap.refundJobId}` : `swap-owner-changed:${swap._id}:${kind}`,kind:"checkout_failure",bookingId:swap.bookingId,title:"Equipment settlement needs a contact check",body:"The original rental account changed during settlement. Check the payment and contact details before notifying the renter."});
    return;
  }
  await postRentalMessage(ctx,{accountId:swap.accountId,bookingId:swap.bookingId,sender:"system",text});
  await ctx.scheduler.runAfter(0,internal.notify.changeEmail,{bookingId:swap.bookingId,expectedAccountId:swap.accountId,kind,detail});
}

async function securityValues(ctx:any, booking:any, lines:any[]) {
  const values=await replacementValues(ctx,booking,lines);
  const value=lines.reduce((sum:number,line:any)=>{const item=values.find((entry:any)=>String(entry.listingId)===String(line.listingId));if(!item)throw Error("The replacement value needs review.");return sum+item.unitPence*line.qty;},0)/100;
  if(booking.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION&&depositForBookingPolicy(booking,value)>booking.depositAmount)throw Error("The revised deposit requires a separate security review.");
  if(isCardHoldSecurityPolicy(booking.securityPolicyVersion)&&cardHoldFor(value)>(booking.depositHoldAmount??0))throw Error("The revised card authorisation requires a separate security review.");
  if(booking.savedCardLimit!==undefined&&cardLimitForPolicy(booking.securityPolicyVersion,value)>booking.savedCardLimit)throw Error("The revised card permission requires separate renter consent.");
  return values;
}

async function calculate(ctx: any, bookingId: any, lineIndex: number, newListingId: any, ownSwapId?: any) {
  await assertFreshSharedStock(ctx);
  const booking = await ctx.db.get(bookingId);
  if (!booking || booking.status !== "confirmed" || booking.cancellationDecision || booking.returnDecision || booking.activeAdditionId || booking.activeDeliveryQuoteId || booking.activeExtensionId || booking.activePriceAdjustmentId || booking.activeItemSwapId && booking.activeItemSwapId !== ownSwapId) throw Error("Finish the current rental operation before changing equipment.");
  await assertSwapStockReconciled(ctx, bookingId);
  if (!Number.isSafeInteger(lineIndex) || lineIndex < 0 || !booking.lineItems[lineIndex]) throw Error("Choose an item in this rental.");
  const oldLine = bookingStockLines<any>(booking)[lineIndex];
  if (String(oldLine.listingId) === String(newListingId)) throw Error("Choose a different item.");
  const listing = await ctx.db.get(newListingId);
  if (!listing || !listing.active || listing.suppressed || listing.marketingOnly || !listing.components?.length) throw Error("The replacement item is unavailable.");
  const days = rentalPricingDays(oldLine.start, oldLine.end, oldLine.pickupTime, oldLine.returnTime);
  const newLine = { ...oldLine, listingId: listing._id, title: listing.title, lineTotal: quote(listing.pricing, days).total * oldLine.qty, dailyRate: listing.pricing.daily * oldLine.qty };
  const lines = bookingStockLines<any>(booking).map((line: any, index: number) => index === lineIndex ? newLine : line);
  await assertRentalInventory(ctx, lines, booking._id);
  await assertRenterExposure(ctx, booking, lines);
  const values = await securityValues(ctx,booking,lines);
  const refunds = await ctx.db.query("rental_refunds").withIndex("by_booking", (index: any) => index.eq("bookingId", bookingId)).take(101);
  if (refunds.length > 100 || refunds.some((item: any) => ["prepared", "pending"].includes(item.status))) throw Error("The rental refund history needs review before changing equipment.");
  const funding = await quoteSwapFunding(ctx, booking, lineIndex, newLine);
  const snapshot = rentalControlsSnapshot({ ...booking, activeItemSwapId: undefined }, refunds);
  const quoteSnapshot = JSON.stringify([snapshot, listing.pricing, listing.components, newLine, funding]);
  return { booking, oldLine, newLine, lines, values, funding, snapshot, quoteSnapshot };
}

export const readiness=query({args:{token:v.string()},handler:async(_ctx,args)=>checkAdminToken(args.token)&&process.env.RENTAL_ITEM_SWAP_ENABLED==="true"&&swapAuthorityAvailable()});

export const preview = query({ args: { token:v.string(), bookingId:v.id("bookings"), lineIndex:v.number(), newListingId:v.id("listings") }, handler: async (ctx, args) => {
  enabled(); if (!checkAdminToken(args.token)) throw Error("unauthorized");
  const result = await calculate(ctx, args.bookingId, args.lineIndex, args.newListingId);
  return { oldLine:result.oldLine, newLine:result.newLine, quote:result.funding, quoteSnapshot:result.quoteSnapshot };
} });

export const previewForAdmin=query({args:{token:v.string(),bookingId:v.id("bookings"),lineIndex:v.number(),newListingId:v.id("listings")},handler:async(ctx,args)=>{
  if(!checkAdminToken(args.token))return null;
  try{enabled();const result=await calculate(ctx,args.bookingId,args.lineIndex,args.newListingId);return {ok:true as const,oldLine:result.oldLine,newLine:result.newLine,quote:result.funding,quoteSnapshot:result.quoteSnapshot};}
  catch{return {ok:false as const,error:"This item cannot be quoted for this rental. Check availability, security and any open rental changes."};}
}});

export const propose = mutation({ args: { token:v.string(), bookingId:v.id("bookings"), lineIndex:v.number(), newListingId:v.id("listings"), requestId:v.string(), quoteSnapshot:v.string(), confirmed:v.boolean() }, handler: async (ctx, args) => {
  enabled(); await assertAdmin(ctx, args.token, "rentalSwapState.propose");
  if (!args.confirmed || !/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId)) throw Error("Review and confirm the equipment proposal first.");
  const prior = await ctx.db.query("rental_item_swaps").withIndex("by_request", index => index.eq("bookingId", args.bookingId).eq("requestId", args.requestId)).unique();
  if (prior) { if (prior.quoteSnapshot !== args.quoteSnapshot || prior.lineIndex !== args.lineIndex || prior.newListingId !== args.newListingId) throw Error("This request belongs to a different equipment proposal."); return prior._id; }
  const result = await calculate(ctx, args.bookingId, args.lineIndex, args.newListingId);
  if (result.quoteSnapshot !== args.quoteSnapshot) throw Error("The equipment quote changed. Review it again.");
  const account = await accountForRental(ctx, result.booking);
  if (!account || account.blockedAt != null || String(result.booking.accountId) !== String(account._id)) throw Error("An owned rental account is required for this proposal.");
  const now = Date.now(), expiresAt = now + 24 * 3600000;
  const id = await ctx.db.insert("rental_item_swaps", { bookingId:args.bookingId, accountId:account._id, requestId:args.requestId, baseSnapshot:result.snapshot, quoteSnapshot:args.quoteSnapshot, lineIndex:args.lineIndex, oldListingId:result.oldLine.listingId, newListingId:args.newListingId, oldLine:result.oldLine, newLine:result.newLine, quote:result.funding, status:"awaiting_acceptance", createdAt:now, updatedAt:now, expiresAt, reconcileAfter:expiresAt });
  await reserveSwapStock(ctx, result.booking, result.oldLine, result.newLine, result.lines, id, expiresAt);
  await ctx.db.patch(args.bookingId, { activeItemSwapId:id });
  await postRentalMessage(ctx, { accountId:account._id, bookingId:args.bookingId, sender:"system", text:`The team proposed replacing ${result.oldLine.qty} × ${result.oldLine.title} with ${result.newLine.qty} × ${result.newLine.title}. Review the equipment and payment difference before accepting. Nothing has been charged or refunded yet.`, meta:{kind:"rental_item_swap",swapId:id} });
  await queueRmv2Sync(ctx, args.bookingId); return id;
} });

export const accept = internalMutation({ args:{ token:v.string(), id:v.id("rental_item_swaps"), expectedDeltaPence:v.number() }, handler:async(ctx,args)=>{
  const account = await accountForToken(ctx,args.token), swap = await ctx.db.get(args.id);
  if (!account || account.blockedAt != null || !swap || swap.accountId !== account._id) throw Error("This equipment proposal is not available for your account.");
  await ownedBooking(ctx,account,swap.bookingId);
  if (swap.quote.deltaPence !== args.expectedDeltaPence) throw Error("The equipment quote changed. Review it again.");
  if (swap.status === "applied") return swap;
  if (["accepted","awaiting_payment","refund_pending"].includes(swap.status)) return swap;
  await assertFreshSharedStock(ctx);
  if (swap.status !== "awaiting_acceptance" || swap.expiresAt <= Date.now()) throw Error("This equipment proposal has expired.");
  const result = await calculate(ctx,swap.bookingId,swap.lineIndex,swap.newListingId,swap._id);
  if (result.quoteSnapshot !== swap.quoteSnapshot) throw Error("The rental or equipment quote changed. Ask the team for a fresh proposal.");
  const acceptedAt = Date.now(), acceptanceText = `I accept replacing ${swap.oldLine.qty} × ${swap.oldLine.title} with ${swap.newLine.qty} × ${swap.newLine.title} on the same dates. The card payment difference is £${(swap.quote.deltaPence/100).toFixed(2)} and any used credit restoration is shown in this proposal.`;
  const patch = { status:"accepted" as const, acceptedAt, acceptedEmail:account.email, acceptanceText, updatedAt:acceptedAt, expiresAt:acceptedAt+35*60000, reconcileAfter:acceptedAt+5*60000 };
  await ctx.db.patch(swap._id,patch); return {...swap,...patch};
} });

export const context = internalQuery({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{const swap=await ctx.db.get(id);return swap?{swap,booking:await ctx.db.get(swap.bookingId)}:null;}});
export const customerProposal=query({args:{token:v.string(),id:v.id("rental_item_swaps"),bookingId:v.id("bookings")},handler:async(ctx,args)=>{
  const account=await accountForToken(ctx,args.token);if(!account)return null;
  const swap=await ctx.db.get(args.id);if(!swap||swap.accountId!==account._id||swap.bookingId!==args.bookingId)return null;
  let booking;try{booking=await ownedBooking(ctx,account,args.bookingId);}catch{return null;}
  const receipt=["applied","refund_pending"].includes(swap.status)?await ctx.db.query("swap_stock_applied_receipts").withIndex("by_swap",q=>q.eq("swapId",swap._id)).unique():null;
  return {id:swap._id,oldTitle:swap.oldLine?.title??"Original item",newTitle:swap.newLine?.title??"Replacement item",quantity:swap.oldLine.qty,deltaPence:swap.quote.deltaPence,restoreCreditPence:swap.quote.restore.reduce((sum:number,item:any)=>sum+item.amountPence,0),status:swap.status,stockApplied:!!swap.stockAppliedAt,stockPending:receipt?.deliveryState==="pending"||receipt?.stockRisk===true||swap.status==="applied"&&booking.activeItemSwapId===swap._id,expiresAt:swap.expiresAt};
}});
export const list=query({args:{token:v.string(),bookingId:v.id("bookings"),admin:v.optional(v.boolean())},handler:async(ctx,args)=>{
  let rows;
  if(args.admin){if(!checkAdminToken(args.token))throw Error("unauthorized");rows=await ctx.db.query("rental_item_swaps").withIndex("by_booking",index=>index.eq("bookingId",args.bookingId)).order("desc").take(30);}
  else{const account=await accountForToken(ctx,args.token);if(!account)throw Error("Please sign in.");await ownedBooking(ctx,account,args.bookingId);rows=await ctx.db.query("rental_item_swaps").withIndex("by_booking_account",index=>index.eq("bookingId",args.bookingId).eq("accountId",account._id)).order("desc").take(30);}
  return Promise.all(rows.map(async row=>{const refund=args.admin&&row.refundJobId?await ctx.db.get(row.refundJobId):null;return {id:row._id,oldLine:row.oldLine,newLine:row.newLine,deltaPence:row.quote.deltaPence,restoreCreditPence:row.quote.restore.reduce((sum:number,item:any)=>sum+item.amountPence,0),status:row.status,expiresAt:row.expiresAt,acceptedAt:row.acceptedAt,paymentUrl:["accepted","awaiting_payment"].includes(row.status)?row.paymentUrl:undefined,...(args.admin?{reconcileError:row.reconcileError,paidStockReview:row.status==="review"&&!!row.paymentIntentId&&!row.compensationStartedAt&&row.quote.deltaPence>0,approvalUrl:refund?.refundReceipts?.find(receipt=>receipt.status==="awaiting_approval")?.approvalUrl??(row.compensationReceipt?.status==="awaiting_approval"?row.compensationReceipt.approvalUrl:undefined)}: {})};}));
}});

export const bindSession = internalMutation({args:{id:v.id("rental_item_swaps"),sessionId:v.string(),url:v.string()},handler:async(ctx,args)=>{const swap=await ctx.db.get(args.id);if(!swap||!swap.acceptedAt||swap.quote.deltaPence<=0||!["accepted","awaiting_payment","review"].includes(swap.status))throw Error("The accepted swap payment is unavailable.");await assertStockExecution(ctx,swap._id);if(swap.sessionId&&swap.sessionId!==args.sessionId)throw Error("The original swap payment cannot be replaced.");await ctx.db.patch(swap._id,{sessionId:args.sessionId,paymentUrl:args.url,status:"awaiting_payment",updatedAt:Date.now(),reconcileAfter:Date.now()+5*60000});}});

export const authorizeExecution=internalMutation({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{
  const swap=await ctx.db.get(id);
  if(!swap||!swap.acceptedAt||!swap.acceptanceText||!["accepted","awaiting_payment","refund_pending","refund_compensating","review"].includes(swap.status))throw Error("The equipment settlement needs review.");
  const booking=await ctx.db.get(swap.bookingId);
  if(!booking||booking.activeItemSwapId!==id||booking.status!=="confirmed"||booking.cancellationDecision||booking.returnDecision)throw Error("The rental changed before the equipment settlement.");
  const account=await ctx.db.get(swap.accountId);
  if(!account||account.blockedAt!=null||!belongsToRentalAccount(booking,account))throw Error("The rental account changed before the equipment settlement.");
  await assertStockExecution(ctx,id);
  return swap;
}});

export const prepareRefund = internalMutation({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{
  const swap=await ctx.db.get(id);if(!swap||!swap.acceptedAt||!swap.acceptanceText||swap.quote.deltaPence>=0||!["accepted","refund_pending","review"].includes(swap.status))throw Error("The accepted equipment refund is unavailable.");
  await assertStockExecution(ctx,id);
  if(!swap.stockAppliedAt)await assertFreshSharedStock(ctx);
  if(swap.refundJobId){const existing=await ctx.db.get(swap.refundJobId);if(!existing||existing.bookingId!==swap.bookingId||existing.amountPence!==-swap.quote.deltaPence)throw Error("The original refund receipt needs review.");return existing;}
  const booking=await ctx.db.get(swap.bookingId);if(!booking||booking.activeItemSwapId!==id||booking.cancellationDecision||booking.returnDecision||booking.status!=="confirmed")throw Error("The rental changed before the equipment refund.");
  const now=Date.now(),refundId=await ctx.db.insert("rental_refunds",{bookingId:booking._id,expectedAccountId:swap.accountId,requestId:`swap-${swap._id}`,amountPence:-swap.quote.deltaPence,reason:`Equipment swap: ${swap.oldLine.title} to ${swap.newLine.title}`.slice(0,400),status:"prepared",createdAt:now,updatedAt:now});
  await ctx.db.patch(id,{refundJobId:refundId,status:"refund_pending",updatedAt:now,reconcileAfter:now+5*60000});return await ctx.db.get(refundId);
}});

export const pending=internalQuery({args:{},handler:async(ctx)=>{const rows=[];for(const status of ["awaiting_acceptance","accepted","awaiting_payment","refund_pending","refund_compensating"] as const)rows.push(...await ctx.db.query("rental_item_swaps").withIndex("by_status_due",index=>index.eq("status",status).gte("reconcileAfter",0).lte("reconcileAfter",Date.now())).take(20));return rows;}});
export const reconcileResult=internalMutation({args:{id:v.id("rental_item_swaps"),expectedStatus:v.string(),expectedDue:v.number(),error:v.optional(v.string())},handler:async(ctx,args)=>{const swap=await ctx.db.get(args.id);if(!swap||swap.status!==args.expectedStatus||swap.reconcileAfter!==args.expectedDue||!["awaiting_acceptance","accepted","awaiting_payment","refund_pending","refund_compensating"].includes(swap.status))return;const attempts=args.error?(swap.reconcileAttempts??0)+1:0;await ctx.db.patch(swap._id,{reconcileAttempts:attempts,reconcileError:args.error?.slice(0,240),reconcileAfter:attempts>=3?undefined:Date.now()+(args.error?Math.min(30,2**attempts)*60000:5*60000),...(attempts>=3?{status:"review" as const}:{})});if(attempts>=3)await queueOwnerNotification(ctx,{eventKey:`swap-review:${swap._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment change needs review",body:swap.acceptedAt?"The equipment payment or refund could not finish. Check the original provider receipt before retrying.":"An unaccepted equipment proposal could not expire safely. Review the proposal before releasing its reservation."});}});
export const notifyApproval=internalMutation({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{const swap=await ctx.db.get(id);if(!swap||!swap.refundJobId&&!swap.compensationStartedAt)return;await queueOwnerNotification(ctx,{eventKey:`swap-refund-approval:${id}`,kind:"deposit_refund_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment refund needs approval",body:"Stripe requires approval for the equipment-change refund. Review the original request in Stripe."});}});
export const notifyConvertedStockRisk=internalMutation({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{const swap=await ctx.db.get(id);if(!swap||swap.quote.deltaPence>=0||!swap.stockAppliedAt||!swap.refundJobId)return;await queueOwnerNotification(ctx,{eventKey:`swap-converted-stock-risk:${id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment stock needs review",body:"The converted equipment change has a possible stock conflict. The existing refund must still complete; check availability separately."});}});
export const recordPaidStockReview=internalMutation({args:{id:v.id("rental_item_swaps"),sessionId:v.string(),paymentIntentId:v.string(),amountPence:v.number()},handler:async(ctx,args)=>{
 const swap=await ctx.db.get(args.id);
 if(!swap||!swap.acceptedAt||swap.quote.deltaPence<=0||swap.sessionId!==args.sessionId||swap.quote.deltaPence!==args.amountPence||!args.paymentIntentId||(swap.paymentIntentId&&swap.paymentIntentId!==args.paymentIntentId))throw Error("The equipment payment receipt does not match the accepted change.");
 if(swap.status==="applied")return {applied:true,already:true};
 if(swap.status==="refunded")return {refunded:true,already:true};
 if(swap.compensationStartedAt)return {review:true};
 if(!["awaiting_payment","review"].includes(swap.status))throw Error("The paid equipment change needs review.");
 await ctx.db.patch(swap._id,{status:"review",paymentIntentId:args.paymentIntentId,reconcileAfter:undefined,reconcileError:"Payment received; equipment availability needs review.",updatedAt:Date.now()});
 await queueOwnerNotification(ctx,{eventKey:`swap-paid-stock-review:${swap._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Paid equipment change needs stock review",body:"Payment was received, but the equipment change could not be confirmed. Check availability and the original payment before deciding how to proceed."});
 return {review:true};
}});
export const beginReviewedCompensation=internalMutation({args:{id:v.id("rental_item_swaps"),sessionId:v.string(),paymentIntentId:v.string(),amountPence:v.number(),reason:v.string()},handler:async(ctx,args)=>{
 const swap=await ctx.db.get(args.id),reason=args.reason.trim();
 if(!swap||!swap.acceptedAt||swap.quote.deltaPence<=0||swap.sessionId!==args.sessionId||swap.paymentIntentId!==args.paymentIntentId||swap.quote.deltaPence!==args.amountPence||reason.length<5||reason.length>400)throw Error("The reviewed equipment payment does not match.");
 if(swap.status==="refunded")return {refunded:true};
 if(swap.compensationStartedAt){if(swap.compensationReason!==reason)throw Error("The original refund reason cannot be changed.");return {compensating:true};}
 if(swap.status!=="review"||swap.stockAppliedAt||swap.refundJobId)throw Error("The equipment change is no longer awaiting paid stock review.");
 const now=Date.now();await ctx.db.patch(swap._id,{status:"refund_compensating",compensationStartedAt:now,compensationReason:reason,reconcileError:reason,updatedAt:now,reconcileAfter:now+5*60000});
 await queueOwnerNotification(ctx,{eventKey:`swap-compensation:${swap._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment change refund started",body:"The original additional payment is being returned after stock review. Check the refund status and any Stripe approval."});
 await queueOwnerNotification(ctx,{eventKey:`swap-refund-stock-claim:${swap._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Stock claim needs reconciliation",body:"The manager stock claim remains held even after the refund. Reconcile the original claim before treating that equipment as available."});
 return {compensating:true};
}});
export const asyncPaymentFailed=internalMutation({args:{id:v.id("rental_item_swaps"),sessionId:v.string(),amountPence:v.number(),currency:v.string()},handler:async(ctx,args)=>{const swap=await ctx.db.get(args.id);if(!swap||!swap.acceptedAt||swap.quote.deltaPence<=0||swap.quote.deltaPence!==args.amountPence||args.currency!=="gbp"||swap.sessionId&&swap.sessionId!==args.sessionId||!["accepted","awaiting_payment","review"].includes(swap.status))return;await ctx.db.patch(swap._id,{sessionId:args.sessionId,status:"review",reconcileAfter:undefined,reconcileError:"Stripe reported that the equipment payment failed.",updatedAt:Date.now()});await queueOwnerNotification(ctx,{eventKey:`swap-payment-failed:${swap._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment payment failed",body:"The equipment change remains unconfirmed. Check the original payment before releasing its reservation or retrying."});}});
export const resumeReview=internalMutation({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{const swap=await ctx.db.get(id);if(!swap||swap.status!=="review")throw Error("This equipment settlement does not need resuming.");if(!swap.acceptedAt&&(swap.compensationStartedAt||swap.refundJobId||swap.sessionId||swap.paymentIntentId))throw Error("The equipment settlement needs manual review.");const status=!swap.acceptedAt?"awaiting_acceptance" as const:swap.compensationStartedAt?"refund_compensating" as const:swap.refundJobId?"refund_pending" as const:swap.sessionId?"awaiting_payment" as const:"accepted" as const;await ctx.db.patch(id,{status,reconcileAttempts:0,reconcileError:undefined,reconcileAfter:status==="awaiting_acceptance"?Math.max(Date.now(),swap.expiresAt):Date.now()+5*60000});return await ctx.db.get(id);}});
export const beginCompensation=internalMutation({args:{id:v.id("rental_item_swaps"),sessionId:v.string(),paymentIntentId:v.string(),amountPence:v.number(),reason:v.string()},handler:async(ctx,args)=>{const swap=await ctx.db.get(args.id);if(!swap||!swap.acceptedAt||swap.quote.deltaPence<=0||swap.sessionId!==args.sessionId||swap.quote.deltaPence!==args.amountPence||(swap.paymentIntentId&&swap.paymentIntentId!==args.paymentIntentId))throw Error("The equipment payment cannot be reconciled.");if(swap.status==="applied"||swap.status==="refunded"){if(swap.paymentIntentId!==args.paymentIntentId)throw Error("The equipment payment receipt changed.");return swap.status==="applied"?{applied:true}:{refunded:true};}if(swap.compensationStartedAt){if(swap.paymentIntentId!==args.paymentIntentId)throw Error("The compensation payment identity changed.");return {compensating:true};}if(!["awaiting_payment","review"].includes(swap.status))throw Error("The equipment payment state needs review.");const now=Date.now();await ctx.db.patch(swap._id,{status:"refund_compensating",paymentIntentId:args.paymentIntentId,compensationStartedAt:now,reconcileError:args.reason.slice(0,240),updatedAt:now,reconcileAfter:now+5*60000});await queueOwnerNotification(ctx,{eventKey:`swap-compensation:${swap._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment change could not finish",body:"The equipment change could not be applied after payment. Its original payment is being returned; check the refund status."});return {compensating:true};}});
export const recordCompensation=internalMutation({args:{id:v.id("rental_item_swaps"),receipt:depositReturnReceipt},handler:async(ctx,args)=>{const swap=await ctx.db.get(args.id);if(!swap||!swap.compensationStartedAt||!["refund_compensating","review"].includes(swap.status)||args.receipt.paymentIntentId!==swap.paymentIntentId||args.receipt.amountPence!==swap.quote.deltaPence||args.receipt.attemptedAt!==swap.compensationStartedAt)throw Error("The compensation receipt does not match the equipment payment.");const old=swap.compensationReceipt;if(old&&(old.paymentIntentId!==args.receipt.paymentIntentId||old.attemptedAt!==args.receipt.attemptedAt||(old.stripeRefundId&&old.stripeRefundId!==args.receipt.stripeRefundId)||(old.approvalRequestId&&old.approvalRequestId!==args.receipt.approvalRequestId)))throw Error("The original compensation receipt cannot be replaced.");await ctx.db.patch(swap._id,{compensationReceipt:args.receipt,updatedAt:Date.now()});}});
export const finishCompensation=internalMutation({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{const swap=await ctx.db.get(id);if(!swap)throw Error("Equipment proposal missing.");if(swap.status==="refunded")return {refunded:true,already:true};if(!["refund_compensating","review"].includes(swap.status)||swap.compensationReceipt?.status!=="succeeded"||swap.compensationReceipt.paymentIntentId!==swap.paymentIntentId||swap.compensationReceipt.amountPence!==swap.quote.deltaPence)throw Error("The original equipment payment refund is not confirmed.");const booking=await ctx.db.get(swap.bookingId);const fenced=swapAuthorityAvailable()&&process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL==="true";if(!fenced){const rows=await ctx.db.query("reservations").withIndex("by_booking",index=>index.eq("bookingId",swap.bookingId)).collect();for(const row of rows)if(row.status==="hold"&&row.externalRef===`swap:${swap._id}`)await ctx.db.patch(row._id,{status:"cancelled"});if(booking?.activeItemSwapId===swap._id)await ctx.db.patch(booking._id,{activeItemSwapId:undefined});}await ctx.db.patch(swap._id,{status:"refunded",updatedAt:Date.now(),reconcileAfter:undefined});if(booking)await queueRmv2Sync(ctx,booking._id);if(fenced)await queueCompensatedRelease(ctx,swap._id);await notifySettlement(ctx,swap,booking,`The equipment change could not be completed. The additional £${(swap.quote.deltaPence/100).toFixed(2)} payment has been refunded to the original payment method; your existing equipment is unchanged.`,"equipment change refund",`The additional £${(swap.quote.deltaPence/100).toFixed(2)} payment was refunded. The existing equipment is unchanged.`);return {refunded:true};}});
export const close=internalMutation({args:{id:v.id("rental_item_swaps"),status:v.union(v.literal("withdrawn"),v.literal("expired")),expiredSessionId:v.optional(v.string())},handler:async(ctx,args)=>{const swap=await ctx.db.get(args.id);if(!swap||swap.refundJobId||swap.paymentIntentId)throw Error("The equipment settlement needs review before closing.");if(swap.status===args.status){await releaseClosedClaim(ctx,swap);return;}if(swap.status!=="awaiting_acceptance"&&!(swap.status==="awaiting_payment"&&swap.sessionId&&swap.sessionId===args.expiredSessionId))throw Error("The accepted equipment settlement needs review before closing.");const booking=await ctx.db.get(swap.bookingId);const claim=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",index=>index.eq("swapId",swap._id).eq("operation","acquire")).unique();if(!claim){const rows=await ctx.db.query("reservations").withIndex("by_booking",index=>index.eq("bookingId",swap.bookingId)).collect();for(const row of rows)if(row.status==="hold"&&row.externalRef===`swap:${swap._id}`)await ctx.db.patch(row._id,{status:"cancelled"});if(booking?.activeItemSwapId===swap._id)await ctx.db.patch(booking._id,{activeItemSwapId:undefined});}await ctx.db.patch(swap._id,{status:args.status,updatedAt:Date.now(),reconcileAfter:undefined});await releaseClosedClaim(ctx,{...swap,status:args.status});if(booking)await queueRmv2Sync(ctx,booking._id);}});

export const apply = internalMutation({args:{id:v.id("rental_item_swaps"),sessionId:v.optional(v.string()),paymentIntentId:v.optional(v.string()),amountPence:v.optional(v.number()),stageRefund:v.optional(v.boolean()),stockRisk:v.optional(v.boolean())},handler:async(ctx,args)=>{
  const swap=await ctx.db.get(args.id);if(!swap)throw Error("Equipment proposal missing.");if(swap.status==="applied"){if(swap.paymentIntentId!==args.paymentIntentId)throw Error("Equipment payment receipt mismatch.");return {applied:true,already:true};}
  await assertStockExecution(ctx,args.id);
  if(swap.stockAppliedAt){
    if(swap.quote.deltaPence>=0||!swap.refundJobId||!swap.creditsRestoredAt)throw Error("The staged equipment change needs review.");
    if(args.stageRefund)return {staged:true,already:true};
    const refund=await ctx.db.get(swap.refundJobId),booking=await ctx.db.get(swap.bookingId);
    if(!refund||refund.status!=="succeeded"||refund.amountPence!==-swap.quote.deltaPence||!booking||booking.activeItemSwapId!==swap._id)throw Error("The equipment refund must settle before completing the change.");
    const stockReceipt=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_swap",q=>q.eq("swapId",swap._id)).unique();
    const account=await ctx.db.get(swap.accountId);
    const stockConfirmed=!swapAuthorityAvailable()||process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL!=="true"||stockReceipt?.deliveryState==="acknowledged"&&stockReceipt.stockRisk!==true&&!args.stockRisk&&booking.status==="confirmed"&&booking.idVerifyStatus==="verified"&&(verificationValidUntil(booking)??0)>Date.now()&&!booking.cancellationDecision&&!booking.returnDecision&&!!account&&account.blockedAt==null&&belongsToRentalAccount(booking,account);
    if(stockConfirmed)await ctx.db.patch(booking._id,{activeItemSwapId:undefined});
    else if(stockReceipt?.deliveryState==="acknowledged")await ctx.db.patch(stockReceipt._id,{auditDueAt:Date.now(),auditAttempts:0});
    await ctx.db.patch(swap._id,{status:"applied",updatedAt:Date.now(),reconcileAfter:undefined});
    await notifySettlement(ctx,swap,booking,`${stockConfirmed?"Your equipment change is complete.":"Your equipment change is still being checked."} The £${(-swap.quote.deltaPence/100).toFixed(2)} refund was sent to the original payment method.`,"equipment change refund",`The £${(-swap.quote.deltaPence/100).toFixed(2)} refund for your equipment change was sent to the original payment method.`);
    return {applied:true};
  }
  await assertFreshSharedStock(ctx);
  if(!swap.acceptedAt||!swap.acceptanceText||!["accepted","awaiting_payment","refund_pending","review"].includes(swap.status))throw Error("The renter must accept the equipment change first.");
  if(swap.quote.deltaPence>0&&(swap.sessionId!==args.sessionId||!args.paymentIntentId||args.amountPence!==swap.quote.deltaPence||swap.paymentIntentId&&swap.paymentIntentId!==args.paymentIntentId))throw Error("The equipment payment receipt does not match the accepted quote.");
  if(swap.quote.deltaPence<0){const refund=swap.refundJobId?await ctx.db.get(swap.refundJobId):null;if(!args.stageRefund||!refund||refund.status!=="prepared"||refund.amountPence!==-swap.quote.deltaPence)throw Error("The equipment change must be staged before its refund starts.");}
  else if(args.stageRefund)throw Error("Only a downgrade can be staged for refund.");
  const booking=await ctx.db.get(swap.bookingId);if(!booking||booking.activeItemSwapId!==swap._id||booking.status!=="confirmed"||booking.cancellationDecision||booking.returnDecision)throw Error("The rental changed during settlement and needs review.");
  const account=await ctx.db.get(swap.accountId);if(!account||!belongsToRentalAccount(booking,account)||account.blockedAt!=null)throw Error("The rental account changed or needs review before applying this equipment change.");
  const lines=bookingStockLines(booking).map((line:any,index:number)=>index===swap.lineIndex?swap.newLine:line);
  if(JSON.stringify(canonicalFunding(bookingStockLines(booking)[swap.lineIndex]))!==JSON.stringify(canonicalFunding(swap.oldLine)))throw Error("The original equipment changed during settlement.");
  const currentFunding=await quoteSwapFunding(ctx,booking,swap.lineIndex,swap.newLine);
  if(JSON.stringify(canonicalFunding(currentFunding))!==JSON.stringify(canonicalFunding(swap.quote)))throw Error("The equipment funding changed during settlement and needs review.");
  await assertRenterExposure(ctx,booking,lines);const values=await securityValues(ctx,booking,lines);await applySwapStock(ctx,booking,swap.oldLine,swap.newLine,lines,swap._id);
  if(swap.creditsRestoredAt)throw Error("The credit restoration marker needs review.");
  const creditBalances=adjustedSwapCreditBalances(booking,swap.quote.restore);
  await restoreSwapCredit(ctx,booking,String(swap._id),swap.quote.restore,Date.now());
  const funding=[...(swap.quote.nextAllFunding??booking.checkoutLineFunding!)];funding[swap.lineIndex]=swap.quote.nextFunding;
  const sources=swap.quote.nextAllCreditSources??[...(booking.checkoutLineCreditSources??[]).filter((source:any)=>source.lineIndex!==swap.lineIndex),...swap.quote.nextCreditSources];
  const now=Date.now(),staging=swap.quote.deltaPence<0;
  const updatedDiscount=swap.quote.nextAllFunding?funding.reduce((sum:number,row:any)=>sum+Math.round(row.discount*100),0)/100:Math.round(((booking.discount??0)-booking.checkoutLineFunding![swap.lineIndex].discount+swap.quote.nextFunding.discount)*100)/100;
  const fenced=swapAuthorityAvailable()&&process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL==="true";
  await ctx.db.patch(booking._id,{...creditBalances,lineItems:lines,replacementValues:values,subtotal:Math.round((booking.subtotal+swap.newLine.lineTotal-swap.oldLine.lineTotal)*100)/100,discount:updatedDiscount,total:Math.round((booking.total+Math.max(0,swap.quote.deltaPence)/100)*100)/100,checkoutLineFunding:funding,checkoutLineCreditSources:sources,...(!staging&&!fenced?{activeItemSwapId:undefined}:{})});
  await ctx.db.patch(swap._id,{status:staging?"refund_pending":"applied",paymentIntentId:args.paymentIntentId,creditsRestoredAt:now,...(staging?{stockAppliedAt:now,reconcileAfter:now+5*60000}:{reconcileAfter:undefined}),updatedAt:now});
  await postRentalMessage(ctx,{accountId:swap.accountId,bookingId:swap.bookingId,sender:"system",text:fenced?`We are checking availability for your equipment change.${staging?" Your refund is being processed.":""}`:staging?`Your equipment change is confirmed: ${swap.oldLine.qty} × ${swap.oldLine.title} has been replaced with ${swap.newLine.qty} × ${swap.newLine.title}. Your refund is being processed.`:`Your equipment change is confirmed: ${swap.oldLine.qty} × ${swap.oldLine.title} has been replaced with ${swap.newLine.qty} × ${swap.newLine.title}.`});
  await queueRmv2Sync(ctx,booking._id);
  const savedBooking=await ctx.db.get(booking._id);
  const claim=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",q=>q.eq("swapId",swap._id).eq("operation","acquire")).unique();
  const execution=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",q=>q.eq("swapId",swap._id).eq("operation","beginExecution")).unique();
  if(!savedBooking||!Number.isSafeInteger(savedBooking.rmv2Revision)||!claim?.receipt?.requestId||!claim.receipt.fingerprint||!execution?.request?.args?.executionKey||await ctx.db.query("swap_stock_applied_receipts").withIndex("by_swap",q=>q.eq("swapId",swap._id)).unique())throw Error("The equipment stock receipt needs reconciliation.");
  const allocations=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",booking._id)).collect();
  const windows=[];
  for(const allocation of allocations.filter(row=>row.source==="site"&&row.status==="confirmed")){
    const unit=await ctx.db.get(allocation.inventoryUnitId);
    if(!unit||!Number.isSafeInteger(allocation.start)||!Number.isSafeInteger(allocation.end)||!Number.isSafeInteger(allocation.qty)||allocation.qty<1)throw Error("The equipment stock receipt needs reconciliation.");
    windows.push({reservationId:allocation._id,inventoryUnitId:allocation.inventoryUnitId,...(unit.rmv2ItemId?{managerItemId:unit.rmv2ItemId}:{}),start:allocation.start,end:allocation.end,quantity:allocation.qty,...(allocation.endExclusive!==undefined?{endExclusive:allocation.endExclusive}:{}),...(allocation.turnaroundBufferMinutes!==undefined?{turnaroundBufferMinutes:allocation.turnaroundBufferMinutes}:{})});
  }
  if(!windows.length||windows.length>256)throw Error("The equipment stock receipt needs reconciliation.");
  await ctx.db.insert("swap_stock_applied_receipts",{swapId:swap._id,bookingId:booking._id,bookingRevision:savedBooking.rmv2Revision!,managerRequestId:claim.receipt.requestId,fingerprint:claim.receipt.fingerprint,executionKey:execution.request.args.executionKey,appliedAt:now,deliveryState:"pending",windows});
  if(!fenced)await ctx.scheduler.runAfter(0,internal.notify.changeEmail,{bookingId:booking._id,expectedAccountId:swap.accountId,kind:"equipment updated",detail:`${swap.oldLine.qty} × ${swap.oldLine.title} replaced by ${swap.newLine.qty} × ${swap.newLine.title}.${staging?" Your refund is being processed.":""}`});return staging?{staged:true}:{applied:true};
} });
