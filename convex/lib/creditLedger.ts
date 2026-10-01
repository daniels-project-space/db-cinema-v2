/** Refunded membership credit already promised to an open rental stays usable by that
 * checkout only. It becomes a future-credit offset if spent, never a new card charge. */
export function creditDebit(c:any,amount:number){
 const remaining=Math.round(c.remaining*100),take=Math.round(amount*100),frozen=c.revokedPendingPence??0;
 const debtPence=Math.max(0,take-Math.max(0,remaining-frozen));
 return {debtPence,patch:{remaining:(remaining-take)/100,status:remaining===take?"spent" as const:"active" as const,revokedPendingPence:Math.max(0,frozen-debtPence)}};
}
export function usableCredit(c:any){return Math.max(0,Math.round(c.remaining*100)-(c.revokedPendingPence??0))/100;}
