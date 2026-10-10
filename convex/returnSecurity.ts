import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { rentalPaymentSources } from "./lib/rentalPaymentSources";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import { accountForRental } from "./lib/rentalAccount";
import { postRentalMessage } from "./lib/rentalChat";

export const context = internalQuery({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>
  ctx.db.query("return_security_refunds").withIndex("by_booking",q=>q.eq("bookingId",bookingId)).first()});

export const prepare = internalMutation({args:{bookingId:v.id("bookings"),kept:v.number(),capturedFromHold:v.number(),note:v.optional(v.string()),allocations:v.array(v.object({paymentIntentId:v.string(),amountPence:v.number()}))},handler:async(ctx,args)=>{
 const b=await ctx.db.get(args.bookingId);if(!b?.returnDecision)throw Error("Freeze the return inspection before its deposit refund.");
 const old=await ctx.db.query("return_security_refunds").withIndex("by_booking",q=>q.eq("bookingId",args.bookingId)).first();
 if(old){
  const saved=old.allocations.map(({paymentIntentId,amountPence})=>({paymentIntentId,amountPence}));
  if(old.kept!==args.kept||old.capturedFromHold!==args.capturedFromHold||old.note!==args.note||JSON.stringify(saved)!==JSON.stringify(args.allocations))throw Error("Resume the frozen original deposit refund allocation.");
  return old;
 }
 if(b.depositRefunded)throw Error("This deposit was already settled before the refund ledger was introduced.");
 if(args.kept!==b.returnDecision.damageKept||args.capturedFromHold<0||args.capturedFromHold>args.kept)throw Error("The refund does not match the saved damage decision.");
 const sources=await rentalPaymentSources(ctx,b),seen=new Set<string>();
 for(const a of args.allocations){
  const source=sources.find(s=>s.paymentIntentId===a.paymentIntentId);
  if(!source||seen.has(a.paymentIntentId)||!Number.isSafeInteger(a.amountPence)||a.amountPence<=0||a.amountPence>source.securityPence)throw Error("Invalid original security refund source.");
  seen.add(a.paymentIntentId);
 }
 const amountPence=args.allocations.reduce((n,a)=>n+a.amountPence,0);
 const expected=Math.max(0,Math.min(Math.round(b.depositAmount*100),sources.reduce((n,s)=>n+s.securityPence,0))-Math.round((args.kept-args.capturedFromHold)*100));
 if(amountPence!==expected)throw Error("The refund must match the captured deposit after the frozen deduction.");
 const id=await ctx.db.insert("return_security_refunds",{...args,amountPence,allocations:args.allocations.map(a=>({...a,status:"prepared"})),status:"prepared",generation:0,attempts:0,dueAt:Date.now(),createdAt:Date.now(),updatedAt:Date.now()});
 return (await ctx.db.get(id))!;
}});

export const begin = internalMutation({args:{id:v.id("return_security_refunds")},handler:async(ctx,{id})=>{
 const job=await ctx.db.get(id);if(!job)throw Error("Unknown deposit refund ledger.");
 const generation=job.generation+1;if(!Number.isSafeInteger(generation))throw Error("Deposit refund history needs review.");
 await ctx.db.patch(id,{generation});return {job,generation};
}});

export const record = internalMutation({args:{id:v.id("return_security_refunds"),generation:v.number(),receipts:v.array(v.object({paymentIntentId:v.string(),stripeRefundId:v.string(),status:v.string(),amountPence:v.number(),failureReason:v.optional(v.string())}))},handler:async(ctx,{id,generation,receipts})=>{
 const job=await ctx.db.get(id);if(!job)throw Error("Unknown deposit refund ledger.");
 if(job.generation!==generation)return {job,stale:true};
 if(receipts.length!==job.allocations.length||new Set(receipts.map(r=>r.paymentIntentId)).size!==receipts.length||new Set(receipts.map(r=>r.stripeRefundId)).size!==receipts.length)throw Error("Incomplete deposit refund observation.");
 const allocations=job.allocations.map(a=>{
  const receipt=receipts.find(r=>r.paymentIntentId===a.paymentIntentId);
  if(!receipt||receipt.amountPence!==a.amountPence||a.stripeRefundId&&receipt.stripeRefundId!==a.stripeRefundId||!["pending","succeeded","failed"].includes(receipt.status))throw Error("Deposit refund identity mismatch.");
  return {paymentIntentId:a.paymentIntentId,amountPence:a.amountPence,stripeRefundId:receipt.stripeRefundId,status:receipt.status,...(receipt.failureReason?{failureReason:receipt.failureReason}:{})};
 });
 const status=allocations.every(a=>a.status==="succeeded")?"succeeded":allocations.some(a=>a.status==="pending")?"pending":"failed";
 const confirmed=allocations.filter(a=>a.status==="succeeded").reduce((n,a)=>n+a.amountPence,0);
 const previousConfirmed=job.allocations.filter(a=>a.status==="succeeded").reduce((n,a)=>n+a.amountPence,0);
 const reversed=confirmed<previousConfirmed;
 const changed=JSON.stringify(allocations)!==JSON.stringify(job.allocations)||status!==job.status;
 await ctx.db.patch(id,{allocations,status,attempts:0,dueAt:status==="pending"?Date.now()+3600000:undefined,error:undefined,bankReversalAt:reversed?Date.now():job.bankReversalAt,updatedAt:Date.now()});
 const b=await ctx.db.get(job.bookingId);if(!b?.returnDecision)throw Error("The saved return decision is missing.");
 await ctx.db.patch(b._id,{depositRefunded:status==="succeeded",depositKept:job.kept,depositRefundAmount:confirmed/100,depositHoldCapturedForDamage:job.capturedFromHold,depositDeductionNote:job.note,returnedAt:b.returnedAt??Date.now(),...(b.returnStatement?{returnStatement:{...b.returnStatement,securityRefunded:confirmed/100}}:{})});
 if(changed){
  await queueRmv2Sync(ctx,b._id);
  const detail=`Refundable deposit: £${(confirmed/100).toFixed(2)} confirmed of £${(job.amountPence/100).toFixed(2)}. ${reversed?"The bank returned a previously confirmed refund; the team is reviewing the outstanding repayment.":status==="pending"?"The remaining refund is processing with the payment provider.":status==="failed"?"The remaining refund needs review by the team.":"The payment provider confirms the refund."}`;
  const account=await accountForRental(ctx,b);
  if(account)await postRentalMessage(ctx,{accountId:account._id,bookingId:b._id,sender:"system",text:detail});
  if(status!=="succeeded"||job.status==="succeeded")await ctx.scheduler.runAfter(0,internal.notify.changeEmail,{bookingId:b._id,kind:"deposit refund",detail});
 }
 return {job:(await ctx.db.get(id))!,stale:false};
}});

export const defer = internalMutation({args:{id:v.id("return_security_refunds"),generation:v.number()},handler:async(ctx,{id,generation})=>{
 const job=await ctx.db.get(id);if(!job||job.generation!==generation)return;
 const attempts=job.attempts+1;
 await ctx.db.patch(id,{attempts,dueAt:attempts<5?Date.now()+[60000,300000,1800000,3600000][Math.min(attempts-1,3)]:undefined,error:"The deposit refund needs provider reconciliation. Resume the existing return settlement; do not create another refund.",updatedAt:Date.now()});
}});

export const due = internalQuery({args:{},handler:async(ctx)=>ctx.db.query("return_security_refunds").withIndex("by_due",q=>q.gte("dueAt",0).lte("dueAt",Date.now())).take(20)});
