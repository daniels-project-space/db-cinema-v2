import type { MutationCtx } from '../_generated/server';
import type { Id, Doc } from '../_generated/dataModel';
import { approvedKitRequest, assertKitAddition } from './kitRequestBinding';
import { paidSwapPlan, swapStockWindow } from './rentalSwapSettlement';
import { accountForRental } from './rentalAccount';
import { postRentalMessage } from './rentalChat';
import { queueRmv2Sync } from './rmv2SyncQueue';
import { assertRenterExposure, replacementValues } from './rentalExposure';
import { assertRentalInventory } from './rentalInventory';
import { canDeferAdditionSecurity } from '../../shared/pickupSecurity';
import { schedulePickupHold } from '../pickupSecurity';
import { internal } from '../_generated/api';
import { compoundRefundBinding, compoundSwapShape } from './compoundSwap';
import { fullyConfirmedRentalRefund } from './rentalRefundReceipts';
async function note(ctx: MutationCtx, b: Doc<'bookings'>, text: string) {
 const account=await accountForRental(ctx,b);
 if(account)await postRentalMessage(ctx,{accountId:account._id,bookingId:b._id,sender:'system',text});
}
/** One atomic equipment/stock receipt, shared by paid checkout and bank refund completion. */
export async function applyRentalAddition(ctx: MutationCtx, id: Id<'rental_additions'>) {

    const r = await ctx.db.get(id);
    if (!r) return { closed: true };
    if (r.status === "applied" || r.status === "applied_draft")
      return { applied: true, already: true };
    if (r.withdrawalRequestedAt) return { closed: true };
    if (r.securityCreationPending) throw Error("Wait for the pending security authorisation");
    const b = await ctx.db.get(r.bookingId);
    if (
      !b ||
      b.cancellationDecision ||
      b.returnDecision ||
      b.activeAdditionId !== id ||
      !["pending_payment", "confirmed", "active"].includes(b.status) ||
      (r.draftReplacement && b.status !== "pending_payment")
    )
      return { closed: true };
    if(!r.swapProposalId)assertKitAddition(await approvedKitRequest(ctx,b,r.changeRequestId,r._id),r.listingId,r.qty);
    const swap = r.swapProposalId ? await paidSwapPlan(ctx,b,r) : null;
    if(r.swapProposalId&&!swap)return {closed:true};
    const compound=!!swap&&compoundSwapShape(swap.row);
    if(compound){
      const refund=await ctx.db.get(swap.row.settlementRefundId);
      await compoundRefundBinding(ctx,refund);
      if(!fullyConfirmedRentalRefund(refund))return {needsRefund:true};
    }
    if (
      (!r.paymentIntentId && !r.complimentary) ||
      (!r.draftReplacement && r.holdTotal > 0 && r.status !== "held" && !canDeferAdditionSecurity(b))
    )
      throw Error(
        "Payment and replacement card hold must be ready before items are attached",
      );
    const line = {
      listingId: r.listingId,
      title: r.title,
      start: r.start,
      end: r.end,
      qty: r.qty,
      lineTotal: r.lineTotal,
      dailyRate: r.dailyRate,
    };
    const finalLines:Doc<"bookings">["lineItems"] = swap ? swap.quote.finalLines : [...b.lineItems,line];
    try {
      await assertRenterExposure(ctx, b, finalLines);
      await assertRentalInventory(ctx, finalLines, b._id);
    } catch (e) {
      if (/unavailable|already reserved|Inventory capacity|replacement value|overlapping rentals/.test(String(e)))
        return { closed: true };
      throw e;
    }
    const patch: any = {
      replacementValues: await replacementValues(ctx, b, finalLines),
      lineItems: finalLines,
      subtotal: b.subtotal + (compound ? swap.row.differencePence/100 : r.lineTotal),
      total: b.total + r.lineTotal + r.securityCharge,
      depositAmount: b.depositAmount + r.securityCharge,
      depositHoldAmount: r.holdTotal,
      activeAdditionId: undefined,
      ...(compound ? { activeSwapRefundId: undefined } : {}),
    };
    if (
      !r.draftReplacement &&
      r.holdIntentId &&
      r.holdIntentId !== b.stripeDepositIntentId
    ) {
      patch.stripeDepositIntentId = r.holdIntentId;
      patch.depositHoldStatus = "held";
      patch.depositHoldExpiresAt = r.holdExpiresAt;
      patch.depositHoldPreviousIntentIds = [
        ...(b.depositHoldPreviousIntentIds ?? []),
        ...(b.stripeDepositIntentId ? [b.stripeDepositIntentId] : []),
      ];
    }
    if (r.draftReplacement) patch.stripeCheckoutSessionId = r.sessionId;
    if(b.securityWaiverReason==="safe_repeat_kit"&&r.securityCharge>0)patch.securityWaiverReason=undefined;
    if(r.membershipCheckoutId)patch.rentalPaidPence=Math.round((b.total+r.lineTotal+r.securityCharge)*100);
    const deferred=!r.draftReplacement&&canDeferAdditionSecurity(b);
    if(deferred&&(r.holdIntentId||r.securityCreationParams))throw Error("Reconcile the existing addition authorisation before changing the pickup schedule");
    await ctx.db.patch(b._id, patch);
    if(deferred)await schedulePickupHold(ctx,{...b,...patch},true);
    await ctx.db.patch(id, {
      status: r.draftReplacement ? "applied_draft" : "applied",
      updatedAt: Date.now(),
    });
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    if(swap){
      for(const reservation of reservations)if(reservation.status==="confirmed"||reservation.externalRef===`addition:${id}`)
        await ctx.db.patch(reservation._id,{status:"cancelled",holdExpiresAt:undefined});
      for(const item of finalLines){
        const listing=await ctx.db.get(item.listingId);
        if(!listing?.components.length)throw Error("The replacement inventory mapping needs review.");
        for(const component of listing.components)await ctx.db.insert("reservations",{bookingId:b._id,listingId:item.listingId,inventoryUnitId:component.inventoryUnitId,...swapStockWindow(item,swap.quote.allocationMode),qty:item.qty*component.qty,status:"confirmed",source:"site"});
      }
      const now=Date.now(),operationKey=`kit-swap:${b._id}:${swap.row._id}:${swap.row.quoteKey}`;
      await ctx.db.patch(swap.row._id,{state:"applied",appliedAt:now,updatedAt:now});
      await ctx.db.patch(swap.request._id,{execution:{operation:"kit_swap",operationKey,status:"applied",startedAt:r.createdAt,appliedAt:now,detail:`${r.qty}× ${swap.row.sourceTitle} → ${r.title}. ${compound?`£${(swap.row.refundPence/100).toFixed(2)} rental refund confirmed; £${r.securityCharge.toFixed(2)} additional refundable deposit paid.`:`Rental difference £${r.lineTotal.toFixed(2)} paid.`}`}});
    }else for (const reservation of reservations)
      if (!r.draftReplacement && reservation.externalRef === `addition:${id}`)
        await ctx.db.patch(reservation._id, {
          status: b.status === "active" ? "active" : "confirmed",
          holdExpiresAt: undefined,
        });
    await note(
      ctx,
      b,
      swap ? `The equipment swap is confirmed: ${r.qty}× ${swap.row.sourceTitle} → ${r.title}. ${compound?`£${(swap.row.refundPence/100).toFixed(2)} rental refund confirmed to the original payment method; additional refundable deposit £${r.securityCharge.toFixed(2)} paid`:`Rental difference £${r.lineTotal.toFixed(2)}${r.securityCharge ? `; additional refundable security £${r.securityCharge.toFixed(2)}` : ""}`}.` : `Added to your rental: ${r.qty}× ${r.title}. Rental charge £${r.lineTotal.toFixed(2)}${r.securityCharge ? `; refundable security £${r.securityCharge.toFixed(2)}` : ""}.`,
    );
    await queueRmv2Sync(ctx, b._id);
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId: b._id,
      kind: swap ? "kit updated" : "item added",
      detail: compound ? `${r.qty}× ${r.title}. £${(swap.row.refundPence/100).toFixed(2)} rental refund confirmed separately from £${r.securityCharge.toFixed(2)} additional refundable deposit paid.` : `${r.qty}× ${r.title}. £${r.lineTotal.toFixed(2)} rental charge${r.securityCharge ? ` and £${r.securityCharge.toFixed(2)} refundable security` : ""}.`,
    });
    return { applied: true };
}
