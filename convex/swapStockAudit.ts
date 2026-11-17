import { v } from "convex/values";
import { action, query, mutation, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { queueOwnerNotification } from "./lib/adminPush";
import { swapAuthorityAvailable } from "./lib/rentalSwapAuthority";
import { postRentalMessage } from "./lib/rentalChat";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { verificationValidUntil } from "../shared/verificationProgress";
import { assertRentalAllocation } from "./lib/rentalAllocation";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { adminSessionMigrationReady, assertAdminScopeSession } from "./adminAccountSessionV2";
import { assertStockExecution } from "./swapStockOperations";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";

const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const evidenceFor=(receipt:any)=>({swapId:String(receipt.swapId),bookingId:String(receipt.bookingId),bookingRevision:receipt.bookingRevision,managerRequestId:receipt.managerRequestId,fingerprint:receipt.fingerprint,executionKey:receipt.executionKey,appliedAt:receipt.appliedAt,windows:receipt.windows.map((window:any)=>({...window,reservationId:String(window.reservationId),inventoryUnitId:String(window.inventoryUnitId)}))});

async function stockAdminRead(ctx:any,token:string){
  if(process.env.ADMIN_SESSION_SWAP_STOCK_V2!=="enabled"){if(!checkAdminToken(token))throw Error("unauthorized");return;}
  if(!adminSessionMigrationReady())throw Error("Admin session migration is not ready.");
  await assertAdminScopeSession(ctx,token,"rentals:read");
}
async function stockAdminWrite(ctx:any,token:string,fn:string){
  if(process.env.ADMIN_SESSION_SWAP_STOCK_V2!=="enabled")return assertAdmin(ctx,token,fn);
  if(!adminSessionMigrationReady())throw Error("Admin session migration is not ready.");
  await assertAdminScopeSession(ctx,token,"rentals:write");
  await ctx.db.insert("admin_audit_log",{at:Date.now(),success:true,limited:false,fn});
}

async function exactAllocation(ctx:any,booking:any,receipt:any){
  try{
    const rows=await ctx.db.query("reservations").withIndex("by_booking",(q:any)=>q.eq("bookingId",booking._id)).collect();
    if(rows.some((row:any)=>row.status==="hold"))return false;
    await assertRentalAllocation(ctx,booking,rows);
    const actual=[];
    for(const row of rows.filter((value:any)=>value.source==="site"&&!value.extensionRequestId&&["confirmed","active"].includes(value.status))){
      const unit=await ctx.db.get(row.inventoryUnitId);
      if(!unit?.rmv2ItemId||row.endExclusive!==true||row.turnaroundBufferMinutes!==60)return false;
      actual.push(JSON.stringify([String(row._id),String(row.inventoryUnitId),unit.rmv2ItemId,row.start,row.end,row.qty,row.endExclusive,row.turnaroundBufferMinutes]));
    }
    const expected=receipt.windows.map((row:any)=>JSON.stringify([String(row.reservationId),String(row.inventoryUnitId),row.managerItemId,row.start,row.end,row.quantity,row.endExclusive,row.turnaroundBufferMinutes]));
    return actual.length>0&&actual.length===expected.length&&JSON.stringify(actual.sort())===JSON.stringify(expected.sort());
  }catch{return false;}
}

export const due = internalQuery({args:{},handler:async ctx=>ctx.db.query("swap_stock_applied_receipts").withIndex("by_audit_due",q=>q.gte("auditDueAt",0).lte("auditDueAt",Date.now())).take(20)});

export const conflicts = query({args:{token:v.string(),bookingId:v.id("bookings")},handler:async(ctx,args)=>{
  await stockAdminRead(ctx,args.token);
  const risks=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_stock_risk",q=>q.eq("bookingId",args.bookingId).eq("stockRisk",true)).take(20);
  const legacy=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_delivery",q=>q.eq("bookingId",args.bookingId).eq("deliveryState",undefined)).take(20);
  const pending=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_delivery",q=>q.eq("bookingId",args.bookingId).eq("deliveryState","pending")).take(20);
  const rows=[...new Map([...legacy,...pending,...risks].map(row=>[String(row._id),row])).values()];
  return Promise.all(rows.map(async row=>{const swap=await ctx.db.get(row.swapId);return {id:row._id,legacy:row.deliveryState===undefined,pending:row.deliveryState==="pending",oldTitle:swap?.oldLine.title??"Original item",newTitle:swap?.newLine.title??"Replacement item"};}));
}});

/**
 * Legacy receipt recovery is automatic only when the immutable stock claim,
 * the saved receipt window, and today's exact local allocation still agree.
 * Any uncertainty leaves the existing rental fence in place for review.
 */
async function legacyDeliveryCandidate(ctx:any,receiptId:any,bookingId?:any):Promise<any>{
  if(!swapAuthorityAvailable()||process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL!=="true")return {error:"Stock receipt recovery is not enabled."};
  const receipt=await ctx.db.get(receiptId),booking=receipt?await ctx.db.get(receipt.bookingId):null;
  if(!receipt||bookingId&&receipt.bookingId!==bookingId||receipt.deliveryState!==undefined||receipt.acknowledgedAt!==undefined||receipt.stockRisk===true||!booking||booking.status!=="confirmed"||booking.cancellationDecision||booking.returnDecision)return {error:"This receipt needs individual stock review."};
  const swap=await ctx.db.get(receipt.swapId);
  if(!swap||swap.bookingId!==booking._id||swap.status!=="applied"||swap.stockAppliedAt!==receipt.appliedAt||booking.activeItemSwapId&&booking.activeItemSwapId!==swap._id||booking.activeAdditionId||booking.activeDeliveryQuoteId||booking.activeExtensionId||booking.activePriceAdjustmentId)return {error:"The rental has another operation or inconsistent receipt."};
  if((booking.rmv2SyncLeaseUntil??0)>Date.now()||!Number.isSafeInteger(booking.rmv2Revision)||!Number.isSafeInteger(receipt.bookingRevision)||receipt.bookingRevision>booking.rmv2Revision||receipt.bookingRevision<1||!await exactAllocation(ctx,booking,receipt))return {error:"The current stock allocation or delivery needs individual review."};
  const oldest=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_delivery",(q:any)=>q.eq("bookingId",booking._id).eq("deliveryState",undefined)).first();
  const pending=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_delivery",(q:any)=>q.eq("bookingId",booking._id).eq("deliveryState","pending")).first();
  if(oldest?._id!==receipt._id||pending)return {error:"Review earlier or pending stock receipts first."};
  try{await assertStockExecution(ctx,swap._id);}catch{return {error:"The equipment stock execution is not confirmed."};}
  const claim=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",(q:any)=>q.eq("swapId",swap._id).eq("operation","acquire")).unique();
  const execution=await ctx.db.query("swap_stock_operations").withIndex("by_swap_operation",(q:any)=>q.eq("swapId",swap._id).eq("operation","beginExecution")).unique();
  if(claim?.receipt?.requestId!==receipt.managerRequestId||claim.receipt.fingerprint!==receipt.fingerprint||execution?.request?.args?.executionKey!==receipt.executionKey)return {error:"The original stock claim does not match this receipt."};
  return {receipt,booking,swap};
}

async function queueLegacyDeliveryRetry(ctx:any,candidate:any){
  await ctx.db.patch(candidate.booking._id,{activeItemSwapId:candidate.swap._id});
  await ctx.db.patch(candidate.receipt._id,{deliveryState:"pending"});
  await queueRmv2Sync(ctx,candidate.booking._id);
}

/** Recover only provably exact legacy receipts; Rental Manager still provides the acknowledgement. */
export const recoverSafeLegacyReceipts=internalMutation({args:{},handler:async ctx=>{
  if(!swapAuthorityAvailable()||process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL!=="true")return {scanned:0,queued:0,disabled:true};
  // Bounded indexed pages prevent a long-lived ambiguous receipt from starving
  // later rows. Unsafe rows stay visible in the admin stock review.
  const state=await ctx.db.query("swap_stock_audit_backfill").withIndex("by_key",q=>q.eq("key","safe-legacy-v1")).unique();
  const page=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_delivery_state",q=>q.eq("deliveryState",undefined)).paginate({cursor:state?.cursor??null,numItems:10});
  let queued=0;
  for(const receipt of page.page){
    const candidate=await legacyDeliveryCandidate(ctx,receipt._id);
    if(candidate.error)continue;
    await queueLegacyDeliveryRetry(ctx,candidate);
    queued++;
  }
  const update={cursor:page.isDone?null:page.continueCursor,complete:false,updatedAt:Date.now()};
  if(state)await ctx.db.patch(state._id,update);else await ctx.db.insert("swap_stock_audit_backfill",{key:"safe-legacy-v1",...update});
  return {scanned:page.page.length,queued,disabled:false};
}});

export const retryLegacyDelivery = mutation({args:{token:v.string(),bookingId:v.id("bookings"),id:v.id("swap_stock_applied_receipts"),confirmed:v.boolean()},handler:async(ctx,args)=>{
  await stockAdminWrite(ctx,args.token,"swapStockAudit.retryLegacyDelivery");
  if(!args.confirmed)throw Error("Confirm the receipt review first.");
  const candidate=await legacyDeliveryCandidate(ctx,args.id,args.bookingId);
  if(candidate.error)throw Error(candidate.error);
  await queueLegacyDeliveryRetry(ctx,candidate);
  return {status:"pending" as const};
}});

export const prepareManualCheck = internalMutation({args:{bookingId:v.id("bookings"),id:v.id("swap_stock_applied_receipts"),adminToken:v.optional(v.string())},handler:async(ctx,args)=>{
  if(process.env.ADMIN_SESSION_SWAP_STOCK_V2==="enabled")await stockAdminWrite(ctx,args.adminToken??"","swapStockAudit.recheck");
  const receipt=await ctx.db.get(args.id);
  if(!receipt||receipt.bookingId!==args.bookingId||receipt.deliveryState!=="acknowledged"||receipt.stockRisk!==true)throw Error("This stock conflict is no longer available for checking.");
  if((receipt.auditLeaseUntil??0)>Date.now())throw Error("A stock check is already in progress. Please try again shortly.");
  await ctx.db.patch(receipt._id,{auditDueAt:Date.now(),auditAttempts:0});
}});

export const manualCheckResult = internalQuery({args:{bookingId:v.id("bookings"),id:v.id("swap_stock_applied_receipts"),adminToken:v.optional(v.string())},handler:async(ctx,args)=>{
  if(process.env.ADMIN_SESSION_SWAP_STOCK_V2==="enabled")await stockAdminRead(ctx,args.adminToken??"");
  const receipt=await ctx.db.get(args.id);
  if(!receipt||receipt.bookingId!==args.bookingId)return {status:"review" as const};
  return {status:receipt.stockRisk===false?"clear" as const:"review" as const};
}});

export const recheck = action({args:{token:v.string(),bookingId:v.id("bookings"),id:v.id("swap_stock_applied_receipts")},handler:async(ctx,args):Promise<{status:"clear"|"review"}>=>{
  const scoped=process.env.ADMIN_SESSION_SWAP_STOCK_V2==="enabled";
  if(!scoped)await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:args.token,fn:"swapStockAudit.recheck"});
  if(!swapAuthorityAvailable()||process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL!=="true")throw Error("Live stock checking is not enabled.");
  await ctx.runMutation(internal.swapStockAudit.prepareManualCheck,{bookingId:args.bookingId,id:args.id,...(scoped?{adminToken:args.token}:{})});
  const token=crypto.randomUUID(),request=await ctx.runMutation(internal.swapStockAudit.claim,{id:args.id,token,...(scoped?{adminToken:args.token}:{})});
  if(!request)return {status:"review"};
  let result:any={status:"unknown"};
  try{result=await ctx.runAction(internal.sharedStockBridge.send,{request});}catch{}
  await ctx.runMutation(internal.swapStockAudit.record,{id:args.id,token,result,...(scoped?{adminToken:args.token}:{})});
  return ctx.runQuery(internal.swapStockAudit.manualCheckResult,{bookingId:args.bookingId,id:args.id,...(scoped?{adminToken:args.token}:{})});
}});

export const backfill = internalMutation({args:{},handler:async ctx=>{
  if(!swapAuthorityAvailable()||process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL!=="true")return;
  const state=await ctx.db.query("swap_stock_audit_backfill").withIndex("by_key",q=>q.eq("key","acknowledged-v1")).unique();
  if(state?.complete)return;
  const page=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_delivery_state",q=>q.eq("deliveryState","acknowledged")).paginate({cursor:state?.cursor??null,numItems:50});
  const now=Date.now();
  for(const receipt of page.page){
    if(receipt.auditInitializedAt!==undefined)continue;
    const booking=await ctx.db.get(receipt.bookingId);
    await ctx.db.patch(receipt._id,{auditInitializedAt:now,...(booking&&!["returned","cancelled"].includes(booking.status)?{auditDueAt:now+3600000}:{})});
  }
  const update={cursor:page.isDone?null:page.continueCursor,complete:page.isDone,updatedAt:now};
  if(state)await ctx.db.patch(state._id,update);else await ctx.db.insert("swap_stock_audit_backfill",{key:"acknowledged-v1",...update});
}});

export const claim = internalMutation({args:{id:v.id("swap_stock_applied_receipts"),token:v.string(),adminToken:v.optional(v.string())},handler:async(ctx,args)=>{
  if(args.adminToken!==undefined)await stockAdminWrite(ctx,args.adminToken,"swapStockAudit.claimManualCheck");
  const receipt=await ctx.db.get(args.id),now=Date.now();
  if(!receipt||receipt.deliveryState!=="acknowledged"||!receipt.auditDueAt||receipt.auditDueAt>now||(receipt.auditLeaseUntil??0)>now)return null;
  const booking=await ctx.db.get(receipt.bookingId),swap=await ctx.db.get(receipt.swapId);
  if(!booking||!swap||["cancelled","returned"].includes(booking.status)){await ctx.db.patch(args.id,{auditDueAt:undefined,auditLeaseToken:undefined,auditLeaseUntil:undefined});return null;}
  if(!["confirmed","active"].includes(booking.status)||!Number.isSafeInteger(booking.rmv2Revision)||(booking.rmv2Revision??0)<receipt.bookingRevision||booking.rmv2SyncStatus!=="delivered"||booking.rmv2DeliveredRevision!==booking.rmv2Revision||!await exactAllocation(ctx,booking,receipt)){
    await ctx.db.patch(args.id,{auditDueAt:undefined,auditLeaseToken:undefined,auditLeaseUntil:undefined});
    await queueOwnerNotification(ctx,{eventKey:`swap-stock-audit-changed:${args.id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:booking._id,title:"Equipment stock needs checking",body:"The rental changed after its equipment swap. Check the current inventory before handover; its earlier stock audit no longer applies."});
    return null;
  }
  const leaseUntil=now+60000;
  const evidence=evidenceFor(receipt);
  await ctx.db.patch(args.id,{auditLeaseToken:args.token,auditLeaseUntil:leaseUntil,auditDueAt:leaseUntil,auditRevision:booking.rmv2Revision,auditIdentity:JSON.stringify(canonical(evidence))});
  return {operation:"checkConversion" as const,args:{id:receipt.managerRequestId,fingerprint:receipt.fingerprint,executionKey:receipt.executionKey,receipt:evidence}};
}});

export const record = internalMutation({args:{id:v.id("swap_stock_applied_receipts"),token:v.string(),result:v.any(),adminToken:v.optional(v.string())},handler:async(ctx,args)=>{
  if(args.adminToken!==undefined)await stockAdminWrite(ctx,args.adminToken,"swapStockAudit.recordManualCheck");
  const receipt=await ctx.db.get(args.id);
  if(!receipt||receipt.auditLeaseToken!==args.token)return;
  const booking=await ctx.db.get(receipt.bookingId),swap=await ctx.db.get(receipt.swapId),now=Date.now();
  if(!booking||!swap||["cancelled","returned"].includes(booking.status)){await ctx.db.patch(args.id,{auditDueAt:undefined,auditLeaseToken:undefined,auditLeaseUntil:undefined});return;}
  const changed=!["confirmed","active"].includes(booking.status)||booking.rmv2Revision!==receipt.auditRevision||booking.rmv2SyncStatus!=="delivered"||booking.rmv2DeliveredRevision!==receipt.auditRevision||receipt.auditIdentity!==JSON.stringify(canonical(evidenceFor(receipt)))||!await exactAllocation(ctx,booking,receipt);
  const validResult=args.result?.status==="confirmed"&&typeof args.result.result?.stockRisk==="boolean";
  const risk=validResult&&args.result.result.stockRisk===true;
  const attempts=validResult&&!risk?0:(receipt.auditAttempts??0)+1;
  const held=booking.activeItemSwapId===swap._id,account=held?await ctx.db.get(swap.accountId):null;
  const canFence=(risk||attempts>=3)&&!changed&&!held&&booking.status==="confirmed"&&!booking.activeItemSwapId&&!booking.activeAdditionId&&!booking.activeDeliveryQuoteId&&!booking.activeExtensionId&&!booking.activePriceAdjustmentId&&!booking.cancellationDecision&&!booking.returnDecision;
  if(canFence)await ctx.db.patch(booking._id,{activeItemSwapId:swap._id});
  const heldAfter=held||canFence;
  const clear=!changed&&!risk&&args.result?.status==="confirmed"&&args.result.result?.stockRisk===false&&held&&swap.status==="applied"&&booking.status==="confirmed"&&booking.idVerifyStatus==="verified"&&(verificationValidUntil(booking)??0)>now&&!booking.cancellationDecision&&!booking.returnDecision&&!!account&&account.blockedAt==null&&belongsToRentalAccount(booking,account);
  if(changed||risk||attempts>=3){
    await queueOwnerNotification(ctx,{eventKey:`swap-stock-audit:${args.id}:${changed?"changed":risk?"risk":"unavailable"}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:booking._id,title:"Equipment stock needs checking",body:changed?"The rental changed during a stock check. Check current inventory before handover.":risk?heldAfter?"A possible external booking conflicts with this equipment swap. The rental is locked until stock is checked.":"A possible external booking conflicts with this equipment swap. Another rental operation may be in progress; check it before handover.":"Rental Manager could not confirm this equipment swap's availability. Check stock before handover."});
  }
  if(held&&swap.status==="applied"&&!changed&&!risk&&validResult&&!clear)await queueOwnerNotification(ctx,{eventKey:`swap-stock-audit:${args.id}:eligibility`,kind:"checkout_failure",accountId:swap.accountId,bookingId:booking._id,title:"Equipment change needs review",body:"The stock check succeeded, but the renter or booking is not eligible for automatic confirmation. The rental remains locked."});
  if(clear){
    await ctx.db.patch(booking._id,{activeItemSwapId:undefined});
    if(!receipt.confirmationSentAt){
      const detail=`${swap.oldLine.qty} × ${swap.oldLine.title} replaced by ${swap.newLine.qty} × ${swap.newLine.title}.`;
      await postRentalMessage(ctx,{accountId:swap.accountId,bookingId:booking._id,sender:"system",text:`Your equipment change is confirmed: ${detail}`});
      await ctx.scheduler.runAfter(0,internal.notify.changeEmail,{bookingId:booking._id,expectedAccountId:swap.accountId,kind:"equipment updated",detail});
    }
  }
  const stockRisk=!changed&&validResult?args.result.result.stockRisk:!changed&&attempts>=3?true:receipt.stockRisk;
  await ctx.db.patch(args.id,{stockRisk,auditDueAt:changed||attempts>=8?undefined:now+(attempts?Math.min(60,2**attempts)*60000:3600000),auditAttempts:attempts,auditLeaseToken:undefined,auditLeaseUntil:undefined,auditRevision:undefined,auditIdentity:undefined,...(clear&&!receipt.confirmationSentAt?{confirmationSentAt:now}:{})});
}});

export const runDue = internalAction({args:{},handler:async(ctx):Promise<void>=>{
  if(!swapAuthorityAvailable()||process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL!=="true")return;
  const receipts=await ctx.runQuery(internal.swapStockAudit.due,{});
  for(const receipt of receipts){
    const token=crypto.randomUUID(),request=await ctx.runMutation(internal.swapStockAudit.claim,{id:receipt._id,token});
    if(!request)continue;
    let result:any={status:"unknown"};
    try{result=await ctx.runAction(internal.sharedStockBridge.send,{request});}catch{}
    await ctx.runMutation(internal.swapStockAudit.record,{id:receipt._id,token,result});
  }
}});
