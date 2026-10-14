import { usableCredit } from "./creditLedger";
export function creditKind(c:any):"refund"|"earned" {
  if(c.kind)return c.kind;
  if(c.membershipGrantId||c.membershipInvoiceId)return "earned";
  return /^(late_cancellation|consented_full_credit|rental_refund|cash_refund):/.test(c.reason??"")?"refund":"earned";
}
/** Per-source reservations prevent a refund balance from reserving promotional money. */
export async function availableCreditRows(ctx:any,accountId:any){
  const account=await ctx.db.get(accountId);if(!account)return [];
  const now=Date.now(),all=await ctx.db.query("credits").withIndex("by_account_status",(q:any)=>q.eq("accountId",accountId).eq("status","active")).take(501);
  if(all.length>500)throw Error("Account credit history needs an administrator review before another checkout.");
  const rows=all.filter((c:any)=>c.expiresAt>now).sort((a:any,b:any)=>a.expiresAt-b.expiresAt||String(a._id).localeCompare(String(b._id)));
  const [linked,legacyBookings]=await Promise.all([
   ctx.db.query("bookings").withIndex("by_account_status",(q:any)=>q.eq("accountId",accountId).eq("status","pending_payment")).take(101),
   ctx.db.query("bookings").withIndex("by_guestEmail_status",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase()).eq("status","pending_payment")).take(101),
  ]);
  if(linked.length>100||legacyBookings.length>100)throw Error("Open checkouts need reconciliation before another credit payment.");
  const pending=[...new Map([...linked,...legacyBookings.filter((b:any)=>b.accountId==null)].map((b:any)=>[String(b._id),b])).values()];
  const reserved=new Map<string,number>();let legacy=0;
  for(const b of pending){
    if(b.creditAllocations)for(const a of b.creditAllocations)reserved.set(a.creditId,(reserved.get(a.creditId)??0)+Math.round(a.amount*100));
    else legacy+=Math.round(((b.creditApplied??0)-(b.membershipCreditApplied??0))*100);
  }
  return rows.map((c:any)=>{
    let pence=Math.max(0,Math.round(usableCredit(c)*100)-Math.max(0,(reserved.get(c._id)??0)-(c.revokedPendingPence??0)));
    const take=Math.min(pence,Math.max(0,legacy));pence-=take;legacy-=take;
    return {...c,kind:creditKind(c),availablePence:pence};
  });
}
export async function creditPlan(ctx:any,accountId:any,refund:number,earned:number){
  const rows=await availableCreditRows(ctx,accountId),need={refund:Math.round(refund*100),earned:Math.round(earned*100)},plan:any[]=[];
  for(const c of rows){const take=Math.min(c.availablePence,need[c.kind as "refund"|"earned"]);if(take>0){plan.push({creditId:c._id,amount:take/100,kind:c.kind});need[c.kind as "refund"|"earned"]-=take;}}
  if(need.refund>0||need.earned>0)throw Error("Your available credit changed. Review the updated total before paying.");
  return plan;
}
