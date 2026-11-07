import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { queueOwnerNotification } from "./lib/adminPush";
import { accountForRental, belongsToRentalAccount } from "./lib/rentalAccount";
import { postRentalMessage } from "./lib/rentalChat";
import { internal } from "./_generated/api";
import { verificationValidUntil } from "../shared/verificationProgress";

export const due = internalQuery({ args: {}, handler: async ctx => ctx.db.query("bookings").withIndex("by_rmv2_sync_due", q => q.eq("rmv2SyncStatus", "pending").lte("rmv2SyncDueAt", Date.now())).take(10) });
export const claim = internalMutation({ args: { bookingId: v.id("bookings"), revision: v.number() }, handler: async (ctx, args) => {
  const b = await ctx.db.get(args.bookingId);
  if (!b || b.rmv2Revision !== args.revision || b.rmv2SyncStatus !== "pending" || (b.rmv2SyncLeaseUntil ?? 0) > Date.now() || (b.rmv2SyncDueAt ?? 0) > Date.now()) return null;
  const generation = (b.rmv2SyncLeaseGeneration ?? 0) + 1;
  if (!Number.isSafeInteger(generation) || generation < 1) throw Error("Invalid delivery lease generation");
  const leaseUntil = Date.now() + 60000;
  await ctx.db.patch(b._id, { rmv2SyncLeaseUntil: leaseUntil, rmv2SyncDueAt: leaseUntil, rmv2SyncLeaseGeneration: generation });
  return { generation };
} });
export const record = internalMutation({ args: { bookingId: v.id("bookings"), revision: v.number(), generation: v.number(), ok: v.boolean(), reason: v.optional(v.string()), stockAcknowledgement:v.optional(v.union(v.object({swapId:v.id("rental_item_swaps"),managerRequestId:v.string(),fingerprint:v.string(),executionKey:v.string(),bookingRevision:v.number()}),v.object({kind:v.literal("booking_confirmation"),managerRequestId:v.string(),fingerprint:v.string(),executionKey:v.string(),bookingRevision:v.number()}))) }, handler: async (ctx, args) => {
  const booking = await ctx.db.get(args.bookingId);
  if (!booking || (booking.rmv2Revision ?? 0) !== args.revision || booking.rmv2DeliveredRevision === args.revision || booking.rmv2SyncStatus !== "pending" || booking.rmv2SyncLeaseGeneration !== args.generation || typeof booking.rmv2SyncLeaseUntil !== "number") return;
  if (args.ok) {
    if(args.stockAcknowledgement){
      const ack=args.stockAcknowledgement;
      if("kind" in ack){
        const receipt=await ctx.db.query("booking_stock_claims").withIndex("by_booking",q=>q.eq("bookingId",booking._id)).unique();
        if(!receipt||receipt.state!=="applied"||receipt.acknowledgedAt||receipt.bookingRevision!==ack.bookingRevision||receipt.managerRequestId!==ack.managerRequestId||receipt.fingerprint!==ack.fingerprint||ack.executionKey!==`booking_execution_${booking._id}`)throw Error("Stock acknowledgement needs reconciliation.");
        await ctx.db.patch(receipt._id,{acknowledgedAt:Date.now(),updatedAt:Date.now()});
      }else{
        const receipt=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_swap",q=>q.eq("swapId",ack.swapId)).unique();
        if(!receipt||receipt.bookingId!==booking._id||receipt.deliveryState!=="pending"||receipt.bookingRevision!==ack.bookingRevision||receipt.managerRequestId!==ack.managerRequestId||receipt.fingerprint!==ack.fingerprint||receipt.executionKey!==ack.executionKey)throw Error("Stock acknowledgement needs reconciliation.");
        const swap=await ctx.db.get(ack.swapId);
        if(!swap||swap.bookingId!==booking._id||booking.activeItemSwapId!==swap._id)throw Error("The equipment change fence needs reconciliation.");
        await ctx.db.patch(receipt._id,{deliveryState:"acknowledged",acknowledgedAt:Date.now(),auditInitializedAt:Date.now(),auditDueAt:Date.now()+3600000});
        const account=await ctx.db.get(swap.accountId);
        const safe=receipt.stockRisk!==true&&booking.status==="confirmed"&&booking.idVerifyStatus==="verified"&&(verificationValidUntil(booking)??0)>Date.now()&&!booking.cancellationDecision&&!booking.returnDecision&&!!account&&account.blockedAt==null&&belongsToRentalAccount(booking,account);
        if(!safe){
          await queueOwnerNotification(ctx,{eventKey:`swap-acknowledgement-review:${swap._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:booking._id,title:"Equipment change needs review",body:"Rental Manager confirmed the stock change, but the rental or account changed. The rental remains locked; review verification and inventory before handover."});
        }else if(["applied","refund_pending"].includes(swap.status)){
          if(swap.status==="applied")await ctx.db.patch(booking._id,{activeItemSwapId:undefined});
          await ctx.db.patch(receipt._id,{confirmationSentAt:Date.now()});
          const detail=`${swap.oldLine.qty} × ${swap.oldLine.title} replaced by ${swap.newLine.qty} × ${swap.newLine.title}.${swap.status==="refund_pending"?" Your refund is being processed.":""}`;
          await postRentalMessage(ctx,{accountId:swap.accountId,bookingId:booking._id,sender:"system",text:`Your equipment change is confirmed: ${detail}`});
          await ctx.scheduler.runAfter(0,internal.notify.changeEmail,{bookingId:booking._id,expectedAccountId:swap.accountId,kind:"equipment updated",detail});
        }
      }
    }
    if(!args.stockAcknowledgement&&booking.status==="pending_verification"&&booking.activeItemSwapId){
      const swap=await ctx.db.get(booking.activeItemSwapId);
      const receipt=swap?await ctx.db.query("swap_stock_applied_receipts").withIndex("by_swap",q=>q.eq("swapId",swap._id)).unique():null;
      if(swap&&receipt?.deliveryState==="pending")await queueOwnerNotification(ctx,{eventKey:`swap-acknowledgement-review:${swap._id}`,kind:"checkout_failure",accountId:swap.accountId,bookingId:booking._id,title:"Equipment change needs review",body:"Verification changed while the stock change was being confirmed. The rental remains locked; review verification and inventory before handover."});
    }
    if(!args.stockAcknowledgement&&booking.status==="confirmed"&&booking.activeItemSwapId){
      const receipt=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_swap",q=>q.eq("swapId",booking.activeItemSwapId!)).unique();
      if(receipt?.deliveryState==="acknowledged")await ctx.db.patch(receipt._id,{auditDueAt:Date.now(),auditAttempts:0});
    }
    await ctx.db.patch(booking._id, { rmv2DeliveredRevision: args.revision, rmv2SyncStatus: "delivered", rmv2SyncDeliveredAt: Date.now(), rmv2SyncError: undefined, rmv2SyncLeaseUntil: undefined });
    if(args.stockAcknowledgement){
      const remaining=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_delivery",q=>q.eq("bookingId",booking._id).eq("deliveryState","pending")).first();
      if(remaining)await queueRmv2Sync(ctx,booking._id);
    }
    return;
  }
  const attempts = (booking.rmv2SyncAttempts ?? 0) + 1;
  await ctx.db.patch(booking._id, { rmv2SyncAttempts: attempts, rmv2SyncStatus: attempts >= 12 ? "attention" : "pending", rmv2SyncDueAt: Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7)), rmv2SyncError: args.reason?.slice(0, 100) ?? "delivery_failed", rmv2SyncLeaseUntil: undefined });
  if(attempts===1){
    const swapReceipt=await ctx.db.query("swap_stock_applied_receipts").withIndex("by_booking_delivery",q=>q.eq("bookingId",booking._id).eq("deliveryState","pending")).first();
    const initialClaim=await ctx.db.query("booking_stock_claims").withIndex("by_booking",q=>q.eq("bookingId",booking._id)).unique();
    if(swapReceipt||initialClaim?.state==="applied"&&!initialClaim.acknowledgedAt){
      const account=await accountForRental(ctx,booking);
      await queueOwnerNotification(ctx,{eventKey:`stock-sync-risk:${booking._id}:${args.revision}`,kind:"checkout_failure",...(account?{accountId:account._id}:{}),bookingId:booking._id,title:"Rental stock needs checking",body:"Rental Manager has not confirmed this stock change. Check availability and the payment before handover or further changes; the site is retrying."});
    }
  }
  if (attempts === 3 || attempts >= 12) {
    const account = await accountForRental(ctx, booking);
    await queueOwnerNotification(ctx, { eventKey: `rental-manager-sync:${booking._id}:${args.revision}:${attempts >= 12 ? "attention" : "retrying"}`, kind: "checkout_failure", ...(account ? { accountId: account._id } : {}), bookingId: booking._id, title: attempts >= 12 ? "Rental Manager sync needs attention" : "Rental Manager sync delayed", body: attempts >= 12 ? "The rental update could not be confirmed by Rental Manager. Check the rental and inventory before handover or further changes." : "Rental Manager has not confirmed this rental update yet. We are retrying; check inventory before handover." });
  }
} });
export const status = query({ args: { token: v.string(), bookingId: v.id("bookings") }, handler: async (ctx, args) => {
  if (!checkAdminToken(args.token)) throw Error("unauthorized");
  const b = await ctx.db.get(args.bookingId);
  return b ? { status: b.rmv2SyncStatus ?? "unknown", revision: b.rmv2Revision ?? 0, deliveredRevision: b.rmv2DeliveredRevision ?? null, attempts: b.rmv2SyncAttempts ?? 0, error: b.rmv2SyncError ?? null, deliveredAt: b.rmv2SyncDeliveredAt ?? null } : null;
} });
export const retry = mutation({ args: { token: v.string(), bookingId: v.id("bookings") }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "rmv2Delivery.retry");
  await queueRmv2Sync(ctx, args.bookingId);
} });
