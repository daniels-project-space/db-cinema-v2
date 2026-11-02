export function membershipReadFenceEnabled(){
 return process.env.MEMBERSHIP_BOUNDED_RECONCILE_ENABLED==="true" || process.env.STRICT_SECURITY_POLICY_ENABLED==="true";
}
export async function currentMembershipRead(ctx:any,subscriptionId:string,generation?:number){
 if(!membershipReadFenceEnabled())return true;
 if(generation===undefined)return false;
 const row=await ctx.db.query("membership_provider_reads").withIndex("by_subscription",(query:any)=>query.eq("subscriptionId",subscriptionId)).unique();
 return row?.generation===generation;
}
export async function markMembershipReadApplied(ctx:any,subscriptionId:string,generation?:number){
 if(!membershipReadFenceEnabled()||generation===undefined)return;
 const row=await ctx.db.query("membership_provider_reads").withIndex("by_subscription",(query:any)=>query.eq("subscriptionId",subscriptionId)).unique();
 if(row?.generation===generation)await ctx.db.patch(row._id,{appliedGeneration:generation,...(!row.mutationKey?{unsettledSince:undefined}:{})});
}
export async function membershipReadSettled(ctx:any,subscriptionId:string){
 if(!membershipReadFenceEnabled())return true;
 const row=await ctx.db.query("membership_provider_reads").withIndex("by_subscription",(query:any)=>query.eq("subscriptionId",subscriptionId)).unique();
 return !!row&&!row.mutationKey&&row.appliedGeneration===row.generation;
}
