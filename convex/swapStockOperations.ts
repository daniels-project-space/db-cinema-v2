import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { swapAuthorityAvailable } from "./lib/rentalSwapAuthority";
import { queueOwnerNotification } from "./lib/adminPush";
import { bookingStockLines, rentalWindow } from "../shared/rentalWindow";
import { stockTimePrecision } from "./lib/stockWindows";
import { assertRentalAllocation } from "./lib/rentalAllocation";

const item = v.object({ itemId:v.string(), start:v.number(), returnAt:v.number(), quantity:v.number() });
const operation = v.union(v.literal("acquire"),v.literal("beginExecution"),v.literal("releasePrepared"));
const reason = v.union(v.literal("withdrawn_before_execution"),v.literal("abandoned_before_execution"));

function canonicalRequest(value:any):any {
  if(Array.isArray(value))return value.map(canonicalRequest);
  if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalRequest(value[key])]));
  return value;
}

function sameRequest(left:any,right:any):boolean {
  return JSON.stringify(canonicalRequest(left))===JSON.stringify(canonicalRequest(right));
}

function safeToRelease(swap:any) {
  return swap && ["withdrawn", "declined", "expired"].includes(swap.status) && !swap.sessionId && !swap.paymentIntentId && !swap.refundJobId && !swap.stockAppliedAt && !swap.compensationStartedAt && !swap.compensationReceipt;
}

async function notifyStockReview(ctx:any,row:any,releaseConfirmed=false) {
  const swap=await ctx.db.get(row.swapId);
  if(swap)await queueOwnerNotification(ctx,{eventKey:`swap-stock-review:${row._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:swap.bookingId,title:"Equipment stock needs review",body:releaseConfirmed?"The manager released the compensated swap claim, but the original rental changed. Check verification and stock before changing the rental.":"The original stock request could not be confirmed. Check its outcome before changing the rental or releasing stock."});
}

export async function releaseClosedClaim(ctx:any, swap:any) {
  if (!swap || !["withdrawn", "declined", "expired"].includes(swap.status)) return;
  const find=(kind:string)=>ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",(q:any)=>q.eq("swapId",swap._id).eq("operation",kind)).unique();
  const acquire=await find("acquire");
  if (!acquire || acquire.state!=="confirmed" || !acquire.receipt?.requestId || !acquire.receipt?.fingerprint) return;
  if (!safeToRelease(swap) || await find("beginExecution")) { await notifyStockReview(ctx,acquire); return; }
  if (await find("releasePrepared")) return;
  const now=Date.now();
  const reason=swap.status==="withdrawn"?"withdrawn_before_execution":swap.status==="declined"?"renter_declined_before_execution":"abandoned_before_execution";
  await ctx.db.insert("swap_stock_operations",{swapId:swap._id,operation:"releasePrepared",request:{operation:"releasePrepared",args:{id:acquire.receipt.requestId,fingerprint:acquire.receipt.fingerprint,reason}},state:"pending",createdAt:now,updatedAt:now,reconcileAfter:now,reconcileAttempts:0});
}

export async function queueCompensatedRelease(ctx:any,swapId:any) {
  const existing=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",(q:any)=>q.eq("swapId",swapId).eq("operation","releaseCompensated")).unique();
  if(existing)return existing._id;
  const now=Date.now();
  return ctx.db.insert("swap_stock_operations",{swapId,operation:"releaseCompensated",request:{operation:"releaseCompensated",args:null},state:"pending",createdAt:now,updatedAt:now,reconcileAfter:now,reconcileAttempts:0});
}

async function compensatedRequest(ctx:any,swapId:any) {
  const swap=await ctx.db.get(swapId),booking=swap?await ctx.db.get(swap.bookingId):null;
  const currentLines=booking?bookingStockLines(booking):[];
  const originalStillMatches=swap?.changes?.length?swap.changes.every((change:any)=>sameRequest(currentLines[change.lineIndex],change.oldLine)):sameRequest(currentLines[swap?.lineIndex],swap?.oldLine);
  if(!swap||swap.status!=="refunded"||!swap.acceptedAt||swap.quote.deltaPence<=0||swap.stockAppliedAt||swap.refundJobId||!swap.compensationStartedAt||swap.compensationReceipt?.status!=="succeeded"||swap.compensationReceipt.paymentIntentId!==swap.paymentIntentId||swap.compensationReceipt.amountPence!==swap.quote.deltaPence||swap.compensationReceipt.attemptedAt!==swap.compensationStartedAt||!swap.compensationReceipt.stripeRefundId||!booking||booking.status!=="confirmed"||booking.activeItemSwapId!==swapId||booking.cancellationDecision||booking.returnDecision||!originalStillMatches)throw Error("The compensated rental needs review before releasing stock.");
  if(await ctx.db.query("swap_stock_applied_receipts").withIndex("by_swap",(q:any)=>q.eq("swapId",swapId)).unique())throw Error("The equipment change was applied and cannot be released as compensated.");
  if(booking.rmv2SyncStatus!=="delivered"||!Number.isSafeInteger(booking.rmv2Revision)||booking.rmv2Revision<1||booking.rmv2DeliveredRevision!==booking.rmv2Revision)return null;
  await assertStockExecution(ctx,swapId);
  const claim=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",(q:any)=>q.eq("swapId",swapId).eq("operation","acquire")).unique();
  const execution=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",(q:any)=>q.eq("swapId",swapId).eq("operation","beginExecution")).unique();
  const reservations=await ctx.db.query("reservations").withIndex("by_booking",(q:any)=>q.eq("bookingId",booking._id)).collect();
  if(reservations.some((row:any)=>row.status==="active"||row.status==="hold"&&row.externalRef!==`swap:${swapId}`))throw Error("The original rental stock needs review.");
  await assertRentalAllocation(ctx,booking,reservations);
  const windows=[];
  for(const row of reservations.filter((row:any)=>row.source==="site"&&row.status==="confirmed")){
    const unit=await ctx.db.get(row.inventoryUnitId);
    if(!unit?.rmv2ItemId||row.endExclusive!==true||row.turnaroundBufferMinutes!==60||!Number.isSafeInteger(row.start)||!Number.isSafeInteger(row.end)||row.end<=row.start||!Number.isSafeInteger(row.qty)||row.qty<1)throw Error("The original manager stock mapping needs review.");
    windows.push({itemId:unit.rmv2ItemId,start:row.start,end:row.end,quantity:row.qty});
  }
  if(!windows.length||windows.length>256)throw Error("The original manager stock mapping needs review.");
  windows.sort((a,b)=>a.itemId.localeCompare(b.itemId)||a.start-b.start||a.end-b.end||a.quantity-b.quantity);
  return {operation:"releaseCompensated",args:{id:claim.receipt.requestId,fingerprint:claim.receipt.fingerprint,executionKey:execution.request.args.executionKey,evidence:{swapId:String(swapId),bookingId:String(booking._id),bookingRevision:booking.rmv2Revision,paymentIntentId:swap.paymentIntentId,refundId:swap.compensationReceipt.stripeRefundId,refundStatus:"succeeded",amountPence:swap.quote.deltaPence,refundAttemptedAt:swap.compensationStartedAt,windows}}};
}

async function finalizeCompensatedRelease(ctx:any,row:any,receipt:any) {
  const now=Date.now();
  if(receipt?.state!=="compensated_released"||typeof receipt.replayed!=="boolean"){
    await ctx.db.patch(row._id,{state:"review",receipt:undefined,leaseToken:undefined,leaseUntil:undefined,reconcileAfter:undefined,updatedAt:now});
    await notifyStockReview(ctx,row,true);
    return "review";
  }
  let current:any;
  try { current=await compensatedRequest(ctx,row.swapId); }
  catch {
    await ctx.db.patch(row._id,{state:"review",receipt,leaseToken:undefined,leaseUntil:undefined,reconcileAfter:undefined,updatedAt:now});
    await notifyStockReview(ctx,row,true);
    return "review";
  }
  if(!current){
    const attempts=(row.reconcileAttempts??0)+1;
    await ctx.db.patch(row._id,{state:"review",receipt,leaseToken:undefined,leaseUntil:undefined,reconcileAttempts:attempts,reconcileAfter:attempts>=16?undefined:now+Math.min(60,2**Math.min(attempts,6))*60000,updatedAt:now});
    if(attempts>=16)await notifyStockReview(ctx,row,true);
    return "pending";
  }
  if(!sameRequest(current,row.request)){
    await ctx.db.patch(row._id,{state:"review",receipt,leaseToken:undefined,leaseUntil:undefined,reconcileAfter:undefined,updatedAt:now});
    await notifyStockReview(ctx,row,true);
    return "review";
  }
  const swap=await ctx.db.get(row.swapId),booking=swap?await ctx.db.get(swap.bookingId):null;
  if(!booking||booking.activeItemSwapId!==row.swapId){
    await ctx.db.patch(row._id,{state:"review",receipt,leaseToken:undefined,leaseUntil:undefined,reconcileAfter:undefined,updatedAt:now});
    await notifyStockReview(ctx,row,true);
    return "review";
  }
  const reservations=await ctx.db.query("reservations").withIndex("by_booking",(q:any)=>q.eq("bookingId",booking._id)).collect();
  for(const reservation of reservations)if(reservation.status==="hold"&&reservation.externalRef===`swap:${row.swapId}`)await ctx.db.patch(reservation._id,{status:"cancelled"});
  await ctx.db.patch(booking._id,{activeItemSwapId:undefined});
  await ctx.db.patch(row._id,{state:"confirmed",receipt,leaseToken:undefined,leaseUntil:undefined,reconcileAfter:undefined,updatedAt:now});
  return "confirmed";
}

async function prepareOperation(ctx:any,args:any) {
    const swap=await ctx.db.get(args.swapId);
    if(!swap)throw Error("Swap not found.");
    const find=(kind:"acquire"|"beginExecution"|"releasePrepared")=>ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",(q:any)=>q.eq("swapId",args.swapId).eq("operation",kind)).unique();
    const current=await find(args.operation);
    const acquire=await find("acquire");
    let request:any;
    if(args.operation==="acquire"){
      if(args.reason!==undefined||!args.items?.length||args.items.length>64||args.items.some((line:any)=>!line.itemId||line.itemId.length>255||!Number.isSafeInteger(line.start)||!Number.isSafeInteger(line.returnAt)||!Number.isSafeInteger(line.returnAt+3600000)||line.returnAt<=line.start||line.returnAt-line.start>365*86400000||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>100))throw Error("Invalid stock claim.");
      // The Rental Manager acquire endpoint identifies this idempotent claim
      // by requestId and items. Booking association stays in this site's swap
      // operation row; the manager's acquire contract does not accept bookingId.
      request={operation:"acquire",args:{requestId:`swap_${args.swapId}`,items:args.items}};
    }else{
      if(args.items!==undefined||!acquire||acquire.state!=="confirmed"||!acquire.receipt?.requestId||!acquire.receipt?.fingerprint)throw Error("A confirmed stock claim is required.");
      const identity={id:acquire.receipt.requestId,fingerprint:acquire.receipt.fingerprint};
      if(args.operation==="beginExecution"){
        if(args.reason!==undefined)throw Error("Unexpected release reason.");
        request={operation:"beginExecution",args:{...identity,executionKey:`swap_execution_${args.swapId}`}};
      }else{
        if(!args.reason)throw Error("A release reason is required.");
        if(!safeToRelease(swap))throw Error("The closed swap has financial activity or needs review before releasing stock.");
        request={operation:"releasePrepared",args:{...identity,reason:args.reason}};
      }
    }
    if(current){
      if(!sameRequest(current.request,request))throw Error("Stock operation identity changed; reconcile before continuing.");
      return current._id;
    }
    if(args.operation!=="releasePrepared"&&(swap.sessionId||swap.paymentIntentId||swap.refundJobId||swap.stockAppliedAt||swap.compensationStartedAt))throw Error("Existing financial activity requires stock reconciliation.");
    if(args.operation!=="releasePrepared"&&swap.status!=="accepted")throw Error("The renter must accept the swap before claiming stock or starting execution.");
    if(args.operation!=="acquire"){
      const other=await find(args.operation==="beginExecution"?"releasePrepared":"beginExecution");
      if(other)throw Error("A conflicting stock operation requires reconciliation.");
    }
    const now=Date.now();
    return ctx.db.insert("swap_stock_operations",{swapId:args.swapId,operation:args.operation,request,state:"pending",createdAt:now,updatedAt:now,reconcileAfter:now,reconcileAttempts:0});
}

export const prepare = internalMutation({
  args:{swapId:v.id("rental_item_swaps"),operation,items:v.optional(v.array(item)),reason:v.optional(reason)},
  handler:prepareOperation,
});

export const prepareSwapClaim = internalMutation({args:{swapId:v.id("rental_item_swaps")},handler:async(ctx,args)=>{
  const swap=await ctx.db.get(args.swapId);
  if(!swap)throw Error("Swap not found.");
  const existing=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",q=>q.eq("swapId",args.swapId).eq("operation","acquire")).unique();
  if(existing)return existing._id;
  const booking=await ctx.db.get(swap.bookingId);
  if(!booking||booking.activeItemSwapId!==swap._id||booking.status!=="confirmed"||booking.cancellationDecision||booking.returnDecision)throw Error("The original equipment booking needs review.");
  if(swap.changes?.length){
    const originalLines=bookingStockLines(booking),nextLines=[...originalLines],seen=new Set<number>();
    for(const change of swap.changes){
      if(!Number.isSafeInteger(change.lineIndex)||change.lineIndex<0||change.lineIndex>=originalLines.length||seen.has(change.lineIndex)||!sameRequest(originalLines[change.lineIndex],change.oldLine)||!change.newLine||String(change.newLine.listingId)!==String(change.newListingId)||String(change.oldLine.listingId)!==String(change.oldListingId)||!Number.isSafeInteger(change.oldLine.qty)||change.oldLine.qty<1||change.oldLine.qty!==change.newLine.qty)throw Error("The original equipment booking needs review.");
      for(const field of ["start","end","pickupTime","returnTime"] as const)if((change.oldLine[field]??null)!==(change.newLine[field]??null))throw Error("The equipment change must keep its original rental window.");
      const listing:any=await ctx.db.get(change.newListingId);
      if(!listing?.components?.length||!listing.active||listing.suppressed||listing.marketingOnly)throw Error("The equipment stock mapping needs review.");
      seen.add(change.lineIndex);nextLines[change.lineIndex]=change.newLine;
    }
    const precision=await stockTimePrecision(ctx);
    const managerTotals=async(lines:any[])=>{
      const totals=new Map<string,{itemId:string;start:number;returnAt:number;quantity:number}>(),unitIds=new Map<string,string>();
      for(const line of lines){
        const listing:any=await ctx.db.get(line.listingId);
        if(!listing?.components?.length||!Number.isSafeInteger(line.qty)||line.qty<1)throw Error("The equipment stock mapping needs review.");
        const window=rentalWindow(line,precision);
        for(const component of listing.components){
          if(!Number.isSafeInteger(component.qty)||component.qty<1)throw Error("The equipment stock mapping needs review.");
          const unit:any=await ctx.db.get(component.inventoryUnitId),itemId=unit?.rmv2ItemId;
          if(typeof itemId!=="string"||!itemId||itemId.length>255||unitIds.has(itemId)&&unitIds.get(itemId)!==String(component.inventoryUnitId))throw Error("The manager stock mapping needs review.");
          unitIds.set(itemId,String(component.inventoryUnitId));
          const key=JSON.stringify([itemId,window.start,window.end]),current=totals.get(key);
          totals.set(key,{itemId,start:window.start,returnAt:window.end,quantity:(current?.quantity??0)+component.qty*line.qty});
        }
      }
      return totals;
    };
    const oldTotals=await managerTotals(originalLines),newTotals=await managerTotals(nextLines);
    const entries=(totals:Map<string,{itemId:string;start:number;returnAt:number;quantity:number}>)=>[...totals.values()].sort((a,b)=>a.itemId.localeCompare(b.itemId)||a.start-b.start||a.returnAt-b.returnAt);
    const items=entries(newTotals).map(line=>({...line,quantity:line.quantity-(oldTotals.get(JSON.stringify([line.itemId,line.start,line.returnAt]))?.quantity??0)})).filter(line=>line.quantity>0);
    if(!items.length){
      if(swap.status!=="accepted"||swap.sessionId||swap.paymentIntentId||swap.refundJobId||swap.stockAppliedAt||swap.compensationStartedAt)throw Error("The equipment settlement needs review.");
      const request={operation:"acquireZero",args:{requestId:`swap_${args.swapId}`,bookingId:String(booking._id),oldItems:entries(oldTotals),newItems:entries(newTotals)}};
      const now=Date.now();return ctx.db.insert("swap_stock_operations",{swapId:args.swapId,operation:"acquire",request,state:"pending",createdAt:now,updatedAt:now,reconcileAfter:now,reconcileAttempts:0});
    }
    return prepareOperation(ctx,{swapId:args.swapId,operation:"acquire",items});
  }
  if(!sameRequest(bookingStockLines(booking)[swap.lineIndex],swap.oldLine))throw Error("The original equipment booking needs review.");
  const previous=await ctx.db.get(swap.oldListingId), next=await ctx.db.get(swap.newListingId);
  if(!previous?.components?.length||!next?.components?.length||String(swap.oldLine?.listingId)!==String(swap.oldListingId)||String(swap.newLine?.listingId)!==String(swap.newListingId)||!Number.isSafeInteger(swap.oldLine?.qty)||swap.oldLine.qty<1||swap.oldLine.qty!==swap.newLine?.qty)throw Error("The equipment stock mapping needs review.");
  for(const field of ["start","end","pickupTime","returnTime"] as const)if((swap.oldLine?.[field]??null)!==(swap.newLine?.[field]??null))throw Error("The equipment change must keep its original rental window.");
  const totals=async(listing:any)=>{
    const result=new Map<string,number>(),unitIds=new Map<string,string>();
    for(const component of listing.components){
      if(!Number.isSafeInteger(component.qty)||component.qty<1)throw Error("The equipment stock mapping needs review.");
      const unit:any=await ctx.db.get(component.inventoryUnitId),id=unit?.rmv2ItemId;
      if(typeof id!=="string"||!id||id.length>255||unitIds.has(id)&&unitIds.get(id)!==String(component.inventoryUnitId))throw Error("The manager stock mapping needs review.");
      unitIds.set(id,String(component.inventoryUnitId));result.set(id,(result.get(id)??0)+component.qty*swap.oldLine.qty);
    }
    return {result,unitIds};
  };
  const old=await totals(previous),replacement=await totals(next);
  for(const [id,unit] of replacement.unitIds)if(old.unitIds.has(id)&&old.unitIds.get(id)!==unit)throw Error("The manager stock mapping needs review.");
  const window=rentalWindow(swap.newLine,await stockTimePrecision(ctx));
  const items=[...replacement.result].map(([itemId,quantity])=>({itemId,start:window.start,returnAt:window.end,quantity:quantity-(old.result.get(itemId)??0)})).filter(line=>line.quantity>0).sort((a,b)=>a.itemId.localeCompare(b.itemId));
  if(!items.length){
    if(swap.status!=="accepted"||swap.sessionId||swap.paymentIntentId||swap.refundJobId||swap.stockAppliedAt||swap.compensationStartedAt)throw Error("The equipment settlement needs review.");
    const entries=(map:Map<string,number>)=>[...map].map(([itemId,quantity])=>({itemId,start:window.start,returnAt:window.end,quantity})).sort((a,b)=>a.itemId.localeCompare(b.itemId));
    const request={operation:"acquireZero",args:{requestId:`swap_${args.swapId}`,bookingId:String(booking._id),oldItems:entries(old.result),newItems:entries(replacement.result)}};
    const now=Date.now();return ctx.db.insert("swap_stock_operations",{swapId:args.swapId,operation:"acquire",request,state:"pending",createdAt:now,updatedAt:now,reconcileAfter:now,reconcileAttempts:0});
  }
  return prepareOperation(ctx,{swapId:args.swapId,operation:"acquire",items});
}});

export async function assertStockExecution(ctx:any,swapId:any) {
  const claim=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",(q:any)=>q.eq("swapId",swapId).eq("operation","acquire")).unique();
  const execution=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",(q:any)=>q.eq("swapId",swapId).eq("operation","beginExecution")).unique();
  const release=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",(q:any)=>q.eq("swapId",swapId).eq("operation","releasePrepared")).unique();
  if(claim?.state!=="confirmed"||execution?.state!=="confirmed"||release||!claim.receipt?.requestId||!claim.receipt?.fingerprint||execution.request?.args?.id!==claim.receipt.requestId||execution.request?.args?.fingerprint!==claim.receipt.fingerprint||execution.request?.args?.executionKey!==`swap_execution_${swapId}`)throw Error("The equipment stock execution is not confirmed.");
}

export const read = internalQuery({args:{id:v.id("swap_stock_operations")},handler:async(ctx,args)=>ctx.db.get(args.id)});

export const stagedConversionReceipt = internalQuery({args:{swapId:v.id("rental_item_swaps")},handler:async(ctx,{swapId})=>{
  const swap=await ctx.db.get(swapId),receipt=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_swap",q=>q.eq("swapId",swapId)).unique();
  const booking=swap?await ctx.db.get(swap.bookingId):null;
  if(!swap||swap.quote.deltaPence>=0||!swap.stockAppliedAt||!swap.refundJobId||!booking||booking.activeItemSwapId!==swapId||!receipt||receipt.bookingId!==booking._id||receipt.appliedAt!==swap.stockAppliedAt)throw Error("The staged equipment conversion needs review.");
  await assertStockExecution(ctx,swapId);
  return {swapId:String(receipt.swapId),bookingId:String(receipt.bookingId),bookingRevision:receipt.bookingRevision,managerRequestId:receipt.managerRequestId,fingerprint:receipt.fingerprint,executionKey:receipt.executionKey,appliedAt:receipt.appliedAt,windows:receipt.windows.map(window=>({...window,reservationId:String(window.reservationId),inventoryUnitId:String(window.inventoryUnitId)}))};
}});

export const lease = internalMutation({
  args:{id:v.id("swap_stock_operations"),token:v.string()},
  handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.id);
    if(!row)throw Error("Stock operation not found.");
    if(row.state!=="pending")return {status:row.state};
    if(row.operation==="releasePrepared"){
      const swap=await ctx.db.get(row.swapId);
      const execution=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",q=>q.eq("swapId",row.swapId).eq("operation","beginExecution")).unique();
      if(!safeToRelease(swap)||execution){await ctx.db.patch(row._id,{state:"review",leaseToken:undefined,leaseUntil:undefined,reconcileAfter:undefined,updatedAt:Date.now()});await notifyStockReview(ctx,row);return {status:"review"};}
    }
    const now=Date.now();
    if(row.leaseUntil&&row.leaseUntil>now)return {status:"busy"};
    let request=row.request;
    if(row.operation==="releaseCompensated"){
      try{
        const current=await compensatedRequest(ctx,row.swapId);
        if(!current){await ctx.db.patch(row._id,{reconcileAfter:now+60000,updatedAt:now});return {status:"waiting_for_sync"};}
        if(request.args!==null&&!sameRequest(request,current))throw Error("The original stock release evidence changed.");
        request=current;
      }catch{await ctx.db.patch(row._id,{state:"review",leaseToken:undefined,leaseUntil:undefined,reconcileAfter:request.args?now:undefined,updatedAt:now});await notifyStockReview(ctx,row);return {status:"review"};}
    }
    await ctx.db.patch(row._id,{request,leaseToken:args.token,leaseUntil:now+60000,reconcileAfter:now+60000,updatedAt:now});
    return {status:"leased",request};
  },
});

export const releaseLease = internalMutation({
  args:{id:v.id("swap_stock_operations"),token:v.string()},
  handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.id);
    if(row?.state==="pending"&&row.leaseToken===args.token){
      const now=Date.now(),attempts=(row.reconcileAttempts??0)+1;
      await ctx.db.patch(row._id,{state:attempts>=8?"review":"pending",leaseToken:undefined,leaseUntil:undefined,reconcileAttempts:attempts,reconcileAfter:attempts>=8?(row.operation==="releaseCompensated"&&row.request.args?now:undefined):now+Math.min(60,2**attempts)*60000,updatedAt:now});
      if(attempts>=8)await notifyStockReview(ctx,row);
    }
  },
});

export const record = internalMutation({
  args:{id:v.id("swap_stock_operations"),token:v.string(),request:v.any(),receipt:v.any()},
  handler:async(ctx,args)=>{
    const row=await ctx.db.get(args.id);
    if(!row||!sameRequest(row.request,args.request))throw Error("Stock operation identity changed.");
    if(row.state!=="pending")return row.state;
    if(row.leaseToken!==args.token)return "stale";
    const receipt=args.receipt;
    const expected=row.operation==="acquire"?"prepared":row.operation==="beginExecution"?"execution_started":row.operation==="releaseCompensated"?"compensated_released":"released";
    if(!receipt||receipt.state!==expected||typeof receipt.replayed!=="boolean"||(row.operation==="acquire"&&(typeof receipt.requestId!=="string"||typeof receipt.fingerprint!=="string"))){
      await ctx.db.patch(row._id,{state:"review",leaseToken:undefined,leaseUntil:undefined,reconcileAfter:undefined,updatedAt:Date.now()});
      await notifyStockReview(ctx,row);
      return "review";
    }
    if(row.operation==="releaseCompensated"){
      return finalizeCompensatedRelease(ctx,row,receipt);
    }
    if(row.operation==="releasePrepared"){
      const swap=await ctx.db.get(row.swapId);
      const execution=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",q=>q.eq("swapId",row.swapId).eq("operation","beginExecution")).unique();
      if(!swap||!safeToRelease(swap)||execution){await ctx.db.patch(row._id,{state:"review",receipt,leaseToken:undefined,leaseUntil:undefined,reconcileAfter:undefined,updatedAt:Date.now()});await notifyStockReview(ctx,row);return "review";}
      const booking=swap.bookingId?await ctx.db.get(swap.bookingId):null;
      if(booking?.activeItemSwapId===row.swapId){
        const reservations=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",booking._id)).collect();
        for(const reservation of reservations)if(reservation.status==="hold"&&reservation.externalRef===`swap:${row.swapId}`)await ctx.db.patch(reservation._id,{status:"cancelled"});
        await ctx.db.patch(booking._id,{activeItemSwapId:undefined});
      }
    }
    await ctx.db.patch(row._id,{state:"confirmed",receipt,leaseToken:undefined,leaseUntil:undefined,reconcileAfter:undefined,updatedAt:Date.now()});
    if(row.operation==="acquire")await releaseClosedClaim(ctx,await ctx.db.get(row.swapId));
    return "confirmed";
  },
});

export const due = internalQuery({args:{},handler:async(ctx)=>ctx.db.query("swap_stock_operations").withIndex("by_state_due",q=>q.eq("state","pending").gte("reconcileAfter",0).lte("reconcileAfter",Date.now())).take(20)});
export const reviewDue = internalQuery({args:{},handler:async(ctx)=>ctx.db.query("swap_stock_operations").withIndex("by_state_due",q=>q.eq("state","review").gte("reconcileAfter",0).lte("reconcileAfter",Date.now())).take(20)});
export const recordReviewCheck = internalMutation({args:{id:v.id("swap_stock_operations"),request:v.any(),result:v.any(),expectedDue:v.number(),expectedAttempts:v.number()},handler:async(ctx,args)=>{
  const row=await ctx.db.get(args.id);
  if(!row||row.state!=="review"||row.operation!=="releaseCompensated"||row.reconcileAfter!==args.expectedDue||(row.reconcileAttempts??0)!==args.expectedAttempts||!row.request.args||!sameRequest(row.request.args,args.request.args))return;
  const attempts=(row.reconcileAttempts??0)+1,now=Date.now();
  const savedReceipt=row.receipt;
  if(savedReceipt&& (savedReceipt.state!=="compensated_released"||typeof savedReceipt.replayed!=="boolean"||args.result?.status!=="confirmed"||!sameRequest(savedReceipt,args.result.result)))return;
  if(savedReceipt||args.result?.status==="confirmed"&&args.result.result?.state==="compensated_released"&&typeof args.result.result?.replayed==="boolean"){
    return finalizeCompensatedRelease(ctx,row,savedReceipt??args.result.result);
  }else await ctx.db.patch(row._id,{reconcileAttempts:attempts,reconcileAfter:attempts>=16?undefined:now+Math.min(60,2**Math.min(attempts,6))*60000,updatedAt:now});
}});
export const checkReview = internalAction({args:{id:v.id("swap_stock_operations")},handler:async(ctx,args):Promise<void>=>{
  const row=await ctx.runQuery(internal.swapStockOperations.read,{id:args.id});
  if(!row||row.state!=="review"||row.operation!=="releaseCompensated"||!row.request.args||typeof row.reconcileAfter!=="number"||row.reconcileAfter>Date.now())return;
  const request={operation:"checkCompensatedRelease" as const,args:row.request.args};
  let result:any;
  if(row.receipt?.state==="compensated_released"&&typeof row.receipt.replayed==="boolean")result={status:"confirmed",result:row.receipt};
  else if(row.receipt)return;
  else try{result=await ctx.runAction(internal.sharedStockBridge.send,{request});}
  catch{result={status:"unavailable"};}
  await ctx.runMutation(internal.swapStockOperations.recordReviewCheck,{id:args.id,request,result,expectedDue:row.reconcileAfter,expectedAttempts:row.reconcileAttempts??0});
}});

export const reconcile = internalAction({args:{},handler:async(ctx):Promise<void>=>{
  if(!swapAuthorityAvailable()||process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL!=="true")return;
  const rows=await ctx.runQuery(internal.swapStockOperations.due,{});
  for(const row of rows)await ctx.runAction(internal.swapStockOperations.recover,{id:row._id}).catch(()=>undefined);
  const reviews=await ctx.runQuery(internal.swapStockOperations.reviewDue,{});
  for(const row of reviews)await ctx.runAction(internal.swapStockOperations.checkReview,{id:row._id}).catch(()=>undefined);
}});

export const recover = internalAction({
  args:{id:v.id("swap_stock_operations")},
  handler:async(ctx,args):Promise<{status:string}>=>{
    const token=crypto.randomUUID();
    const lease=await ctx.runMutation(internal.swapStockOperations.lease,{id:args.id,token});
    if(lease.status!=="leased")return {status:lease.status};
    try{
      const result=await ctx.runAction(internal.sharedStockBridge.send,{request:lease.request});
      if(result.status!=="confirmed")return {status:result.status};
      const status=await ctx.runMutation(internal.swapStockOperations.record,{id:args.id,token,request:lease.request,receipt:result.result});
      return {status};
    }finally{
      await ctx.runMutation(internal.swapStockOperations.releaseLease,{id:args.id,token});
    }
  },
});
