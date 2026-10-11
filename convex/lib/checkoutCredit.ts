import { usableCredit } from "./creditLedger";
export function creditKind(c:any):"refund"|"earned" {
  if(c.kind)return c.kind;
  if(c.membershipGrantId||c.membershipInvoiceId)return "earned";
  return /^(late_cancellation|consented_full_credit|rental_refund|cash_refund):/.test(c.reason??"")?"refund":"earned";
}
/** Per-source reservations prevent a refund balance from reserving promotional money. */
export async function availableCreditRows(ctx:any,accountId:any){
  const account=await ctx.db.get(accountId);if(!account)return [];
  const now=Date.now();
  const [rows,owned,legacyBookings]=await Promise.all([
    ctx.db.query("credits").withIndex("by_account_status_expiry",(q:any)=>q.eq("accountId",accountId).eq("status","active").gt("expiresAt",now)).take(501),
    ctx.db.query("bookings").withIndex("by_account_status",(q:any)=>q.eq("accountId",accountId).eq("status","pending_payment")).take(101),
    ctx.db.query("bookings").withIndex("by_account_guestEmail_status",(q:any)=>q.eq("accountId",undefined).eq("guestEmail",account.email.trim().toLowerCase()).eq("status","pending_payment")).take(101),
  ]);
  if(rows.length>500||owned.length>100||legacyBookings.length>100)
    throw Error("This account's credit reservations need reconciliation before its balance can be used.");
  const pending=[...owned,...legacyBookings];
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
