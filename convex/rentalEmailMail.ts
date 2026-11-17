"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sendMail, type MailInput } from "./lib/mailer";
export const deliver=internalAction({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number()},handler:async(ctx,a):Promise<void>=>{
  let row=await ctx.runQuery(internal.rentalEmailDelivery.ready,a);
  let result:"sent"|"retry"|"skipped"="skipped";
  let providerMessageId:string|undefined;
  if(row)try{
    let storageId=row.payloadStorageId;
    if(!storageId){
      let payload:MailInput|null;
      const args={prepareOnly:true,deliveryKey:row.key,bookingId:row.bookingId};
      if(row.kind==="payment")payload=await ctx.runAction(internal.notify.bookingAlert,args) as MailInput|null;
      else if(row.kind==="paid_verification"||row.kind==="verification_reminder")payload=await ctx.runAction(internal.notify.paidVerificationEmail,{...args,reminder:row.kind==="verification_reminder"}) as MailInput|null;
      else if(row.kind==="receipt")payload=await ctx.runAction(internal.invoice.invoiceEmail,args) as MailInput|null;
      else if(row.kind==="verification")payload=await ctx.runAction(internal.notify.verificationEmail,{...args,status:row.verificationStatus!}) as MailInput|null;
      else if(row.kind==="time_change")payload=await ctx.runAction(internal.notify.timeChangeEmail,{...args,detail:row.changeDetail!,changeKind:row.changeKind}) as MailInput|null;
      else if(row.kind==="review")payload=await ctx.runAction(internal.reviewFollowUp.prepareEmail,{bookingId:row.bookingId,deliveryKey:row.key}) as MailInput|null;
      else if(row.kind==="cancellation_choice")payload=await ctx.runAction(internal.operatorCancellation.prepareEmail,{bookingId:row.bookingId,deliveryKey:row.key}) as MailInput|null;
      else payload=await ctx.runAction(internal.notify.cancellationEmail,{...args,mode:row.mode!,refundAmount:row.refundAmount!,creditAmount:row.creditAmount!}) as MailInput|null;
      if(payload){
        const candidate=await ctx.storage.store(new Blob([JSON.stringify(payload)],{type:"application/json"}));
        storageId=(await ctx.runMutation(internal.rentalEmailDelivery.prepare,{...a,storageId:candidate,recipientEmail:payload.to,promotional:payload.promotional,cleanReturnRequired:payload.cleanReturnRequired}))??undefined;
        if(storageId!==candidate)await ctx.storage.delete(candidate);
      }
    }
    // Recheck the lease, status and permanent recipient after rendering the PDF.
    row=await ctx.runQuery(internal.rentalEmailDelivery.ready,a);
    if(storageId && row){
      const blob=await ctx.storage.get(storageId);if(!blob)throw Error("Prepared email unavailable");
      const payload=JSON.parse(await blob.text()) as MailInput;
      result=await sendMail(payload,id=>{providerMessageId=id})?"sent":"retry";
    }
  }catch{result="retry";}
  await ctx.runMutation(internal.rentalEmailDelivery.finish,{...a,result,...(result==="sent"&&providerMessageId?{providerMessageId}:{})});
}});

export const checkProvider=internalAction({args:{deliveryId:v.id("rental_email_deliveries"),generation:v.number()},handler:async(ctx,a):Promise<void>=>{
 const row=await ctx.runQuery(internal.rentalEmailDelivery.providerCheckContext,a);
 if(!row)return;
 let status="unknown";
 try{
  const key=process.env.RESEND_API_KEY;
  if(key && /^[a-zA-Z0-9_-]{1,128}$/.test(row.providerMessageId)){
   const response=await fetch(`https://api.resend.com/emails/${encodeURIComponent(row.providerMessageId)}`,{headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20_000)});
   if(response.ok){const body=await response.json() as {last_event?:unknown};if(typeof body.last_event==="string")status=body.last_event;}
  }
 }catch{/* Retry the provider lookup; a network failure is not a bounce. */}
 await ctx.runMutation(internal.rentalEmailDelivery.recordProviderStatus,{...a,status});
}});
