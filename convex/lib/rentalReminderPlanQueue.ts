import { internal } from "../_generated/api";

export async function enqueueRentalReminderPlan(ctx:any,bookingId:any,wake=true){
  const existing=await ctx.db.query("rental_chat_reminder_plans").withIndex("by_booking",(query:any)=>query.eq("bookingId",bookingId)).first();
  const now=Date.now();
  if(existing)await ctx.db.patch(existing._id,{state:"pending",recoverAt:now,attempts:0,finishedAt:undefined});
  else await ctx.db.insert("rental_chat_reminder_plans",{bookingId,state:"pending",recoverAt:now,attempts:0});
  if(wake)await ctx.scheduler.runAfter(0,(internal as any).rentalChatReminders.recover,{});
}
