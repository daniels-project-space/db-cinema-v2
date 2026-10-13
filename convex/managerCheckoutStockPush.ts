import {internalAction} from "./_generated/server";
import {internal} from "./_generated/api";
export const push=internalAction({args:{},handler:async(ctx)=>{
 const base=process.env.RMV2_WEBHOOK_URL,secret=process.env.RMV2_WEBHOOK_SECRET;if(!base||!secret)return;
 const snapshot=await ctx.runMutation(internal.managerCheckoutStock.snapshot,{});if(!snapshot)return;
 let ok=false,reason="transport_failed";
 try{
  const response=await fetch(new URL("/dbcinema/stock-holds",base),{method:"POST",headers:{"Content-Type":"application/json","x-dbcinema-sync-token":secret},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(12000)});
  if(response.ok){const receipt=await response.json();ok=receipt.ok===true&&receipt.revision>=snapshot.revision;reason="invalid_receipt";}else reason="http_"+response.status;
 }catch{}
 await ctx.runMutation(internal.managerCheckoutStock.record,{revision:snapshot.revision,ok,...(!ok?{reason}:{})});
}});
