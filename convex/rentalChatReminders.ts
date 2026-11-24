import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { rentalChatReminderPlan } from "../shared/rentalChatReminders";
import { renterRentalActionReady } from "./lib/renterRentalActionGate";
import { postRentalMessage } from "./lib/rentalChat";
import type { Id } from "./_generated/dataModel";
import { enqueueRentalReminderPlan } from "./lib/rentalReminderPlanQueue";
import { queueOwnerNotification } from "./lib/adminPush";

const GRACE_MS = 5 * 60000;
async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
}

export async function scheduleRentalChatReminders(ctx: any, booking: any, now = Date.now()) {
  if (!renterRentalActionReady(booking) || booking.cancellationDecision || booking.returnDecision || booking.returnedAt) return;
  for (const event of rentalChatReminderPlan(booking)) {
    if (event.dueAt < now) continue;
    const key = await digest(event.key);
    const existing = await ctx.db.query("rental_chat_reminders").withIndex("by_booking_key",(query:any)=>query.eq("bookingId",booking._id).eq("key",key)).first();
    if (existing) continue;
    const reminderId = await ctx.db.insert("rental_chat_reminders",{bookingId:booking._id,key,kind:event.kind,dueAt:event.dueAt,recoverAt:event.dueAt,attempts:0,createdAt:now,state:"scheduled"});
    await ctx.scheduler.runAfter(event.dueAt-now,(internal as any).rentalChatReminders.deliver,{reminderId});
    await ctx.scheduler.runAfter(event.dueAt-now+1000,(internal as any).rentalChatReminders.recover,{});
  }
}

export const scheduleBooking=internalMutation({args:{bookingId:v.id("bookings")},handler:async(ctx,{bookingId})=>{
  const booking=await ctx.db.get(bookingId);
  if(booking)await scheduleRentalChatReminders(ctx,booking);
}});

export const executePlan=internalMutation({args:{planId:v.id("rental_chat_reminder_plans")},handler:async(ctx,{planId})=>{
  const plan=await ctx.db.get(planId);if(!plan||plan.state!=="pending")return;
  const booking=await ctx.db.get(plan.bookingId);if(booking)await scheduleRentalChatReminders(ctx,booking);
  await ctx.db.patch(planId,{state:"done",finishedAt:Date.now()});
}});

export const reportFailure=internalMutation({args:{bookingId:v.id("bookings"),eventKey:v.string()},handler:async(ctx,{bookingId,eventKey})=>{
  await queueOwnerNotification(ctx,{eventKey,kind:"reminder_failure",bookingId,title:"Rental reminder needs attention",body:"A scheduled rental chat reminder could not be prepared or sent. Check the rental conversation."});
}});

async function deliverReminder(ctx:any,reminderId:Id<"rental_chat_reminders">){
  const row=await ctx.db.get(reminderId),now=Date.now();
  if(!row||row.state!=="scheduled"||now<row.dueAt) return;
  const booking:any=await ctx.db.get(row.bookingId);
  const events=booking?rentalChatReminderPlan(booking):[];
  let event:ReturnType<typeof rentalChatReminderPlan>[number]|undefined;
  for(const candidate of events) if(candidate.kind===row.kind&&candidate.dueAt===row.dueAt&&await digest(candidate.key)===row.key){event=candidate;break;}
  const pickedUp=Number.isSafeInteger(booking?.pickedUpAt)&&booking.pickedUpAt>0;
  const valid=!!event&&now<=row.dueAt+GRACE_MS&&renterRentalActionReady(booking)&&!booking.cancellationDecision&&!booking.returnDecision&&!booking.returnedAt&&
    (row.kind==="pickup"?(booking.status==="confirmed"||booking.status==="active"&&pickedUp&&booking.pickedUpAt<event.eventAt):booking.status==="active"&&pickedUp);
  const account=valid&&booking.accountId?await ctx.db.get(booking.accountId as Id<"accounts">):null;
  if(!valid||!account||account._id!==booking.accountId||account.blockedAt||!Number.isSafeInteger(account.emailVerifiedAt)||account.emailVerifiedAt<=0){await ctx.db.patch(row._id,{state:"suppressed",finishedAt:now});return;}
  if(row.kind==="halfway"){
    const previous=await ctx.db.query("rental_chat_reminders").withIndex("by_booking_kind_state",(query:any)=>query.eq("bookingId",row.bookingId).eq("kind","halfway").eq("state","sent")).first();
    if(previous){await ctx.db.patch(row._id,{state:"suppressed",finishedAt:now});return;}
  }
  const items=event!.lines.map(line=>{const [,title,qty]=JSON.parse(line);return `${qty}× ${title || "Rental item"}`;}).join(", ");
  const time=new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/London",hourCycle:"h23"}).format(new Date(event!.eventAt));
  const text=row.kind==="pickup"?`Reminder: your scheduled ${booking.fulfilment==="delivery"?"delivery":"pickup"} is at ${time} London time. Items: ${items}. If anything comes up, please let us know as soon as possible.`:row.kind==="return"?`Reminder: your scheduled return is at ${time} London time. Items: ${items}.`: `You’re halfway through your scheduled rental period. How is everything going?`;
  const messageId=await postRentalMessage(ctx,{accountId:account._id,bookingId:booking._id,sender:"system",text,meta:{kind:"rental_chat_reminder",reminderKind:row.kind}});
  await ctx.db.patch(row._id,{state:"sent",finishedAt:now,messageId});
}
export const deliver = internalMutation({args:{reminderId:v.id("rental_chat_reminders")},handler:async(ctx,{reminderId})=>deliverReminder(ctx,reminderId)});

export const backfill = internalMutation({args:{},handler:async(ctx)=>{
  let migration=await ctx.db.query("rental_chat_reminder_migrations").withIndex("by_key",query=>query.eq("key","initial-v1")).first();
  if(!migration){const id=await ctx.db.insert("rental_chat_reminder_migrations",{key:"initial-v1",status:"confirmed",cursor:null});migration=await ctx.db.get(id);}
  if(!migration||migration.status==="complete")return;
  const {status,cursor}=migration;
  const page=await ctx.db.query("bookings").withIndex("by_status",query=>query.eq("status",status)).paginate({numItems:50,cursor});
  for(const booking of page.page)await enqueueRentalReminderPlan(ctx,booking._id,false);
  if(page.page.length)await ctx.scheduler.runAfter(0,(internal as any).rentalChatReminders.recover,{});
  const nextStatus=page.isDone?(status==="confirmed"?"active":"complete"):status;
  await ctx.db.patch(migration._id,{status:nextStatus,cursor:page.isDone?null:page.continueCursor});
  if(nextStatus!=="complete")await ctx.scheduler.runAfter(0,(internal as any).rentalChatReminders.backfill,{});
}});

export const recover = internalMutation({args:{},handler:async(ctx)=>{
  const now=Date.now(),rows=await ctx.db.query("rental_chat_reminders").withIndex("by_state_recover",query=>query.eq("state","scheduled").lte("recoverAt",now)).take(50);
  for(const row of rows){
    if(now>row.dueAt+GRACE_MS||(row.attempts??0)>=3){
      await ctx.db.patch(row._id,{state:"failed",finishedAt:now});
      await ctx.scheduler.runAfter(0,(internal as any).rentalChatReminders.reportFailure,{bookingId:row.bookingId,eventKey:`rental-chat-reminder-failed:${row._id}`});
    }else{
      await ctx.db.patch(row._id,{attempts:(row.attempts??0)+1,recoverAt:now+30000});
      await ctx.scheduler.runAfter(0,(internal as any).rentalChatReminders.deliver,{reminderId:row._id});
    }
  }
  const plans=await ctx.db.query("rental_chat_reminder_plans").withIndex("by_state_recover",query=>query.eq("state","pending").lte("recoverAt",now)).take(50);
  for(const plan of plans){
    if(plan.attempts>=3){await ctx.db.patch(plan._id,{state:"failed",finishedAt:now});await ctx.scheduler.runAfter(0,(internal as any).rentalChatReminders.reportFailure,{bookingId:plan.bookingId,eventKey:`rental-chat-reminder-plan-failed:${plan._id}`});}
    else{await ctx.db.patch(plan._id,{attempts:plan.attempts+1,recoverAt:now+30000});await ctx.scheduler.runAfter(0,(internal as any).rentalChatReminders.executePlan,{planId:plan._id});}
  }
  if(rows.length===50||plans.length===50)await ctx.scheduler.runAfter(0,(internal as any).rentalChatReminders.recover,{});
  if(rows.length||plans.length)await ctx.scheduler.runAfter(30000,(internal as any).rentalChatReminders.recover,{});
}});

export const purgeMetadata = internalMutation({args:{},handler:async(ctx)=>{
  const now=Date.now(),cutoff=now-90*86400000;
  for(const state of ["sent","suppressed","failed"] as const){
    const rows=await ctx.db.query("rental_chat_reminders").withIndex("by_state_finished",query=>query.eq("state",state).lte("finishedAt",cutoff)).take(100);
    for(const row of rows){
      if(row.kind==="halfway"&&state==="sent"){
        const booking=await ctx.db.get(row.bookingId);
        if(booking&&!booking.returnedAt&&booking.status!=="cancelled"){await ctx.db.patch(row._id,{finishedAt:now});continue;}
      }
      await ctx.db.delete(row._id);
    }
  }
  for(const state of ["done","failed"] as const){
    const rows=await ctx.db.query("rental_chat_reminder_plans").withIndex("by_state_finished",query=>query.eq("state",state).lte("finishedAt",cutoff)).take(100);
    for(const row of rows)await ctx.db.delete(row._id);
  }
}});
