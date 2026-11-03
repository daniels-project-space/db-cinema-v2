import { internal } from "../_generated/api";

export async function queueEncoreCheck(ctx:any,bookingId:any,options?:{backfill?:boolean;quiet?:boolean}){
 if(process.env.ENCORE_EVIDENCE_CAPTURE_ENABLED!=="true"&&process.env.ENCORE_EVIDENCE_READ_ENABLED!=="true")return;
 const booking=await ctx.db.get(bookingId);
 if(!booking||booking.status!=="returned"||!booking.actualReturnedAt)return;
 const existing=await ctx.db.query("encore_settlement_checks").withIndex("by_booking",(q:any)=>q.eq("bookingId",bookingId)).unique();
 if(options?.backfill&&existing)return;
 if(options?.quiet&&existing&&["pending","checking"].includes(existing.state))return;
 const now=Date.now(),generation=(existing?.generation??0)+1;
 const patch={state:"pending",attempts:0,generation,dueAt:now,updatedAt:now,error:undefined,notifyEligible:process.env.ENCORE_EVIDENCE_READ_ENABLED==="true"&&!options?.backfill&&!options?.quiet};
 const checkId=existing?existing._id:await ctx.db.insert("encore_settlement_checks",{bookingId,...patch});
 if(existing)await ctx.db.patch(existing._id,patch);
 if(!options?.backfill&&!options?.quiet)await ctx.scheduler.runAfter(0,internal.encoreSettlement.processCheck,{checkId});
}
