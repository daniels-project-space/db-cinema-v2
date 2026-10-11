/** A terminal status alone is insufficient: every original payment allocation
 * must have its own complete, exact provider receipt. */
export function completeRentalRefundReceipts(refund:any){
 if(!refund||!Number.isSafeInteger(refund.amountPence)||refund.amountPence<=0||!refund.allocations?.length||refund.parts?.length!==refund.allocations.length)return false;
 if(new Set(refund.allocations.map((p:any)=>p.paymentIntentId)).size!==refund.allocations.length||new Set(refund.parts.map((p:any)=>p.stripeRefundId)).size!==refund.parts.length)return false;
 return refund.allocations.reduce((n:number,p:any)=>n+p.amountPence,0)===refund.amountPence&&refund.allocations.every((a:any)=>{
  const part=refund.parts.find((p:any)=>p.paymentIntentId===a.paymentIntentId);
  return Number.isSafeInteger(a.amountPence)&&a.amountPence>0&&['succeeded','pending','failed'].includes(part?.status)&&part.amountPence===a.amountPence&&typeof part.stripeRefundId==='string'&&part.stripeRefundId.length>0;
 });
}
export function fullyConfirmedRentalRefund(refund:any){return refund?.status==='succeeded'&&completeRentalRefundReceipts(refund)&&refund.parts.every((p:any)=>p.status==='succeeded');}
