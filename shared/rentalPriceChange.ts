/** Rental cash and refundable security are separate ledgers. */
export function rentalPriceChange(total:number,deposit:number,refundedPence:number,desired:number) {
  if(![total,deposit,desired].every(n=>Number.isFinite(n)&&n>=0&&Number.isSafeInteger(Math.round(n*100))&&Math.round(n*100)/100===n)||!Number.isSafeInteger(refundedPence)||refundedPence<0||deposit>total)throw Error("Invalid rental price amounts.");
  const currentPence=Math.max(0,Math.round((total-deposit)*100)-refundedPence),newPence=Math.round(desired*100);
  return {current:currentPence/100,newTotal:newPence/100,delta:(newPence-currentPence)/100,direction:newPence>currentPence?"increase" as const:newPence<currentPence?"decrease" as const:"unchanged" as const};
}
