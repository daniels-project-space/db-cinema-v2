import { belongsToRentalAccount } from './rentalAccount';
import { completeRentalRefundReceipts, fullyConfirmedRentalRefund } from './rentalRefundReceipts';

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
     row.state!=='accepted' || row.refundOnlyRequest || row.consentVersion!=='rental-swap-price-difference-v1' ||
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

/** The admin price-concession decision must survive an asynchronous deposit
 * refund, while preserving both locks if either bank receipt changes. */
export async function compoundRefundOnlyBinding(ctx:any, addition:any, refund:any, proposedDecision?:any) {
 const row=addition?.swapProposalId?await ctx.db.get(addition.swapProposalId):null;
 const booking=addition?await ctx.db.get(addition.bookingId):null;
 const request=row?await ctx.db.get(row.changeRequestId):null;
 const account=request?await ctx.db.get(request.accountId):null;
 const decision=proposedDecision??row?.refundOnlyRequest;
 if(!row||!addition||!booking||!request||!decision||!compoundSwapShape(row)||
  row.state!=='accepted'||row.consentVersion!=='rental-swap-price-difference-v1'||
  row.settlementAdditionId!==addition._id||row.settlementRefundId!==refund?._id||
  row.bookingId!==booking._id||refund.bookingId!==booking._id||refund.swapProposalId!==row._id||
  addition.changeRequestId!==request._id||request.swapProposalId!==row._id||request.additionRequestId!==addition._id||
  row.accountId!==request.accountId||!belongsToRentalAccount(booking,account)||
  !['confirmed','active'].includes(booking.status)||booking.cancellationDecision||booking.returnDecision||booking.returnedAt||booking.activeExtensionId||
  booking.activeAdditionId!==addition._id||booking.activeSwapRefundId!==refund._id||
  !fullyConfirmedRentalRefund(refund)||decision.refundedPence!==refund.amountPence||decision.refundedPence!==row.refundPence||
  decision.reason.trim().length<5||decision.reason.length>400||!Number.isSafeInteger(decision.requestedAt)||
  decision.securityAtClosure.depositPaidPence!==Math.round(booking.depositAmount*100)||
  decision.securityAtClosure.holdPence!==Math.round((booking.depositHoldAmount??0)*100)||
  !['paid','held','withdrawing','refund_pending','refund_failed'].includes(addition.status)||
  !addition.paymentIntentId||!addition.sessionId||addition.lineTotal!==0||Math.round(addition.securityCharge*100)!==row.securityChargePence)
  throw Error('The saved combined refund-only decision or bank receipts need reconciliation.');
 const reservations=await ctx.db.query('reservations').withIndex('by_booking',(q:any)=>q.eq('bookingId',booking._id)).take(201);
 if(reservations.length>200||reservations.some((r:any)=>r.externalRef===`addition:${addition._id}`&&(r.source!=='site'||r.status==='active')))
  throw Error('The replacement handover or stock history needs reconciliation before closing.');
 return {row,booking,request,decision};
}
