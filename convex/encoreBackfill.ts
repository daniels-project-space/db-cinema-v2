import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { queueEncoreCheck } from "./lib/encoreCheckQueue";

const KEY="clean-rental-evidence-v1";
const LEASE_MS=5*60000;
const PAGE_SIZE=50;

export const start=internalMutation({args:{},handler:async ctx=>{
 const row=await ctx.db.query("encore_backfills").withIndex("by_key",query=>query.eq("key",KEY)).unique();
 if(row?.state==="complete" || row?.state==="running"&&row.updatedAt>Date.now()-LEASE_MS)return;
 const generation=(row?.generation??0)+1;
 if(row)await ctx.db.patch(row._id,{state:"running",generation,updatedAt:Date.now()});
 else await ctx.db.insert("encore_backfills",{key:KEY,state:"running",generation,updatedAt:Date.now()});
 await ctx.scheduler.runAfter(0,internal.encoreBackfill.page,{generation});
}});

export const recover=internalMutation({args:{},handler:async ctx=>{
 const row=await ctx.db.query("encore_backfills").withIndex("by_key",query=>query.eq("key",KEY)).unique();
 if(!row||row.state!=="running"||row.updatedAt>Date.now()-LEASE_MS)return;
 const generation=row.generation+1;
 await ctx.db.patch(row._id,{generation,updatedAt:Date.now()});
 await ctx.scheduler.runAfter(0,internal.encoreBackfill.page,{generation});
}});

export const page=internalMutation({args:{generation:v.number()},handler:async(ctx,{generation})=>{
 const row=await ctx.db.query("encore_backfills").withIndex("by_key",query=>query.eq("key",KEY)).unique();
 if(!row||row.state!=="running"||row.generation!==generation)return;
 const result=await ctx.db.query("bookings").withIndex("by_status",query=>query.eq("status","returned")).paginate({numItems:PAGE_SIZE,cursor:row.cursor??null});
 for(const booking of result.page)await queueEncoreCheck(ctx,booking._id,{backfill:true});
 await ctx.db.patch(row._id,{state:result.isDone?"complete":"running",cursor:result.isDone?undefined:result.continueCursor,updatedAt:Date.now()});
 if(!result.isDone)await ctx.scheduler.runAfter(0,internal.encoreBackfill.page,{generation});
}});
