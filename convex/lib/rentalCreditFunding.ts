import { availableCreditRows } from "./checkoutCredit";
import { creditDebit } from "./creditLedger";

export type RentalCreditOperation = "addition" | "extension" | "delivery" | "swap";

export async function reservationForOperation(ctx:any,operationType:RentalCreditOperation,operationId:string){
  return await ctx.db.query("rental_credit_reservations").withIndex("by_operation",(q:any)=>q.eq("operationType",operationType).eq("operationId",operationId)).unique();
}

export async function availableRentalCreditPence(ctx:any,accountId:any){
  const rows=await availableCreditRows(ctx,accountId);
  return rows.reduce((sum:number,row:any)=>sum+Math.max(0,row.availablePence),0);
}

export async function reserveRentalCredit(ctx:any,args:{accountId:any;bookingId:any;operationType:RentalCreditOperation;operationId:string;requestedPence:number;expiresAt?:number}){
  if(!Number.isSafeInteger(args.requestedPence)||args.requestedPence<0)throw Error("Invalid account-credit amount.");
  const prior=await reservationForOperation(ctx,args.operationType,args.operationId);
  if(prior){
    if(prior.accountId!==args.accountId||prior.bookingId!==args.bookingId)throw Error("Account-credit reservation belongs to another rental.");
    if(prior.requestedPence!==undefined&&prior.requestedPence!==args.requestedPence)throw Error("The account-credit request changed. Review the updated payment before continuing.");
    if(prior.state!=="reserved"&&prior.state!=="consumed")throw Error("This account-credit choice is already closed. Request a fresh quote.");
    return prior;
  }
  if(args.requestedPence===0)return null;
  const rows=await availableCreditRows(ctx,args.accountId),allocations:any[]=[];
  let need=args.requestedPence;
  for(const row of rows){
    const amountPence=Math.min(need,Math.max(0,row.availablePence));
    if(amountPence>0){allocations.push({creditId:row._id,amountPence,kind:row.kind,...(row.membershipGrantId?{membershipGrantId:row.membershipGrantId}:{}),...(row.membershipInvoiceId?{membershipInvoiceId:row.membershipInvoiceId}:{})});need-=amountPence;}
    if(need===0)break;
  }
  const amountPence=args.requestedPence-need;
  if(amountPence<=0)throw Error("No account credit is currently available. Review the payment total again.");
  const now=Date.now(),id=await ctx.db.insert("rental_credit_reservations",{
    accountId:args.accountId,bookingId:args.bookingId,operationType:args.operationType,operationId:args.operationId,
    state:"reserved",requestedPence:args.requestedPence,amountPence,allocations,createdAt:now,updatedAt:now,...(args.expiresAt?{expiresAt:args.expiresAt}:{}),
  });
  return await ctx.db.get(id);
}

export async function consumeRentalCredit(ctx:any,operationType:RentalCreditOperation,operationId:string){
  const reservation=await reservationForOperation(ctx,operationType,operationId);
  if(!reservation)return {amountPence:0,allocations:[],already:true};
  if(reservation.state==="consumed")return {amountPence:reservation.amountPence,allocations:reservation.allocations,already:true};
  if(reservation.state!=="reserved")throw Error("The account-credit reservation is no longer available.");
  const account=await ctx.db.get(reservation.accountId);
  if(!account)throw Error("The account holding this credit no longer exists.");
  for(const allocation of reservation.allocations){
    const credit=await ctx.db.get(allocation.creditId),amount=allocation.amountPence;
    if(!credit||credit.accountId!==reservation.accountId||!Number.isSafeInteger(amount)||amount<=0||Math.round(credit.remaining*100)<amount)
      throw Error("Your available credit changed. Review the updated payment before continuing.");
    const debit=creditDebit(credit,amount/100);
    await ctx.db.patch(credit._id,debit.patch);
    if(debit.debtPence)await ctx.db.patch(account._id,{membershipCreditDebtPence:(account.membershipCreditDebtPence??0)+debit.debtPence});
  }
  await ctx.db.patch(reservation._id,{state:"consumed",consumedAt:Date.now(),updatedAt:Date.now()});
  return {amountPence:reservation.amountPence,allocations:reservation.allocations,already:false};
}

export async function releaseRentalCredit(ctx:any,operationType:RentalCreditOperation,operationId:string){
  const reservation=await reservationForOperation(ctx,operationType,operationId);
  if(!reservation||reservation.state==="released"||reservation.state==="restored")return false;
  if(reservation.state==="consumed")throw Error("Consumed account credit must be restored with its refund.");
  await ctx.db.patch(reservation._id,{state:"released",releasedAt:Date.now(),updatedAt:Date.now()});
  return true;
}

export async function restoreRentalCredit(ctx:any,operationType:RentalCreditOperation,operationId:string,requestedPence?:number){
  const reservation=await reservationForOperation(ctx,operationType,operationId);
  if(!reservation||reservation.state==="restored")return {amountPence:0,already:true};
  if(reservation.state!=="consumed")throw Error("Only consumed account credit can be restored.");
  const totalPence=reservation.amountPence,restoredPence=reservation.restoredPence??0;
  const targetPence=requestedPence??totalPence;
  if(!Number.isSafeInteger(targetPence)||targetPence<0||targetPence>totalPence)throw Error("The account-credit restoration amount is invalid.");
  if(targetPence<=restoredPence)return {amountPence:0,issuedPence:0,creditIds:[],already:true};
  const now=Date.now(),expiry=now+365*86400000,remainingPence=targetPence-restoredPence;
  const alreadyBySource=new Map<string,number>((reservation.restoredAllocations??[]).map((row:any)=>[String(row.creditId),row.amountPence]));
  const restoredAllocations:any[]=[];let amountLeft=remainingPence,issuedPence=0;const creditIds:string[]=[];
  for(let index=0;index<reservation.allocations.length&&amountLeft>0;index++){
    const allocation=reservation.allocations[index],creditIdKey=String(allocation.creditId);
    const priorRestored=alreadyBySource.get(creditIdKey)??0,availablePence=allocation.amountPence-priorRestored;
    const takePence=Math.min(amountLeft,Math.max(0,availablePence));
    if(takePence<=0)continue;
    const requestId=`rental-credit-restore-${operationType}-${operationId}-${targetPence}-${index}`;
    const prior=await ctx.db.query("credit_issues").withIndex("by_request",(q:any)=>q.eq("requestId",requestId)).unique();
    const account=await ctx.db.get(reservation.accountId),grant=allocation.membershipGrantId?await ctx.db.get(allocation.membershipGrantId):null;
    if(!account)throw Error("The account holding this credit no longer exists.");
    const sourceCredit=await ctx.db.get(allocation.creditId);
    if(!sourceCredit||sourceCredit.accountId!==reservation.accountId||(sourceCredit.kind&&sourceCredit.kind!==allocation.kind)||String(sourceCredit.membershipGrantId??"")!==String(allocation.membershipGrantId??"")||String(sourceCredit.membershipInvoiceId??"")!==String(allocation.membershipInvoiceId??""))throw Error("An original account-credit source is missing or no longer matches its rental allocation.");
    const offset=grant?.revokedPence?Math.min(takePence,account.membershipCreditDebtPence??0):0;
    if(offset)await ctx.db.patch(account._id,{membershipCreditDebtPence:(account.membershipCreditDebtPence??0)-offset});
    const amountToIssue=takePence-offset;
    if(prior){
      if(prior.accountId!==reservation.accountId||prior.bookingId!==reservation.bookingId||prior.amountPence!==amountToIssue)throw Error("Restored account credit does not match its original allocation.");
      if(prior.creditId)creditIds.push(String(prior.creditId));
      issuedPence+=prior.amountPence;
    }else if(amountToIssue>0){
      const amount=amountToIssue/100;
      const creditId=await ctx.db.insert("credits",{accountId:reservation.accountId,kind:allocation.kind,currency:"GBP",amount,remaining:amount,reason:`rental_operation_restored:${operationType}:${operationId}`,bookingId:reservation.bookingId,createdAt:now,expiresAt:expiry,status:"active",...(allocation.membershipGrantId?{membershipGrantId:allocation.membershipGrantId}:{}),...(allocation.membershipInvoiceId?{membershipInvoiceId:allocation.membershipInvoiceId}:{})});
      await ctx.db.insert("credit_issues",{requestId,bookingId:reservation.bookingId,accountId:reservation.accountId,creditId,amountPence:amountToIssue,reason:`Restored ${operationType} account credit`,createdAt:now,expiresAt:expiry});
      creditIds.push(String(creditId));issuedPence+=amountToIssue;
    }
    alreadyBySource.set(creditIdKey,priorRestored+takePence);amountLeft-=takePence;
  }
  if(amountLeft>0)throw Error("The account-credit restoration exceeds its original source allocation.");
  for(const allocation of reservation.allocations){const amountPence=alreadyBySource.get(String(allocation.creditId))??0;if(amountPence>0)restoredAllocations.push({creditId:allocation.creditId,amountPence});}
  const complete=targetPence===totalPence;
  await ctx.db.patch(reservation._id,{state:complete?"restored":"consumed",restoredPence:targetPence,restoredAllocations,...(complete?{restoredAt:now}:{}),updatedAt:now});
  return {amountPence:remainingPence,issuedPence,creditIds,expiresAt:expiry,already:false};
}
