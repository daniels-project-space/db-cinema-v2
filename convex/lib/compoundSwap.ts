import { belongsToRentalAccount } from './rentalAccount';
import { completeRentalRefundReceipts } from './rentalRefundReceipts';

/** A rental refund and an additional refundable deposit are separate amounts. */
export function compoundSwapShape(row: any) {
 return row.differencePence < 0 && row.refundPence === -row.differencePence &&
  row.nonCashDifferencePence === 0 && Number.isSafeInteger(row.securityChargePence) &&
  row.securityChargePence > 0 && row.chargePence === row.securityChargePence;
}
export function compoundRefundCanClose(refund: any) {
 // providerGeneration fences read-only observations, not money attempts. A
 // combined refund cannot reach Stripe before its immutable allocations exist.
 return !!refund && (refund.status==='prepared' && !refund.allocations && !refund.parts?.length &&
  !refund.stripeRefundId ||
  refund.status==='failed' && completeRentalRefundReceipts(refund) && refund.parts.every((part:any)=>part.status==='failed'));
}

/** Durable reverse links and verified captured-payment attachment precede any
 * original-payment refund. Used again in the allocation transaction to fence
 * withdrawal racing the provider reads. No customer can supply these links. */
export async function compoundRefundBinding(ctx: any, refund: any) {
 if (!refund?.swapProposalId) return null;
 const row=await ctx.db.get(refund.swapProposalId);
 if (!row) throw Error('The saved swap refund needs reconciliation.');
 if (!row.settlementAdditionId) return null;
 const addition=await ctx.db.get(row.settlementAdditionId), booking=await ctx.db.get(refund.bookingId);
 const request=await ctx.db.get(row.changeRequestId), account=request?await ctx.db.get(request.accountId):null;
 if (!compoundSwapShape(row) || !addition || !booking || !request ||
     row.state!=='accepted' || row.consentVersion!=='rental-swap-price-difference-v1' ||
     row.settlementRefundId!==refund._id || row.bookingId!==booking._id ||
     addition.swapProposalId!==row._id || addition.bookingId!==booking._id ||
     addition.changeRequestId!==request._id || request.swapProposalId!==row._id ||
     request.additionRequestId!==addition._id || row.accountId!==request.accountId ||
     !belongsToRentalAccount(booking,account) || refund.amountPence!==row.refundPence ||
     booking.status!=='confirmed' || booking.pickedUpAt!=null || booking.cancellationDecision || booking.returnDecision ||
     booking.activeAdditionId!==addition._id || booking.activeSwapRefundId!==refund._id ||
     addition.lineTotal!==0 || Math.round(addition.securityCharge*100)!==row.securityChargePence ||
     Math.round(addition.holdTotal*100)!==row.holdTotalPence || addition.withdrawalRequestedAt ||
     !addition.paymentIntentId || !addition.sessionId || !['paid','held'].includes(addition.status))
  throw Error('The additional refundable deposit must be verified before the original rental refund can start.');
 return {row,addition,booking,request};
}
