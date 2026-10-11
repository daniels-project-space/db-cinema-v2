import { rentalHasStarted } from '../../src/lib/cancellationPolicy';
import { stockWindow } from './stockWindows';
import { approvedKitRequest } from './kitRequestBinding';
import { rentalSwapQuote, swapQuoteKey } from './rentalSwapQuote';
import { belongsToRentalAccount } from './rentalAccount';
import { compoundSwapShape } from './compoundSwap';
import { canDeferAdditionSecurity, uncollectedRentalWindowOpen } from '../../shared/pickupSecurity';

export function paidSwapEligible(booking: any, row: any) {
 return booking.status === 'confirmed' && !rentalHasStarted(booking, Date.now()) &&
  ((row.differencePence >= 0 && row.chargePence > 0 && row.refundPence === 0 && row.nonCashDifferencePence === 0) ||
   (compoundSwapShape(row) && canDeferAdditionSecurity(booking)));
}
export function swapStockWindow(line: any, mode: string) {
 return mode === 'legacy'
  ? {start:line.start,end:line.end,pickupTime:line.pickupTime??null,returnTime:line.returnTime??null}
  : stockWindow(line, mode === 'precise');
}
/** Hold only positive physical deltas. Retain the original allocation until payment
 * and exchange succeed, without reserving shared accessories a second time. */
export async function additionalSwapStock(ctx: any, finalLines: any[], mode: string, original: any[]) {
 const key = (row: any) => JSON.stringify([row.inventoryUnitId,row.start,row.end,!!row.endExclusive]);
 const previous = new Map<string,number>();
 for (const row of original) if (row.status === 'confirmed') previous.set(key(row),(previous.get(key(row)) ?? 0) + row.qty);
 const required = new Map<string,any>();
 for (const line of finalLines) {
  const listing = await ctx.db.get(line.listingId);
  if (!listing?.components?.length) throw Error('The replacement inventory mapping needs review.');
  for (const component of listing.components) {
   const row = {listingId:line.listingId,inventoryUnitId:component.inventoryUnitId,...swapStockWindow(line,mode),qty:line.qty*component.qty};
   const bucket=key(row), saved=required.get(bucket);
   required.set(bucket,saved?{...saved,qty:saved.qty+row.qty}:row);
  }
 }
 return Array.from(required.entries()).flatMap(([bucket,row])=>{
  const qty=row.qty-(previous.get(bucket) ?? 0);
  return qty>0?[{...row,qty}]:[];
 });
}
/** The immutable accepted proposal, active update pointer and current source all
 * remain bound. A legitimate stale/unfulfillable paid proposal is refunded by
 * the existing update withdrawal path; foreign receipts require reconciliation. */
export async function paidSwapPlan(ctx: any, booking: any, addition: any): Promise<any|null> {
 const row=await ctx.db.get(addition.swapProposalId), request=row?await ctx.db.get(row.changeRequestId):null;
 const owner=request?await ctx.db.get(request.accountId):null;
 if (!row || !request || row.bookingId!==booking._id || addition.bookingId!==booking._id ||
     row.settlementAdditionId!==addition._id || request.swapProposalId!==row._id ||
     addition.changeRequestId!==request._id || row.accountId!==request.accountId || !belongsToRentalAccount(booking,owner))
  throw Error('The saved swap settlement belongs to another rental or account.');
 const compound=compoundSwapShape(row);
 if(compound&&!uncollectedRentalWindowOpen(booking))return null;
 const savedCompound=compound && booking.status==='confirmed' && booking.pickedUpAt==null &&
  booking.activeAdditionId===addition._id && booking.activeSwapRefundId===row.settlementRefundId &&
  !!addition.paymentIntentId && canDeferAdditionSecurity(booking);
 if (row.state!=='accepted' || row.refundOnlyRequest || row.consentVersion!=='rental-swap-price-difference-v1' ||
     (!savedCompound && (row.expiresAt<=Date.now() || !paidSwapEligible(booking,row)))) return null;
 if (addition.lineTotal!==Math.max(0,row.differencePence)/100 || addition.securityCharge!==row.securityChargePence/100 || addition.holdTotal!==row.holdTotalPence/100 ||
     addition.listingId!==row.targetListingId || addition.qty!==row.quantity || addition.start!==row.start || addition.end!==row.end)
  throw Error('The saved swap payment does not match the accepted proposal.');
 try {
  await approvedKitRequest(ctx,booking,request._id,addition._id);
  const quote=await rentalSwapQuote(ctx,booking,request,addition._id,compound?row.settlementRefundId:undefined);
  if (await swapQuoteKey(booking,request,quote)!==row.quoteKey || JSON.stringify(quote.finalLines)!==row.finalLines || quote.snapshot!==row.snapshot ||
      quote.allocationMode!==row.allocationMode || quote.differencePence!==row.differencePence || quote.chargePence!==row.chargePence ||
      quote.refundPence!==row.refundPence || quote.nonCashDifferencePence!==0 || Math.round(quote.securityCharge*100)!==row.securityChargePence || Math.round(quote.holdTotal*100)!==row.holdTotalPence) return null;
  return {quote,row,request};
 } catch { return null; }
}
