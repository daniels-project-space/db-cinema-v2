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
import { adjustedSwapCreditBalances, quoteSwapBasketFunding, quoteSwapFunding, restoreSwapCredit } from "./lib/rentalSwapFunding";
import { reserveSwapBasketStock, reserveSwapStock, applySwapBasketStock, applySwapStock } from "./lib/rentalSwapStock";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { queueOwnerNotification } from "./lib/adminPush";
import { listingRentalImages } from "./lib/catalogImages";
import { depositReturnReceipt } from "./lib/depositReturnReceipt";
import { assertFreshSharedStock } from "./lib/shared_stock_sync";
import { assertSwapAuthorityAvailable, swapAuthorityAvailable } from "./lib/rentalSwapAuthority";
import { assertStockExecution, releaseClosedClaim, queueCompensatedRelease } from "./swapStockOperations";
import { initialInvoiceSnapshot } from "./lib/initialInvoiceSnapshot";

const PAID_STOCK_RETRY_ERROR = "Payment received; equipment availability needs review.";

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

function moneyPence(value:any):number {
  const pence=Math.round(Number(value)*100);
  if(!Number.isSafeInteger(pence)||pence<0)throw Error("The item-change invoice needs review.");
  return pence;
}

async function recordSwapAdjustment(ctx:any,swap:any,booking:any,account:any,issuedAt:number,requiresStockAck:boolean) {
  const existing=await ctx.db.query("rental_swap_adjustment_receipts").withIndex("by_swap",(q:any)=>q.eq("swapId",swap._id)).unique();
  if(existing)return existing._id;
  const changes=(swap.changes?.length?swap.changes:[{lineIndex:swap.lineIndex,oldLine:swap.oldLine,newLine:swap.newLine}]).map((change:any)=>({
    lineIndex:change.lineIndex,
    oldTitle:String(change.oldLine?.title??"Previous rental item").slice(0,180),
    newTitle:String(change.newLine?.title??"Updated rental item").slice(0,180),
    oldQty:Number(change.oldLine?.qty??1),
    newQty:Number(change.newLine?.qty??1),
    oldLineTotalPence:moneyPence(change.oldLine?.lineTotal),
    newLineTotalPence:moneyPence(change.newLine?.lineTotal),
  }));
  if(!changes.length||changes.some((change:any)=>!Number.isSafeInteger(change.lineIndex)||change.lineIndex<0||!Number.isSafeInteger(change.oldQty)||change.oldQty<1||!Number.isSafeInteger(change.newQty)||change.newQty<1))throw Error("The item-change invoice needs review.");
  const delta=swap.quote?.deltaPence;
  if(!Number.isSafeInteger(delta))throw Error("The item-change invoice needs review.");
  const restored=swap.quote?.restore??[];
  if(!Array.isArray(restored))throw Error("The item-change credit receipt needs review.");
  const accountCreditRestoredPence=restored.reduce((sum:number,row:any)=>{
    if(!Number.isSafeInteger(row.amountPence)||row.amountPence<0)throw Error("The item-change credit receipt needs review.");
    return sum+row.amountPence;
  },0);
  const recipientEmail=String(booking.guestEmail??account?.email??"").trim();
  return await ctx.db.insert("rental_swap_adjustment_receipts",{
    swapId:swap._id,bookingId:booking._id,accountId:swap.accountId,...(recipientEmail?{recipientEmail}:{}),
    originalInvoiceNumber:`DBC-${String(booking._id).slice(-8).toUpperCase()}`,issuedAt,currency:"GBP",changes,
    cardChargePence:Math.max(0,delta),cardRefundPence:Math.max(0,-delta),accountCreditRestoredPence,requiresStockAck,
    emailState:"pending",lastAttemptAt:0,
  });
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
  await assertSwapStockReconciled(ctx, bookingId, ownSwapId);
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

async function calculateBasket(ctx: any, bookingId: any, edits: { lineIndex: number; newListingId: any }[], ownSwapId?: any) {
  await assertFreshSharedStock(ctx);
  const booking = await ctx.db.get(bookingId);
  if (!booking || booking.status !== "confirmed" || booking.cancellationDecision || booking.returnDecision || booking.activeAdditionId || booking.activeDeliveryQuoteId || booking.activeExtensionId || booking.activePriceAdjustmentId || booking.activeItemSwapId && booking.activeItemSwapId !== ownSwapId) throw Error("Finish the current rental operation before changing equipment.");
  await assertSwapStockReconciled(ctx, bookingId, ownSwapId);
  if (!Array.isArray(edits) || edits.length < 2 || edits.length > 16) throw Error("Choose between two and sixteen item changes.");
  const originalLines = bookingStockLines<any>(booking), lines = [...originalLines], seen = new Set<number>(), changes: any[] = [], pricingSnapshots = [];
  for (const edit of [...edits].sort((left, right) => left.lineIndex - right.lineIndex)) {
    if (!Number.isSafeInteger(edit.lineIndex) || edit.lineIndex < 0 || edit.lineIndex >= originalLines.length || seen.has(edit.lineIndex)) throw Error("Choose each original rental item once.");
    seen.add(edit.lineIndex);
    const oldLine = originalLines[edit.lineIndex];
    if (String(oldLine.listingId) === String(edit.newListingId)) throw Error("Choose a different replacement for each selected item.");
    const listing = await ctx.db.get(edit.newListingId);
    if (!listing || !listing.active || listing.suppressed || listing.marketingOnly || !listing.components?.length) throw Error("A replacement item is unavailable.");
    const days = rentalPricingDays(oldLine.start, oldLine.end, oldLine.pickupTime, oldLine.returnTime);
    const newLine = { ...oldLine, listingId: listing._id, title: listing.title, lineTotal: quote(listing.pricing, days).total * oldLine.qty, dailyRate: listing.pricing.daily * oldLine.qty };
    lines[edit.lineIndex] = newLine;
    changes.push({ lineIndex: edit.lineIndex, oldListingId: oldLine.listingId, newListingId: listing._id, oldLine, newLine });
    pricingSnapshots.push({ listingId: listing._id, pricing: listing.pricing, components: listing.components });
  }
  await assertRentalInventory(ctx, lines, booking._id);
  await assertRenterExposure(ctx, booking, lines);
  const values = await securityValues(ctx, booking, lines);
  const refunds = await ctx.db.query("rental_refunds").withIndex("by_booking", (index: any) => index.eq("bookingId", bookingId)).take(101);
  if (refunds.length > 100 || refunds.some((item: any) => ["prepared", "pending"].includes(item.status))) throw Error("The rental refund history needs review before changing equipment.");
  const funding = await quoteSwapBasketFunding(ctx, booking, changes.map(change => ({ lineIndex: change.lineIndex, oldLine: change.oldLine, newLine: change.newLine })));
  const snapshot = rentalControlsSnapshot({ ...booking, activeItemSwapId: undefined }, refunds);
  const quoteSnapshot = JSON.stringify([snapshot, changes, pricingSnapshots, lines, funding]);
  return { booking, originalLines, lines, changes, values, funding, snapshot, quoteSnapshot };
}

function equipmentChangeSummary(changes: any[]) {
  return changes.map(change => `${change.oldLine.qty} × ${change.oldLine.title} → ${change.newLine.qty} × ${change.newLine.title}`).join("; ").slice(0, 1200);
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

export const previewBasketForAdmin=query({args:{token:v.string(),bookingId:v.id("bookings"),changes:v.array(v.object({lineIndex:v.number(),newListingId:v.id("listings")}))},handler:async(ctx,args)=>{
  if(!checkAdminToken(args.token))return null;
  try{enabled();const result=await calculateBasket(ctx,args.bookingId,args.changes);return {ok:true as const,changes:result.changes,quote:result.funding,quoteSnapshot:result.quoteSnapshot};}
  catch{return {ok:false as const,error:"This combined change cannot be quoted safely. Check the items, availability, account credits, security and any open rental changes."};}
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

export const proposeBasket = mutation({args:{token:v.string(),bookingId:v.id("bookings"),changes:v.array(v.object({lineIndex:v.number(),newListingId:v.id("listings")})),requestId:v.string(),quoteSnapshot:v.string(),confirmed:v.boolean()},handler:async(ctx,args)=>{
  enabled();await assertAdmin(ctx,args.token,"rentalSwapState.proposeBasket");
  if(!args.confirmed||!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId))throw Error("Review and confirm the combined equipment proposal first.");
  const prior=await ctx.db.query("rental_item_swaps").withIndex("by_request",index=>index.eq("bookingId",args.bookingId).eq("requestId",args.requestId)).unique();
  if(prior){if(prior.quoteSnapshot!==args.quoteSnapshot||!prior.changes?.length)throw Error("This request belongs to a different equipment proposal.");return prior._id;}
  const result=await calculateBasket(ctx,args.bookingId,args.changes);
  if(result.quoteSnapshot!==args.quoteSnapshot)throw Error("The combined equipment quote changed. Review it again.");
  const account=await accountForRental(ctx,result.booking);
  if(!account||account.blockedAt!=null||String(result.booking.accountId)!==String(account._id))throw Error("An owned rental account is required for this proposal.");
  const first=result.changes[0],now=Date.now(),expiresAt=now+24*3600000;
  const id=await ctx.db.insert("rental_item_swaps",{bookingId:args.bookingId,accountId:account._id,requestId:args.requestId,baseSnapshot:result.snapshot,quoteSnapshot:args.quoteSnapshot,lineIndex:first.lineIndex,oldListingId:first.oldListingId,newListingId:first.newListingId,oldLine:first.oldLine,newLine:first.newLine,changes:result.changes,quote:result.funding,status:"awaiting_acceptance",createdAt:now,updatedAt:now,expiresAt,reconcileAfter:expiresAt});
  await reserveSwapBasketStock(ctx,result.booking,result.originalLines,result.lines,id,expiresAt);
  await ctx.db.patch(args.bookingId,{activeItemSwapId:id});
  const delta=result.funding.deltaPence,difference=delta>0?"Additional card payment: £"+(delta/100).toFixed(2)+".":delta<0?"Refund to the original card: £"+(-delta/100).toFixed(2)+".":"No card payment difference.";
  const restored=result.funding.restore.reduce((sum:number,row:any)=>sum+row.amountPence,0);
  await postRentalMessage(ctx,{accountId:account._id,bookingId:args.bookingId,sender:"system",text:"The team proposed these equipment changes: "+equipmentChangeSummary(result.changes)+". "+difference+(restored?" £"+(restored/100).toFixed(2)+" of previously used account credit will be restored.":"")+" Review and accept the combined change before it proceeds. Nothing has been charged or refunded yet.",meta:{kind:"rental_item_swap",swapId:id}});
  await queueRmv2Sync(ctx,args.bookingId);return id;
}});

export const accept = internalMutation({ args:{ token:v.string(), id:v.id("rental_item_swaps"), expectedDeltaPence:v.number() }, handler:async(ctx,args)=>{
  const account = await accountForToken(ctx,args.token), swap = await ctx.db.get(args.id);
  if (!account || account.blockedAt != null || !swap || swap.accountId !== account._id) throw Error("This equipment proposal is not available for your account.");
  await ownedBooking(ctx,account,swap.bookingId);
  if (swap.quote.deltaPence !== args.expectedDeltaPence) throw Error("The equipment quote changed. Review it again.");
  if (swap.status === "applied") return swap;
  if (["accepted","awaiting_payment","refund_pending"].includes(swap.status)) return swap;
  await assertFreshSharedStock(ctx);
  if (swap.status !== "awaiting_acceptance" || swap.expiresAt <= Date.now()) throw Error("This equipment proposal has expired.");
  const result = swap.changes?.length
    ? await calculateBasket(ctx,swap.bookingId,swap.changes.map((change:any)=>({lineIndex:change.lineIndex,newListingId:change.newListingId})),swap._id)
    : await calculate(ctx,swap.bookingId,swap.lineIndex,swap.newListingId,swap._id);
  if (result.quoteSnapshot !== swap.quoteSnapshot) throw Error("The rental or equipment quote changed. Ask the team for a fresh proposal.");
  const description = swap.changes?.length ? equipmentChangeSummary(swap.changes) : `${swap.oldLine.qty} × ${swap.oldLine.title} → ${swap.newLine.qty} × ${swap.newLine.title}`;
  const acceptedAt = Date.now(), acceptanceText = swap.changes?.length
    ? `I accept these equipment changes on the same rental dates: ${description}. The net card difference is £${(swap.quote.deltaPence/100).toFixed(2)} and any used credit restoration is shown in this proposal.`
    : `I accept replacing ${swap.oldLine.qty} × ${swap.oldLine.title} with ${swap.newLine.qty} × ${swap.newLine.title} on the same dates. The card payment difference is £${(swap.quote.deltaPence/100).toFixed(2)} and any used credit restoration is shown in this proposal.`;
  const patch = { status:"accepted" as const, acceptedAt, acceptedEmail:account.email, acceptanceText, updatedAt:acceptedAt, expiresAt:acceptedAt+35*60000, reconcileAfter:acceptedAt+5*60000 };
  await ctx.db.patch(swap._id,patch); return {...swap,...patch};
} });

export const context = internalQuery({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{const swap=await ctx.db.get(id);return swap?{swap,booking:await ctx.db.get(swap.bookingId)}:null;}});
export const customerProposal=query({args:{token:v.string(),id:v.id("rental_item_swaps"),bookingId:v.id("bookings")},handler:async(ctx,args)=>{
  const account=await accountForToken(ctx,args.token);if(!account)return null;
  const swap=await ctx.db.get(args.id);if(!swap||swap.accountId!==account._id||swap.bookingId!==args.bookingId)return null;
  let booking;try{booking=await ownedBooking(ctx,account,args.bookingId);}catch{return null;}
  const receipt=["applied","refund_pending"].includes(swap.status)?await ctx.db.query("swap_stock_applied_receipts").withIndex("by_swap",q=>q.eq("swapId",swap._id)).unique():null;
  const photoSources=async(listingId:any)=>listingRentalImages(listingId?await ctx.db.get(listingId):null);
  const changes=swap.changes?.length?await Promise.all(swap.changes.map(async(change:any)=>({oldTitle:change.oldLine.title,newTitle:change.newLine.title,quantity:change.oldLine.qty,oldImageSources:await photoSources(change.oldListingId),newImageSources:await photoSources(change.newListingId)}))):null;
  const [oldImageSources,newImageSources]=changes?[[],[]]:await Promise.all([photoSources(swap.oldListingId),photoSources(swap.newListingId)]);
  return {id:swap._id,oldTitle:swap.oldLine?.title??"Original item",newTitle:swap.newLine?.title??"Replacement item",quantity:swap.oldLine.qty,oldImageSources,newImageSources,changes,deltaPence:swap.quote.deltaPence,restoreCreditPence:swap.quote.restore.reduce((sum:number,item:any)=>sum+item.amountPence,0),status:swap.status,stockApplied:!!swap.stockAppliedAt,stockPending:receipt?.deliveryState==="pending"||receipt?.stockRisk===true||swap.status==="applied"&&booking.activeItemSwapId===swap._id,expiresAt:swap.expiresAt};
}});
export const list=query({args:{token:v.string(),bookingId:v.id("bookings"),admin:v.optional(v.boolean())},handler:async(ctx,args)=>{
  let rows;
  if(args.admin){if(!checkAdminToken(args.token))throw Error("unauthorized");rows=await ctx.db.query("rental_item_swaps").withIndex("by_booking",index=>index.eq("bookingId",args.bookingId)).order("desc").take(30);}
  else{const account=await accountForToken(ctx,args.token);if(!account)throw Error("Please sign in.");await ownedBooking(ctx,account,args.bookingId);rows=await ctx.db.query("rental_item_swaps").withIndex("by_booking_account",index=>index.eq("bookingId",args.bookingId).eq("accountId",account._id)).order("desc").take(30);}
  return Promise.all(rows.map(async row=>{
    const refund=args.admin&&row.refundJobId?await ctx.db.get(row.refundJobId):null;
    const paidStockReview=row.status==="review"&&!!row.paymentIntentId&&!row.compensationStartedAt&&row.quote.deltaPence>0;
    return {
      id:row._id,oldLine:row.oldLine,newLine:row.newLine,changes:row.changes??null,
      deltaPence:row.quote.deltaPence,restoreCreditPence:row.quote.restore.reduce((sum:number,item:any)=>sum+item.amountPence,0),
      status:row.status,expiresAt:row.expiresAt,acceptedAt:row.acceptedAt,
      paymentUrl:["accepted","awaiting_payment"].includes(row.status)?row.paymentUrl:undefined,
      ...(args.admin?{
        reconcileError:row.reconcileError,paidStockReview,
        autoStockRetry:paidStockReview&&row.reconcileError===PAID_STOCK_RETRY_ERROR&&typeof row.reconcileAfter==="number",
        failedRefund:row.status==="review"&&refund?.status==="failed"&&refund.parts?.some((part:any)=>part.status==="failed")===true,
        refundAmbiguity:refund?.refundAmbiguity?{paymentIntentId:refund.refundAmbiguity.paymentIntentId,successfulRefundId:refund.refundAmbiguity.successfulRefundId,retryAttemptKey:refund.refundAmbiguity.retryAttemptKey}:undefined,
        approvalUrl:refund?.refundReceipts?.find(receipt=>receipt.status==="awaiting_approval")?.approvalUrl??(row.compensationReceipt?.status==="awaiting_approval"?row.compensationReceipt.approvalUrl:undefined),
      }:{}),
    };
  }));
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
  const result=swap.changes?.length
    ? await calculateBasket(ctx,booking._id,swap.changes.map((change:any)=>({lineIndex:change.lineIndex,newListingId:change.newListingId})),swap._id)
    : await calculate(ctx,booking._id,swap.lineIndex,swap.newListingId,swap._id);
  if(result.quoteSnapshot!==swap.quoteSnapshot)throw Error("The equipment quote changed before its refund. Review the proposal again.");
  const summary=swap.changes?.length?equipmentChangeSummary(swap.changes):`${swap.oldLine.title} to ${swap.newLine.title}`;
  const now=Date.now(),refundId=await ctx.db.insert("rental_refunds",{bookingId:booking._id,expectedAccountId:swap.accountId,requestId:`swap-${swap._id}`,amountPence:-swap.quote.deltaPence,reason:`Equipment change: ${summary}`.slice(0,400),status:"prepared",createdAt:now,updatedAt:now});
  await ctx.db.patch(id,{refundJobId:refundId,status:"refund_pending",updatedAt:now,reconcileAfter:now+5*60000});return await ctx.db.get(refundId);
}});

function assertSuccessfulSwapRefund(refund:any,swap:any) {
  const expected=-swap.quote.deltaPence,allocations=refund?.allocations,parts=refund?.parts;
  if(!refund||refund.refundAmbiguity||refund.bookingId!==swap.bookingId||refund.expectedAccountId!==swap.accountId||refund.requestId!==`swap-${swap._id}`||refund.status!=="succeeded"||refund.amountPence!==expected||!Array.isArray(allocations)||!allocations.length||!Array.isArray(parts)||parts.length!==allocations.length||allocations.reduce((sum:number,row:any)=>sum+row.amountPence,0)!==expected)throw Error("The exact equipment refund must succeed without conflicting Stripe receipts before the downgrade can be applied.");
  for(const allocation of allocations){
    const part=parts.find((row:any)=>row.paymentIntentId===allocation.paymentIntentId);
    if(!Number.isSafeInteger(allocation.amountPence)||allocation.amountPence<=0||!part||part.status!=="succeeded"||part.amountPence!==allocation.amountPence||typeof part.stripeRefundId!=="string"||!part.stripeRefundId)throw Error("The exact equipment refund must succeed before the downgrade can be applied.");
  }
}

export const recordRefundedChangeReview=internalMutation({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{
  const swap=await ctx.db.get(id);
  if(!swap||swap.quote.deltaPence>=0||!swap.refundJobId)throw Error("The refunded equipment change needs review.");
  const refund=await ctx.db.get(swap.refundJobId);
  assertSuccessfulSwapRefund(refund,swap);
  if(swap.status==="applied"||swap.status==="refunded")return {status:swap.status,already:true};
  if(!["refund_pending","review"].includes(swap.status))throw Error("The equipment refund is not ready for application review.");
  const reviewError="Stripe refund succeeded, but the equipment change is not confirmed.";
  if(swap.status==="review"&&swap.reconcileError===reviewError&&!swap.reconcileAfter)return {status:"review",already:true};
  const now=Date.now(),booking=await ctx.db.get(swap.bookingId),account=await ctx.db.get(swap.accountId);
  await ctx.db.patch(swap._id,{status:"review",reconcileAttempts:0,reconcileError:reviewError,reconcileAfter:undefined,updatedAt:now});
  await queueOwnerNotification(ctx,{eventKey:`swap-refund-application:${swap._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Refunded equipment change needs reconciliation",body:"The Stripe refund succeeded, but the replacement has not been confirmed. Keep the rental locked and reconcile stock before resolving the change. Do not issue another refund."});
  if(booking?.activeItemSwapId===swap._id&&belongsToRentalAccount(booking,account))await postRentalMessage(ctx,{accountId:swap.accountId,bookingId:swap.bookingId,sender:"system",text:`Your £${(-swap.quote.deltaPence/100).toFixed(2)} refund was processed, but the equipment change is not confirmed. The team is reconciling stock. Please wait for our update before relying on changed equipment details.`});
  return {status:"review"};
}});

export const pending=internalQuery({args:{},handler:async(ctx)=>{
  const rows=[];
  for(const status of ["awaiting_acceptance","accepted","awaiting_payment","refund_pending","refund_compensating"] as const)
    rows.push(...await ctx.db.query("rental_item_swaps").withIndex("by_status_due",index=>index.eq("status",status).gte("reconcileAfter",0).lte("reconcileAfter",Date.now())).take(20));
  rows.push(...await ctx.db.query("rental_item_swaps").withIndex("by_status_error_due",index=>index.eq("status","review").eq("reconcileError",PAID_STOCK_RETRY_ERROR).gte("reconcileAfter",0).lte("reconcileAfter",Date.now())).take(20));
  return rows;
}});
export const reconcileResult=internalMutation({args:{id:v.id("rental_item_swaps"),expectedStatus:v.string(),expectedDue:v.number(),error:v.optional(v.string())},handler:async(ctx,args)=>{
  const swap=await ctx.db.get(args.id);
  const retryingPaidStock=swap?.status==="review"&&swap.reconcileError===PAID_STOCK_RETRY_ERROR;
  if(!swap||swap.status!==args.expectedStatus||swap.reconcileAfter!==args.expectedDue||!(["awaiting_acceptance","accepted","awaiting_payment","refund_pending","refund_compensating"].includes(swap.status)||retryingPaidStock))return;
  const attempts=args.error?(swap.reconcileAttempts??0)+1:0;
  const terminal=attempts>=3;
  const delay=args.error?Math.min(30,2**attempts)*60000:5*60000;
  await ctx.db.patch(swap._id,{
    reconcileAttempts:attempts,
    reconcileError:retryingPaidStock?PAID_STOCK_RETRY_ERROR:args.error?.slice(0,240),
    reconcileAfter:terminal?undefined:Date.now()+delay,
    ...(terminal?{status:"review" as const}:{}),
  });
  if(terminal){
    await queueOwnerNotification(ctx,{
      eventKey:retryingPaidStock?`swap-paid-stock-review:${swap._id}`:`swap-review:${swap._id}`,
      kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,
      title:retryingPaidStock?"Paid equipment change needs stock review":"Equipment change needs review",
      body:retryingPaidStock
        ?"Three automatic checks could not confirm the equipment change. The original payment is recorded once and the rental remains locked. Check Rental Manager before taking further action; do not charge the renter again."
        :swap.acceptedAt?"The equipment payment or refund could not finish. Check the original provider receipt before retrying.":"An unaccepted equipment proposal could not expire safely. Review the proposal before releasing its reservation.",
    });
  }else if(retryingPaidStock&&args.error){
    await ctx.scheduler.runAfter(delay,internal.rentalSwapPayments.reconcile,{});
  }
}});
export const notifyApproval=internalMutation({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{const swap=await ctx.db.get(id);if(!swap||!swap.refundJobId&&!swap.compensationStartedAt)return;await queueOwnerNotification(ctx,{eventKey:`swap-refund-approval:${id}`,kind:"deposit_refund_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment refund needs approval",body:"Stripe requires approval for the equipment-change refund. Review the original request in Stripe."});}});
export const markRefundFailureReview=internalMutation({args:{id:v.id("rental_item_swaps"),refundJobId:v.id("rental_refunds"),paymentIntentId:v.string(),stripeRefundId:v.string()},handler:async(ctx,args)=>{
  const swap=await ctx.db.get(args.id),refund=await ctx.db.get(args.refundJobId);
  if(!swap||swap.refundJobId!==args.refundJobId||!refund||refund.bookingId!==swap.bookingId)throw Error("The failed equipment refund is not linked to this rental.");
  const allocation=refund.allocations?.find((row:any)=>row.paymentIntentId===args.paymentIntentId),part=refund.parts?.find((row:any)=>row.paymentIntentId===args.paymentIntentId);
  if(!allocation||!part||allocation.amountPence!==part.amountPence||part.stripeRefundId!==args.stripeRefundId||part.status!=="failed")throw Error("The failed Stripe refund receipt needs review.");
  const reviewError="Stripe reported a failed equipment-change refund. Reconcile the provider receipt before resuming.";
  if(swap.status==="review"&&swap.reconcileError===reviewError&&!swap.reconcileAfter)return {status:"review",already:true};
  if(!["refund_pending","review"].includes(swap.status))throw Error("The equipment refund is no longer awaiting settlement.");
  await ctx.db.patch(swap._id,{status:"review",reconcileAttempts:0,reconcileError:reviewError,reconcileAfter:undefined,updatedAt:Date.now()});
  await queueOwnerNotification(ctx,{eventKey:`swap-refund-failed:${swap._id}:${args.paymentIntentId}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment refund failed",body:"Stripe returned a failed refund. The equipment settlement remains locked; verify the provider receipt before taking further action."});
  if(refund.status!=="failed"){
    const booking=await ctx.db.get(swap.bookingId);
    if(booking)await notifySettlement(ctx,swap,booking,"Your equipment change is recorded, but we could not confirm the refund. The team is reviewing it and will update you here. Please do not make another payment.","equipment change refund","The equipment-change refund needs review before we can confirm it. The team will update the rental conversation.");
  }
  return {status:"review"};
}});
export const markRefundAmbiguityReview=internalMutation({args:{id:v.id("rental_item_swaps"),refundJobId:v.id("rental_refunds")},handler:async(ctx,args)=>{
  const swap=await ctx.db.get(args.id),refund=await ctx.db.get(args.refundJobId);
  if(!swap||swap.refundJobId!==args.refundJobId||!refund||refund.bookingId!==swap.bookingId||!refund.refundAmbiguity)throw Error("Conflicting Stripe refund receipts are not linked to this equipment change.");
  const reviewError="Stripe reported success for an earlier refund after a retry began.";
  const now=Date.now(),booking=await ctx.db.get(swap.bookingId);
  if(booking&&(booking.activeItemSwapId==null||booking.activeItemSwapId===swap._id))await ctx.db.patch(booking._id,{activeItemSwapId:swap._id});
  if(swap.status!=="review"||swap.reconcileError!==reviewError||swap.reconcileAfter!==undefined)await ctx.db.patch(swap._id,{status:"review",reconcileError:reviewError,reconcileAfter:undefined,reconcileAttempts:0,updatedAt:now});
  await queueOwnerNotification(ctx,{eventKey:`swap-refund-ambiguity:${refund._id}:${refund.refundAmbiguity.paymentIntentId}:${refund.refundAmbiguity.successfulRefundId}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment refund attempts need review",body:"Stripe confirmed an earlier refund after a retry began. The equipment change is locked. Compare both Stripe receipts before resolving it; no further refund or equipment update will be started automatically."});
  return {status:"review"};
}});
export const beginRefundRetry=internalMutation({args:{id:v.id("rental_item_swaps"),requestId:v.string(),reason:v.string(),failedParts:v.array(v.object({paymentIntentId:v.string(),stripeRefundId:v.string()}))},handler:async(ctx,args)=>{
  const swap=await ctx.db.get(args.id),reason=args.reason.trim();
  if(!swap||swap.quote.deltaPence>=0||!swap.refundJobId||!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId)||reason.length<5||reason.length>400||!args.failedParts.length)throw Error("A confirmed failed equipment refund is required.");
  const refund=await ctx.db.get(swap.refundJobId);
  if(!refund||refund.bookingId!==swap.bookingId||refund.expectedAccountId!==swap.accountId||refund.amountPence!==-swap.quote.deltaPence)throw Error("The equipment refund is not linked to this rental.");
  if(refund.refundAmbiguity)throw Error("Stripe reported success for an earlier refund after a retry began. Resolve the saved Stripe receipts before retrying or applying this equipment change.");
  const expected=[...args.failedParts].sort((a,b)=>a.paymentIntentId.localeCompare(b.paymentIntentId));
  const prior=refund.retryHistory?.find((row:any)=>row.requestId===args.requestId);
  if(prior){
    if(prior.reason!==reason||JSON.stringify(prior.failedParts.map((row:any)=>({paymentIntentId:row.paymentIntentId,stripeRefundId:row.failedRefundId})).sort((a:any,b:any)=>a.paymentIntentId.localeCompare(b.paymentIntentId)))!==JSON.stringify(expected))throw Error("The original refund retry request cannot be changed.");
    return {swap,refund,replayed:true};
  }
  if(swap.status!=="review"||refund.status!=="failed"||(refund.retryHistory?.length??0)>=100)throw Error("The equipment refund is no longer ready for a failed-refund retry.");
  const allocations=refund.allocations??[],parts=refund.parts??[],allocationIds=new Set(allocations.map((row:any)=>row.paymentIntentId)),partIds=new Set(parts.map((row:any)=>row.paymentIntentId));
  if(!allocations.length||allocations.length!==partIds.size||parts.length!==allocations.length||allocations.some((row:any)=>!Number.isSafeInteger(row.amountPence)||row.amountPence<=0)||allocations.reduce((sum:number,row:any)=>sum+row.amountPence,0)!==refund.amountPence||parts.some((part:any)=>!allocationIds.has(part.paymentIntentId)||!(["succeeded","failed"].includes(part.status))))throw Error("The refund allocations need complete reconciliation before retrying.");
  const failed=parts.filter((part:any)=>part.status==="failed").sort((a:any,b:any)=>a.paymentIntentId.localeCompare(b.paymentIntentId));
  if(failed.length!==expected.length)throw Error("All failed refund parts must be reviewed together.");
  const receipts=[...(refund.refundReceipts??[])],now=Math.max(Date.now(),...receipts.map((row:any)=>row.attemptedAt+1));
  const retryRows=[];
  for(let index=0;index<failed.length;index++){
    const part=failed[index],request=expected[index],allocation=refund.allocations?.find((row:any)=>row.paymentIntentId===part.paymentIntentId);
    const latest=receipts.filter((row:any)=>row.paymentIntentId===part.paymentIntentId).sort((a:any,b:any)=>b.attemptedAt-a.attemptedAt)[0];
    if(!request||request.paymentIntentId!==part.paymentIntentId||request.stripeRefundId!==part.stripeRefundId||!allocation||allocation.amountPence!==part.amountPence||!latest||latest.status!=="failed"||latest.stripeRefundId!==part.stripeRefundId||latest.attemptKey!==part.attemptKey)throw Error("The failed Stripe refund changed. Refresh and review it again.");
    const attemptKey=`${args.requestId}-${index+1}`;
    const receipt={paymentIntentId:part.paymentIntentId,amountPence:allocation.amountPence,attemptedAt:now,attemptKey,status:"unknown" as const};
    receipts.push(receipt);
    retryRows.push({paymentIntentId:part.paymentIntentId,failedRefundId:part.stripeRefundId,attemptKey});
  }
  const retryHistory=[...(refund.retryHistory??[]),{requestId:args.requestId,reason,startedAt:now,failedParts:retryRows}];
  await ctx.db.patch(refund._id,{status:"prepared",refundReceipts:receipts,retryHistory,updatedAt:now});
  await ctx.db.patch(swap._id,{status:"refund_pending",reconcileAttempts:0,reconcileError:undefined,reconcileAfter:now+5*60000,updatedAt:now});
  return {swap:await ctx.db.get(swap._id),refund:await ctx.db.get(refund._id),replayed:false};
}});
export const notifyConvertedStockRisk=internalMutation({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{const swap=await ctx.db.get(id);if(!swap||swap.quote.deltaPence>=0||!swap.stockAppliedAt||!swap.refundJobId)return;await queueOwnerNotification(ctx,{eventKey:`swap-converted-stock-risk:${id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment stock needs review",body:"The converted equipment change has a possible stock conflict. The existing refund must still complete; check availability separately."});}});
export const recordPaidStockReview=internalMutation({args:{id:v.id("rental_item_swaps"),sessionId:v.string(),paymentIntentId:v.string(),amountPence:v.number()},handler:async(ctx,args)=>{
 const swap=await ctx.db.get(args.id);
 if(!swap||!swap.acceptedAt||swap.quote.deltaPence<=0||swap.sessionId!==args.sessionId||swap.quote.deltaPence!==args.amountPence||!args.paymentIntentId||(swap.paymentIntentId&&swap.paymentIntentId!==args.paymentIntentId))throw Error("The equipment payment receipt does not match the accepted change.");
 if(swap.status==="applied")return {applied:true,already:true};
 if(swap.status==="refunded")return {refunded:true,already:true};
 if(swap.compensationStartedAt)return {review:true};
 if(swap.status==="review"){
   if(swap.reconcileError!==PAID_STOCK_RETRY_ERROR)return {review:true,existingReview:true};
   if(typeof swap.reconcileAfter==="number")return {review:true,retryScheduled:true};
   return {review:true,retryExhausted:true};
 }
 if(swap.status!=="awaiting_payment")throw Error("The paid equipment change needs review.");
 const now=Date.now();
 await ctx.db.patch(swap._id,{status:"review",paymentIntentId:args.paymentIntentId,reconcileAttempts:0,reconcileAfter:now+60000,reconcileError:PAID_STOCK_RETRY_ERROR,updatedAt:now});
 await ctx.scheduler.runAfter(60000,internal.rentalSwapPayments.reconcile,{});
 return {review:true,retryScheduled:true};
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
export const resumeReview=internalMutation({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{
  const swap=await ctx.db.get(id);
  if(!swap||swap.status!=="review")throw Error("This equipment settlement does not need resuming.");
  if(!swap.acceptedAt&&(swap.compensationStartedAt||swap.refundJobId||swap.sessionId||swap.paymentIntentId))throw Error("The equipment settlement needs manual review.");
  if(swap.refundJobId){const refund=await ctx.db.get(swap.refundJobId);if(refund?.refundAmbiguity)throw Error("Conflicting Stripe refund receipts need manual reconciliation before this equipment settlement can resume.");if(refund?.status==="failed"||refund?.parts?.some((part:any)=>part.status==="failed"))throw Error("A failed Stripe refund needs provider reconciliation before this equipment settlement can resume.");}
  const status=!swap.acceptedAt?"awaiting_acceptance" as const:swap.compensationStartedAt?"refund_compensating" as const:swap.refundJobId?"refund_pending" as const:swap.sessionId?"awaiting_payment" as const:"accepted" as const;
  await ctx.db.patch(id,{status,reconcileAttempts:0,reconcileError:undefined,reconcileAfter:status==="awaiting_acceptance"?Math.max(Date.now(),swap.expiresAt):Date.now()+5*60000});
  return await ctx.db.get(id);
}});
export const beginCompensation=internalMutation({args:{id:v.id("rental_item_swaps"),sessionId:v.string(),paymentIntentId:v.string(),amountPence:v.number(),reason:v.string()},handler:async(ctx,args)=>{const swap=await ctx.db.get(args.id);if(!swap||!swap.acceptedAt||swap.quote.deltaPence<=0||swap.sessionId!==args.sessionId||swap.quote.deltaPence!==args.amountPence||(swap.paymentIntentId&&swap.paymentIntentId!==args.paymentIntentId))throw Error("The equipment payment cannot be reconciled.");if(swap.status==="applied"||swap.status==="refunded"){if(swap.paymentIntentId!==args.paymentIntentId)throw Error("The equipment payment receipt changed.");return swap.status==="applied"?{applied:true}:{refunded:true};}if(swap.compensationStartedAt){if(swap.paymentIntentId!==args.paymentIntentId)throw Error("The compensation payment identity changed.");return {compensating:true};}if(!["awaiting_payment","review"].includes(swap.status))throw Error("The equipment payment state needs review.");const now=Date.now();await ctx.db.patch(swap._id,{status:"refund_compensating",paymentIntentId:args.paymentIntentId,compensationStartedAt:now,reconcileError:args.reason.slice(0,240),updatedAt:now,reconcileAfter:now+5*60000});await queueOwnerNotification(ctx,{eventKey:`swap-compensation:${swap._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment change could not finish",body:"The equipment change could not be applied after payment. Its original payment is being returned; check the refund status."});return {compensating:true};}});
export const recordCompensation=internalMutation({args:{id:v.id("rental_item_swaps"),receipt:depositReturnReceipt},handler:async(ctx,args)=>{const swap=await ctx.db.get(args.id);if(!swap||!swap.compensationStartedAt||!["refund_compensating","review"].includes(swap.status)||args.receipt.paymentIntentId!==swap.paymentIntentId||args.receipt.amountPence!==swap.quote.deltaPence||args.receipt.attemptedAt!==swap.compensationStartedAt)throw Error("The compensation receipt does not match the equipment payment.");const old=swap.compensationReceipt;if(old&&(old.paymentIntentId!==args.receipt.paymentIntentId||old.attemptedAt!==args.receipt.attemptedAt||(old.stripeRefundId&&old.stripeRefundId!==args.receipt.stripeRefundId)||(old.approvalRequestId&&old.approvalRequestId!==args.receipt.approvalRequestId)))throw Error("The original compensation receipt cannot be replaced.");await ctx.db.patch(swap._id,{compensationReceipt:args.receipt,updatedAt:Date.now()});}});
export const finishCompensation=internalMutation({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id})=>{
  const swap=await ctx.db.get(id);
  if(!swap)throw Error("Equipment proposal missing.");
  if(swap.status==="refunded")return {refunded:true,already:true};
  if(!["refund_compensating","review"].includes(swap.status)||swap.compensationReceipt?.status!=="succeeded"||swap.compensationReceipt.paymentIntentId!==swap.paymentIntentId||swap.compensationReceipt.amountPence!==swap.quote.deltaPence)throw Error("The original equipment payment refund is not confirmed.");
  const booking=await ctx.db.get(swap.bookingId);
  const fenced=swapAuthorityAvailable()&&process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL==="true";
  await ctx.db.patch(swap._id,{status:"refunded",updatedAt:Date.now(),reconcileAfter:undefined});
  await queueCompensatedRelease(ctx,swap._id);
  if(!fenced)await queueOwnerNotification(ctx,{eventKey:`swap-compensated-release:${swap._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Refunded equipment change still holds stock",body:"The renter’s additional payment was refunded, but shared inventory authority is unavailable. The original rental and stock lock remain unchanged until release is confirmed."});
  await notifySettlement(ctx,swap,booking,`The equipment change could not be completed. The additional £${(swap.quote.deltaPence/100).toFixed(2)} payment has been refunded to the original payment method; your existing equipment is unchanged.`,"equipment change refund",`The additional £${(swap.quote.deltaPence/100).toFixed(2)} payment was refunded. The existing equipment is unchanged.`);
  return {refunded:true,stockReleasePending:true};
}});
async function closeSwap(ctx:any,swap:any,status:"withdrawn"|"declined"|"expired",expiredSessionId?:string) {
  if(!swap||swap.refundJobId||swap.paymentIntentId)throw Error("The equipment settlement needs review before closing.");
  if(swap.status===status){await releaseClosedClaim(ctx,swap);return;}
  if(swap.status!=="awaiting_acceptance"&&!(status!=="declined"&&swap.status==="awaiting_payment"&&swap.sessionId&&swap.sessionId===expiredSessionId))throw Error("The accepted equipment settlement needs review before closing.");
  const booking=await ctx.db.get(swap.bookingId);
  const claim=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",(index:any)=>index.eq("swapId",swap._id).eq("operation","acquire")).unique();
  if(!claim){const rows=await ctx.db.query("reservations").withIndex("by_booking",(index:any)=>index.eq("bookingId",swap.bookingId)).collect();for(const row of rows)if(row.status==="hold"&&row.externalRef===`swap:${swap._id}`)await ctx.db.patch(row._id,{status:"cancelled"});if(booking?.activeItemSwapId===swap._id)await ctx.db.patch(booking._id,{activeItemSwapId:undefined});}
  await ctx.db.patch(swap._id,{status,updatedAt:Date.now(),reconcileAfter:undefined});
  await releaseClosedClaim(ctx,{...swap,status});
  if(booking)await queueRmv2Sync(ctx,booking._id);
}

export const close=internalMutation({args:{id:v.id("rental_item_swaps"),status:v.union(v.literal("withdrawn"),v.literal("declined"),v.literal("expired")),expiredSessionId:v.optional(v.string())},handler:async(ctx,args)=>{const swap=await ctx.db.get(args.id);await closeSwap(ctx,swap,args.status,args.expiredSessionId);}});

export const customerDecline=mutation({args:{token:v.string(),id:v.id("rental_item_swaps")},handler:async(ctx,args)=>{
  const account=await accountForToken(ctx,args.token),swap=await ctx.db.get(args.id);
  if(!account||account.blockedAt!=null||!swap||swap.accountId!==account._id)throw Error("This equipment proposal is not available for your account.");
  await ownedBooking(ctx,account,swap.bookingId);
  if(swap.status==="declined"){await releaseClosedClaim(ctx,swap);return {declined:true,already:true};}
  if(swap.status!=="awaiting_acceptance")throw Error("This equipment proposal is no longer awaiting your decision.");
  if(swap.expiresAt<=Date.now()){
    await closeSwap(ctx,swap,"expired");
    return {declined:false,expired:true};
  }
  await closeSwap(ctx,swap,"declined");
  await postRentalMessage(ctx,{accountId:account._id,bookingId:swap.bookingId,sender:"system",text:"This equipment change was declined. Your existing kit and rental dates stay the same.",meta:{kind:"rental_item_swap_declined",swapId:swap._id}});
  await queueOwnerNotification(ctx,{eventKey:`rental-swap-declined:${swap._id}`,kind:"renter_message",accountId:account._id,bookingId:swap.bookingId,title:"Equipment change declined",body:"The renter declined the proposed equipment change. The existing rental remains unchanged."});
  return {declined:true};
}});

export const apply = internalMutation({args:{id:v.id("rental_item_swaps"),sessionId:v.optional(v.string()),paymentIntentId:v.optional(v.string()),amountPence:v.optional(v.number()),stageRefund:v.optional(v.boolean()),stockRisk:v.optional(v.boolean())},handler:async(ctx,args)=>{
  const swap=await ctx.db.get(args.id);if(!swap)throw Error("Equipment proposal missing.");if(swap.status==="applied"){if(swap.paymentIntentId!==args.paymentIntentId)throw Error("Equipment payment receipt mismatch.");return {applied:true,already:true};}
  if(!swapAuthorityAvailable()||process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL!=="true")throw Error("Shared stock authority is unavailable; the equipment change remains locked for reconciliation.");
  await assertStockExecution(ctx,args.id);
  if(swap.stockAppliedAt){
    if(swap.quote.deltaPence>=0||!swap.refundJobId||!swap.creditsRestoredAt)throw Error("The staged equipment change needs review.");
    if(args.stageRefund)return {staged:true,already:true};
    const refund=await ctx.db.get(swap.refundJobId),booking=await ctx.db.get(swap.bookingId);
    if(!refund||refund.refundAmbiguity||refund.status!=="succeeded"||refund.amountPence!==-swap.quote.deltaPence||!booking||booking.activeItemSwapId!==swap._id)throw Error("The equipment refund must settle without conflicting Stripe receipts before completing the change.");
    const stockReceipt=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_swap",q=>q.eq("swapId",swap._id)).unique();
    const account=await ctx.db.get(swap.accountId);
    const stockConfirmed=swapAuthorityAvailable()&&process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL==="true"&&stockReceipt?.deliveryState==="acknowledged"&&stockReceipt.stockRisk!==true&&!args.stockRisk&&booking.status==="confirmed"&&booking.idVerifyStatus==="verified"&&(verificationValidUntil(booking)??0)>Date.now()&&!booking.cancellationDecision&&!booking.returnDecision&&!!account&&account.blockedAt==null&&belongsToRentalAccount(booking,account);
    if(stockConfirmed)await ctx.db.patch(booking._id,{activeItemSwapId:undefined});
    else if(stockReceipt?.deliveryState==="acknowledged")await ctx.db.patch(stockReceipt._id,{auditDueAt:Date.now(),auditAttempts:0});
    await ctx.db.patch(swap._id,{status:"applied",updatedAt:Date.now(),reconcileAfter:undefined});
    const adjustmentReceiptId=await recordSwapAdjustment(ctx,swap,booking,account,Date.now(),!stockConfirmed);
    await ctx.scheduler.runAfter(0,(internal as any).invoice.swapAdjustmentEmail,{receiptId:adjustmentReceiptId});
    await notifySettlement(ctx,swap,booking,`${stockConfirmed?"Your equipment change is complete.":"Your equipment change is still being checked."} The £${(-swap.quote.deltaPence/100).toFixed(2)} refund was sent to the original payment method.`,"equipment change refund",`The £${(-swap.quote.deltaPence/100).toFixed(2)} refund for your equipment change was sent to the original payment method.`);
    return {applied:true};
  }
  await assertFreshSharedStock(ctx);
  if(!swap.acceptedAt||!swap.acceptanceText||!["accepted","awaiting_payment","refund_pending","review"].includes(swap.status))throw Error("The renter must accept the equipment change first.");
  if(swap.quote.deltaPence>0&&(swap.sessionId!==args.sessionId||!args.paymentIntentId||args.amountPence!==swap.quote.deltaPence||swap.paymentIntentId&&swap.paymentIntentId!==args.paymentIntentId))throw Error("The equipment payment receipt does not match the accepted quote.");
  if(swap.quote.deltaPence<0){
    if(args.stageRefund)throw Error("A downgrade cannot be applied before its refund succeeds.");
    const refund=swap.refundJobId?await ctx.db.get(swap.refundJobId):null;
    assertSuccessfulSwapRefund(refund,swap);
  }else if(args.stageRefund)throw Error("Equipment changes cannot be staged before settlement.");
  const booking=await ctx.db.get(swap.bookingId);if(!booking||booking.activeItemSwapId!==swap._id||booking.status!=="confirmed"||booking.cancellationDecision||booking.returnDecision)throw Error("The rental changed during settlement and needs review.");
  const account=await ctx.db.get(swap.accountId);if(!account||!belongsToRentalAccount(booking,account)||account.blockedAt!=null)throw Error("The rental account changed or needs review before applying this equipment change.");
  if(!booking.invoiceSnapshot){
    const invoiceSnapshot=initialInvoiceSnapshot(booking,account.name??null,booking.guestEmail??account.email??null);
    await ctx.db.patch(booking._id,{invoiceSnapshot});
    booking.invoiceSnapshot=invoiceSnapshot;
  }
  const originalLines=bookingStockLines(booking);
  let lines:any[], currentFunding:any, values:any;
  if(swap.changes?.length){
    for(const change of swap.changes)if(JSON.stringify(canonicalFunding(originalLines[change.lineIndex]))!==JSON.stringify(canonicalFunding(change.oldLine)))throw Error("The original equipment changed during settlement.");
    const result=await calculateBasket(ctx,booking._id,swap.changes.map((change:any)=>({lineIndex:change.lineIndex,newListingId:change.newListingId})),swap._id);
    lines=result.lines;values=result.values;currentFunding=result.funding;
    await applySwapBasketStock(ctx,booking,originalLines,lines,swap._id);
  }else{
    lines=originalLines.map((line:any,index:number)=>index===swap.lineIndex?swap.newLine:line);
    if(JSON.stringify(canonicalFunding(originalLines[swap.lineIndex]))!==JSON.stringify(canonicalFunding(swap.oldLine)))throw Error("The original equipment changed during settlement.");
    currentFunding=await quoteSwapFunding(ctx,booking,swap.lineIndex,swap.newLine);
    await assertRenterExposure(ctx,booking,lines);values=await securityValues(ctx,booking,lines);
    await applySwapStock(ctx,booking,swap.oldLine,swap.newLine,lines,swap._id);
  }
  if(JSON.stringify(canonicalFunding(currentFunding))!==JSON.stringify(canonicalFunding(swap.quote)))throw Error("The equipment funding changed during settlement and needs review.");
  if(swap.creditsRestoredAt)throw Error("The credit restoration marker needs review.");
  const creditBalances=adjustedSwapCreditBalances(booking,swap.quote.restore);
  await restoreSwapCredit(ctx,booking,String(swap._id),swap.quote.restore,Date.now());
  const funding=swap.quote.nextAllFunding?[...swap.quote.nextAllFunding]:[...booking.checkoutLineFunding!];if(!swap.quote.nextAllFunding)funding[swap.lineIndex]=swap.quote.nextFunding;
  const sources=swap.quote.nextAllCreditSources??[...(booking.checkoutLineCreditSources??[]).filter((source:any)=>source.lineIndex!==swap.lineIndex),...swap.quote.nextCreditSources];
  const now=Date.now(),refundedDowngrade=swap.quote.deltaPence<0;
  const updatedDiscount=swap.quote.nextDiscount??(swap.quote.nextAllFunding?funding.reduce((sum:number,row:any)=>sum+Math.round(row.discount*100),0)/100:Math.round(((booking.discount??0)-booking.checkoutLineFunding![swap.lineIndex].discount+swap.quote.nextFunding.discount)*100)/100);
  const fenced=swapAuthorityAvailable()&&process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL==="true";
  const updatedSubtotal=swap.quote.nextSubtotal??Math.round((booking.subtotal+swap.newLine.lineTotal-swap.oldLine.lineTotal)*100)/100;
  await ctx.db.patch(booking._id,{...creditBalances,lineItems:lines,replacementValues:values,subtotal:updatedSubtotal,discount:updatedDiscount,total:Math.round((booking.total+Math.max(0,swap.quote.deltaPence)/100)*100)/100,checkoutLineFunding:funding,checkoutLineCreditSources:sources,...(!fenced?{activeItemSwapId:undefined}:{})});
  await ctx.db.patch(swap._id,{status:"applied",paymentIntentId:args.paymentIntentId,creditsRestoredAt:now,...(refundedDowngrade?{stockAppliedAt:now}:{}),reconcileAfter:undefined,updatedAt:now});
  const changeSummary=swap.changes?.length?equipmentChangeSummary(swap.changes):`${swap.oldLine.qty} × ${swap.oldLine.title} → ${swap.newLine.qty} × ${swap.newLine.title}`;
  const refundMessage=refundedDowngrade?` The £${(-swap.quote.deltaPence/100).toFixed(2)} refund was sent to the original payment method.`:"";
  await postRentalMessage(ctx,{accountId:swap.accountId,bookingId:swap.bookingId,sender:"system",text:fenced?`We are checking availability for your equipment change.${refundMessage}`:`Your equipment change is confirmed: ${changeSummary}.${refundMessage}`});
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
  const adjustmentReceiptId=await recordSwapAdjustment(ctx,swap,booking,account,now,fenced);
  await ctx.scheduler.runAfter(0,(internal as any).invoice.swapAdjustmentEmail,{receiptId:adjustmentReceiptId});
  if(!fenced)await ctx.scheduler.runAfter(0,internal.notify.changeEmail,{bookingId:booking._id,expectedAccountId:swap.accountId,kind:"equipment updated",detail:`${changeSummary}.${refundMessage}`});return {applied:true};
} });
