import { rentalHasStarted } from '../../src/lib/cancellationPolicy';
import { canDeferAdditionSecurity } from '../../shared/pickupSecurity';
import { rentalSwapQuote, swapQuoteKey } from './rentalSwapQuote';
import { swapStockWindow } from './rentalSwapSettlement';
import { belongsToRentalAccount } from './rentalAccount';
import { replacementValues } from './rentalExposure';
import { approvedKitRequest } from './kitRequestBinding';
import { postRentalMessage } from './rentalChat';
import { queueRmv2Sync } from './rmv2SyncQueue';
import { internal } from '../_generated/api';
import { schedulePickupHold } from '../pickupSecurity';

export function refundSwapEligible(booking:any,row:any){
 return booking.status==='confirmed'&&!rentalHasStarted(booking,Date.now())&&row.differencePence<0&&
  row.refundPence===-row.differencePence&&row.chargePence===0&&row.nonCashDifferencePence===0&&row.securityChargePence===0&&
  (canDeferAdditionSecurity(booking)||row.holdTotalPence===Math.round((booking.depositHoldAmount??0)*100));
}
export function failedRefundHasNoMoney(refund:any){
 return refund?.status==='failed'&&refund.allocations?.length>0&&refund.parts?.length===refund.allocations.length&&
  refund.parts.every((p:any)=>['failed','canceled'].includes(p.status));
}
/** A terminal status alone is insufficient: every original payment allocation
 * must have its own complete, exact provider receipt. */
function completeRentalRefundReceipts(refund:any){
 if(!refund||!Number.isSafeInteger(refund.amountPence)||refund.amountPence<=0||!refund.allocations?.length||refund.parts?.length!==refund.allocations.length)return false;
 if(new Set(refund.allocations.map((p:any)=>p.paymentIntentId)).size!==refund.allocations.length||new Set(refund.parts.map((p:any)=>p.stripeRefundId)).size!==refund.parts.length)return false;
 return refund.allocations.reduce((n:number,p:any)=>n+p.amountPence,0)===refund.amountPence&&refund.allocations.every((a:any)=>{
  const part=refund.parts.find((p:any)=>p.paymentIntentId===a.paymentIntentId);
  return Number.isSafeInteger(a.amountPence)&&a.amountPence>0&&['succeeded','pending','failed'].includes(part?.status)&&part.amountPence===a.amountPence&&typeof part.stripeRefundId==='string'&&part.stripeRefundId.length>0;
 });
}
export function fullyConfirmedRentalRefund(refund:any){return refund?.status==='succeeded'&&completeRentalRefundReceipts(refund)&&refund.parts.every((p:any)=>p.status==='succeeded');}
export function assertRefundOnlyResolution(row:any,refund:any){
 const receipt=row.refundOnlyResolution;
 const laterBankFailure=completeRentalRefundReceipts(refund)&&Number.isSafeInteger(refund.bankReversalAt)&&refund.bankReversalAt>=receipt?.closedAt;
 if(!receipt||row.state!=='withdrawn'||!fullyConfirmedRentalRefund(refund)&&!laterBankFailure||receipt.refundedPence!==refund.amountPence||receipt.refundedPence!==row.refundPence||
    receipt.operationKey!==`kit-swap-refund-only:${row.bookingId}:${row._id}:${row.quoteKey}`||!Number.isSafeInteger(receipt.closedAt)||receipt.reason.trim().length<5)
  throw Error('The saved refund-only swap resolution needs reconciliation.');
 if(receipt.securityAtClosure&&Object.values(receipt.securityAtClosure).some(amount=>!Number.isSafeInteger(amount)||Number(amount)<0))throw Error("The saved refund-only security receipt needs reconciliation.");
 return {closed:true,refunded:refund.parts.filter((p:any)=>p.status==='succeeded').reduce((n:number,p:any)=>n+p.amountPence,0)/100};
}
/** Provider receipts are durable even if the final kit needs reconciliation.
 * Preserve the booking lock and its permanent replacement allocation until the
 * exact accepted kit can be applied; never repeat the already completed refund. */
export async function completeRefundSwap(ctx:any,id:any){
 const refund=await ctx.db.get(id);if(!refund?.swapProposalId||refund.status!=='succeeded')return {applied:false};
 const row=await ctx.db.get(refund.swapProposalId),booking=await ctx.db.get(refund.bookingId),request=row?await ctx.db.get(row.changeRequestId):null;
 const account=request?await ctx.db.get(request.accountId):null;
 if(!row||!booking||!request||row.settlementRefundId!==id||row.bookingId!==booking._id||row.accountId!==request.accountId||request.swapProposalId!==row._id||!belongsToRentalAccount(booking,account))
  throw Error('The swap refund receipt belongs to another rental or account.');
 if(refund.amountPence!==row.refundPence)throw Error('The swap refund amount does not match its accepted proposal.');
 if(row.refundOnlyResolution)return {...assertRefundOnlyResolution(row,refund),applied:false};
 if(row.state==='applied'){
  if(request.execution?.operation!=='kit_swap'||request.execution.operationKey!==`kit-swap:${booking._id}:${row._id}:${row.quoteKey}`||request.execution.status!=='applied'||request.execution.appliedAt!==row.appliedAt)
   throw Error('The saved refunded swap completion receipt needs reconciliation.');
  return {applied:true};
 }
 let q:any,reservations:any[],values:any;
 try{
  if(row.state!=='accepted'||row.consentVersion!=='rental-swap-price-difference-v1'||booking.activeSwapRefundId!==id||booking.status!=='confirmed'||refund.amountPence!==row.refundPence)
   throw Error('The saved swap refund settlement needs reconciliation.');
  await approvedKitRequest(ctx,booking,request._id);
  // A pre-start agreed settlement can finish after its offer deadline. The
  // financial/stock lock prevented collection or other operations meanwhile.
  q=await rentalSwapQuote(ctx,booking,request,undefined,id);
  if(await swapQuoteKey(booking,request,q)!==row.quoteKey||JSON.stringify(q.finalLines)!==row.finalLines||q.snapshot!==row.snapshot)
   throw Error('The accepted swap source changed after its refund. Review the saved settlement.');
  reservations=await ctx.db.query('reservations').withIndex('by_booking',(q:any)=>q.eq('bookingId',booking._id)).take(201);
  if(reservations.length>200)throw Error('The swap stock history needs reconciliation.');
  values=await replacementValues(ctx,booking,q.finalLines);
 }catch(e){
  await ctx.db.patch(row._id,{settlementError:e instanceof Error?e.message:"Review the saved swap refund.",updatedAt:Date.now()});
  return {applied:false,needsReview:true};
 }
 const now=Date.now();
  // Keep total/rentalPaidPence as actual captured gross cash. The existing refund
  // ledger reduces net cash once; changing both would double-deduct cancellation.
  const patch={lineItems:q.finalLines,subtotal:Math.round((booking.subtotal+row.differencePence/100)*100)/100,replacementValues:values,depositHoldAmount:row.holdTotalPence/100,activeSwapRefundId:undefined};
  await ctx.db.patch(booking._id,patch);
  if(canDeferAdditionSecurity(booking))await schedulePickupHold(ctx,{...booking,...patch},true);
  for(const r of reservations)if(r.status==='confirmed')await ctx.db.patch(r._id,{status:'cancelled'});
  for(const line of q.finalLines){
   const listing=await ctx.db.get(line.listingId);if(!listing?.components?.length)throw Error('The saved replacement mapping needs review.');
   for(const component of listing.components)await ctx.db.insert('reservations',{bookingId:booking._id,listingId:line.listingId,inventoryUnitId:component.inventoryUnitId,...swapStockWindow(line,q.allocationMode),qty:line.qty*component.qty,status:'confirmed',source:'site'});
  }
  const detail=`${row.quantity}× ${row.sourceTitle} → ${row.targetTitle}. £${(row.refundPence/100).toFixed(2)} rental difference refunded to the original payment method.`;
  await ctx.db.patch(request._id,{execution:{operation:'kit_swap',operationKey:`kit-swap:${booking._id}:${row._id}:${row.quoteKey}`,status:'applied',startedAt:refund.createdAt,appliedAt:now,detail}});
  await ctx.db.patch(row._id,{state:'applied',appliedAt:now,updatedAt:now,settlementError:undefined});
  await postRentalMessage(ctx,{accountId:row.accountId,bookingId:booking._id,sender:'system',text:`The refunded equipment swap is confirmed: ${detail}`,meta:{type:'rental_swap_applied',changeRequestId:request._id,swapProposalId:row._id}});
  await ctx.scheduler.runAfter(0,internal.notify.changeEmail,{bookingId:booking._id,kind:'kit updated',detail});
  await queueRmv2Sync(ctx,booking._id);return {applied:true};

}
