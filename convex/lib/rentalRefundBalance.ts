/** A combined subscription payment contains money outside the rental ledger.
 * Only provider credit notes scoped entirely to membership can identify those
 * refunds. Unknown refunds stay conservative; no allocation can exceed cash. */
export function rentalRefundBalance(received:number,cap:number|undefined,refunds:{id:string;amount:number;status:string|null}[],membershipRefunds:Map<string,number>){
 let total=0,rental=0;
 for(const r of refunds){if(r.status==="failed"||r.status==="canceled")continue;total+=r.amount;rental+=Math.max(0,r.amount-(membershipRefunds.get(r.id)??0));}
 return Math.max(0,Math.min(Math.min(received,cap??received)-rental,received-total));
}
