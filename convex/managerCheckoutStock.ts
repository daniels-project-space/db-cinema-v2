import { internalMutation } from "./_generated/server";
export const snapshot=internalMutation({args:{},handler:async(ctx)=>{
 const prior=await ctx.db.query("manager_checkout_stock").withIndex("by_key",q=>q.eq("key","website")).unique();
 const holds=await ctx.db.query("reservations").withIndex("by_status_expiry",q=>q.eq("status","hold").gt("holdExpiresAt",Date.now())).take(501);
 if(holds.length>500)throw Error("Checkout stock snapshot exceeds bounded capacity");
 const rows=[];
 const units=new Map(),bookings=new Map();
 for(const h of holds){
  if(h.source!=="site"||!h.bookingId)continue;
  if(!bookings.has(h.bookingId))bookings.set(h.bookingId,await ctx.db.get(h.bookingId));
  if(bookings.get(h.bookingId)?.status!=="pending_payment")continue;
  if(!units.has(h.inventoryUnitId))units.set(h.inventoryUnitId,await ctx.db.get(h.inventoryUnitId));
  const masterItemId=units.get(h.inventoryUnitId)?.rmv2ItemId;
  if(!masterItemId)throw Error("Held website stock has no shared physical identity");
  rows.push({bookingId:String(h.bookingId),masterItemId,start:h.start,end:h.end,qty:h.qty,expiresAt:h.holdExpiresAt!,endExclusive:h.endExclusive===true,bufferMinutes:h.turnaroundBufferMinutes??0});
 }
 rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const payload=JSON.stringify(rows),changed=prior?.payload!==payload || prior?.deliveredRevision===prior?.revision && Date.now()-(prior?.generatedAt??0)>=60000;
 const revision=changed?Math.max(Date.now(),(prior?.revision??0)+1):prior!.revision;
 if(changed){const data={key:"website",revision,payload,generatedAt:Date.now(),attempts:0,dueAt:Date.now()};if(prior)await ctx.db.patch(prior._id,data);else await ctx.db.insert("manager_checkout_stock",data);}
 if(!changed&&(prior!.deliveredRevision===revision||prior!.dueAt>Date.now()||prior!.attempts>=12))return null;
 return {revision,rows};
}});
import {v} from "convex/values";
export const record=internalMutation({args:{revision:v.number(),ok:v.boolean(),reason:v.optional(v.string())},handler:async(ctx,a)=>{
 const row=await ctx.db.query("manager_checkout_stock").withIndex("by_key",q=>q.eq("key","website")).unique();
 if(!row||row.revision!==a.revision||row.deliveredRevision===a.revision)return;
 if(a.ok)await ctx.db.patch(row._id,{deliveredRevision:a.revision,error:undefined});
 else{const attempts=row.attempts+1;await ctx.db.patch(row._id,{attempts,dueAt:Date.now()+Math.min(3600000,30000*2**Math.min(attempts,7)),error:a.reason?.slice(0,100)});}
}});
