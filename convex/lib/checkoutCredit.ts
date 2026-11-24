import { usableCredit } from "./creditLedger";
export function creditKind(c:any):"refund"|"earned" {
  if(c.kind)return c.kind;
  if(c.membershipGrantId||c.membershipInvoiceId)return "earned";
  return /^(late_cancellation|consented_full_credit|rental_refund|cash_refund):/.test(c.reason??"")?"refund":"earned";
}
export function checkoutCreditSpentPence(booking:any){
  const applied=booking?.creditApplied??0,pence=Math.round(applied*100);
  if(!Number.isFinite(applied)||applied<0||!Number.isSafeInteger(pence))throw Error("Checkout account-credit amount needs reconciliation.");
  return booking?.checkoutCreditState==="unspent"&&!booking?.paidConfirmedAt?0:pence;
}
export function checkoutMembershipCreditSpentPence(booking:any){
  const applied=booking?.membershipCreditApplied??0,pence=Math.round(applied*100);
  if(!Number.isFinite(applied)||applied<0||!Number.isSafeInteger(pence))throw Error("Checkout membership-credit amount needs reconciliation.");
  return Math.min(checkoutCreditSpentPence(booking),pence);
}
/** Per-source reservations prevent a refund balance from reserving promotional money. */
export async function availableCreditRows(ctx:any,accountId:any){
  const account=await ctx.db.get(accountId);if(!account)return [];
  const now=Date.now(),all=await ctx.db.query("credits").withIndex("by_account_status",(q:any)=>q.eq("accountId",accountId).eq("status","active")).take(501);
  if(all.length>500)throw Error("Account credit history needs an administrator review before another checkout.");
  const rows=all.filter((c:any)=>c.expiresAt>now).sort((a:any,b:any)=>a.expiresAt-b.expiresAt||String(a._id).localeCompare(String(b._id)));
  const [linked,legacyBookings,verifiedLinked,verifiedLegacy,operationReservations]=await Promise.all([
   ctx.db.query("bookings").withIndex("by_account_status",(q:any)=>q.eq("accountId",accountId).eq("status","pending_payment")).take(101),
   ctx.db.query("bookings").withIndex("by_guestEmail_status",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase()).eq("status","pending_payment")).take(101),
   ctx.db.query("bookings").withIndex("by_account_status",(q:any)=>q.eq("accountId",accountId).eq("status","pending_verification")).take(101),
   ctx.db.query("bookings").withIndex("by_guestEmail_status",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase()).eq("status","pending_verification")).take(101),
   ctx.db.query("rental_credit_reservations").withIndex("by_account_state",(q:any)=>q.eq("accountId",accountId).eq("state","reserved")).take(501),
  ]);
  if([linked,legacyBookings,verifiedLinked,verifiedLegacy].some(rows=>rows.length>100)||operationReservations.length>500)throw Error("Open checkouts need reconciliation before another credit payment.");
  const awaiting=[...verifiedLinked,...verifiedLegacy.filter((b:any)=>b.accountId==null)].filter((b:any)=>b.checkoutCreditState!=="spent"&&!b.paidConfirmedAt);
  const pending=[...new Map([...linked,...legacyBookings.filter((b:any)=>b.accountId==null),...awaiting].map((b:any)=>[String(b._id),b])).values()];
  const reserved=new Map<string,number>();let legacy=0;
  for(const reservation of operationReservations)for(const allocation of reservation.allocations??[])
    reserved.set(String(allocation.creditId),(reserved.get(String(allocation.creditId))??0)+Math.round(allocation.amountPence));
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

export async function checkoutCreditReadyForConfirmation(ctx:any,booking:any){
  const total=booking.creditApplied??0,membership=booking.membershipCreditApplied??0;
  if(!Number.isFinite(total)||!Number.isFinite(membership)||total<0||membership<0)return false;
  const need=Math.round(total*100)-Math.round(membership*100);
  if(!Number.isSafeInteger(need)||need<0)return false;
  if(need===0)return true;
  const email=typeof booking.guestEmail==="string"?booking.guestEmail.trim().toLowerCase():"";
  if(!email)return false;
  const account=await ctx.db.query("accounts").withIndex("by_email",(q:any)=>q.eq("email",email)).first();
  if(!account||booking.accountId&&String(booking.accountId)!==String(account._id))return false;
  if(Array.isArray(booking.creditAllocations)){
    let sum=0;const ids=new Set<string>();
    for(const allocation of booking.creditAllocations){
      const amount=Math.round(allocation.amount*100),id=String(allocation.creditId);
      if(!Number.isSafeInteger(amount)||amount<=0||ids.has(id))return false;
      ids.add(id);sum+=amount;
      const credit=await ctx.db.get(allocation.creditId);
      if(!credit||String(credit.accountId)!==String(account._id)||!Number.isFinite(credit.remaining)||Math.round(credit.remaining*100)<amount)return false;
    }
    return Number.isSafeInteger(sum)&&sum===need;
  }
  const groups=await Promise.all([
    ctx.db.query("bookings").withIndex("by_account_status",(q:any)=>q.eq("accountId",account._id).eq("status","pending_payment")).take(101),
    ctx.db.query("bookings").withIndex("by_guestEmail_status",(q:any)=>q.eq("guestEmail",email).eq("status","pending_payment")).take(101),
    ctx.db.query("bookings").withIndex("by_account_status",(q:any)=>q.eq("accountId",account._id).eq("status","pending_verification")).take(101),
    ctx.db.query("bookings").withIndex("by_guestEmail_status",(q:any)=>q.eq("guestEmail",email).eq("status","pending_verification")).take(101),
    ctx.db.query("rental_credit_reservations").withIndex("by_account_state",(q:any)=>q.eq("accountId",account._id).eq("state","reserved")).take(501),
  ]);
  if(groups.slice(0,4).some((rows:any[])=>rows.length>100)||groups[4].length)return false;
  if(groups.slice(0,4).flat().some((other:any)=>String(other._id)!==String(booking._id)&&(!other.accountId||String(other.accountId)===String(account._id))&&(other.creditApplied??0)>(other.membershipCreditApplied??0)&&(other.status==="pending_payment"||other.checkoutCreditState!=="spent"&&!other.paidConfirmedAt)))return false;
  const rows=await ctx.db.query("credits").withIndex("by_account_status",(q:any)=>q.eq("accountId",account._id).eq("status","active")).take(501);
  if(rows.length>500)return false;
  return rows.filter((credit:any)=>credit.createdAt<=booking._creationTime&&credit.expiresAt>booking._creationTime&&Number.isFinite(credit.remaining)&&credit.remaining>0).reduce((sum:number,credit:any)=>sum+Math.round(credit.remaining*100),0)>=need;
}

export async function reconcileReleasedCredit(ctx:any,booking:any){
  if(!booking.creditAllocations?.length)return;
  const account=booking.accountId?await ctx.db.get(booking.accountId):await ctx.db.query("accounts").withIndex("by_email",(q:any)=>q.eq("email",(booking.guestEmail??"").trim().toLowerCase())).first();
  if(!account)return;
  const groups=await Promise.all([
    ctx.db.query("bookings").withIndex("by_account_status",(q:any)=>q.eq("accountId",account._id).eq("status","pending_payment")).take(101),
    ctx.db.query("bookings").withIndex("by_guestEmail_status",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase()).eq("status","pending_payment")).take(101),
    ctx.db.query("bookings").withIndex("by_account_status",(q:any)=>q.eq("accountId",account._id).eq("status","pending_verification")).take(101),
    ctx.db.query("bookings").withIndex("by_guestEmail_status",(q:any)=>q.eq("guestEmail",account.email.trim().toLowerCase()).eq("status","pending_verification")).take(101),
  ]);
  const operations=await ctx.db.query("rental_credit_reservations").withIndex("by_account_state",(q:any)=>q.eq("accountId",account._id).eq("state","reserved")).take(501);
  if(groups.some(rows=>rows.length>100)||operations.length>500)return;
  const open=[...new Map([...groups[0],...groups[1].filter((b:any)=>b.accountId==null),...groups[2],...groups[3].filter((b:any)=>b.accountId==null)].filter((b:any)=>b.status==="pending_payment"||b.checkoutCreditState!=="spent"&&!b.paidConfirmedAt).map((b:any)=>[String(b._id),b])).values()] as any[];
  const reserved=new Map<string,number>();let legacy=0;
  for(const operation of operations)for(const allocation of operation.allocations??[]){const amount=allocation.amountPence;if(!Number.isSafeInteger(amount)||amount<0)return;reserved.set(String(allocation.creditId),(reserved.get(String(allocation.creditId))??0)+amount);}
  for(const other of open){
    if(other.creditAllocations){for(const allocation of other.creditAllocations){const amount=Math.round(allocation.amount*100);if(!Number.isSafeInteger(amount)||amount<0)return;reserved.set(String(allocation.creditId),(reserved.get(String(allocation.creditId))??0)+amount);}}
    else {const amount=Math.round(((other.creditApplied??0)-(other.membershipCreditApplied??0))*100);if(!Number.isSafeInteger(amount)||amount<0)return;legacy+=amount;}
  }
  for(const id of new Set<string>(booking.creditAllocations.map((a:any)=>String(a.creditId)))){
    const allocation=booking.creditAllocations.find((a:any)=>String(a.creditId)===id),source=await ctx.db.get(allocation.creditId);
    if(!source||source.accountId!==account._id)continue;
    const frozen=source.revokedPendingPence??0,remaining=Math.round(source.remaining*100);
    if(!Number.isSafeInteger(frozen)||!Number.isSafeInteger(remaining)||frozen<0||remaining<frozen)continue;
    const release=Math.max(0,frozen-(reserved.get(id)??0)-legacy);if(!release)continue;
    await ctx.db.patch(source._id,{remaining:(remaining-release)/100,revokedPendingPence:frozen-release,...(remaining===release&&source.status==="active"?{status:"spent"}:{})});
  }
}
