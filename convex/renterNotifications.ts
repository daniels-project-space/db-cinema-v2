import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { accountForToken, rentalThread } from "./lib/rentalChat";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { validatePushSubscription } from "./lib/adminPush";
import { renterPushKeys } from "./lib/renterPush";

async function identity(ctx:any,token:string) {
  const account=await accountForToken(ctx,token);
  if (!account) throw Error("Sign in again to manage notifications.");
  const session=await ctx.db.query("sessions").withIndex("by_token",(q:any)=>q.eq("token",token)).first();
  return {account,session};
}
function validDevice(id:string) { if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw Error("Invalid device."); }
export const device=query({args:{token:v.string(),deviceId:v.string()},handler:async(ctx,{token,deviceId})=>{
  const {account}=await identity(ctx,token); validDevice(deviceId);
  const row=await ctx.db.query("renter_push_subscriptions").withIndex("by_device",q=>q.eq("deviceId",deviceId)).first();
  const owned=row?.accountId===account._id?row:null; const keys=renterPushKeys();
  const bound=owned?await ctx.db.get(owned.sessionId):null;
  const sessionAlive=bound&&(bound.expiresAt==null||bound.expiresAt>Date.now());
  return {enabled:!!owned?.enabled&&!!sessionAlive,messagesEnabled:owned?.messagesEnabled??true,bookingEnabled:owned?.bookingEnabled??true,
    publicKey:keys.publicKey??null,configured:!!keys.publicKey&&!!keys.privateKey,lastError:owned?.lastError??null};
}});
export const subscribe=mutation({args:{token:v.string(),deviceId:v.string(),endpoint:v.string(),p256dh:v.string(),auth:v.string()},handler:async(ctx,{token,deviceId,...keys})=>{
  const {account,session}=await identity(ctx,token);validDevice(deviceId);
  if (!renterPushKeys().publicKey||!renterPushKeys().privateKey) throw Error("Rental notifications are not configured yet.");
  validatePushSubscription(keys.endpoint,keys.p256dh,keys.auth);
  const existing=await ctx.db.query("renter_push_subscriptions").withIndex("by_device",q=>q.eq("deviceId",deviceId)).first();
  const endpoint=await ctx.db.query("renter_push_subscriptions").withIndex("by_endpoint",q=>q.eq("endpoint",keys.endpoint)).first();
  for (const previous of [existing,endpoint]) if(previous&&previous.accountId!==account._id&&previous.enabled) {
    const oldSession=await ctx.db.get(previous.sessionId);
    if(oldSession&&(oldSession.expiresAt==null||oldSession.expiresAt>Date.now())) throw Error("Sign out of the previous account on this device first.");
  }
  if(endpoint&&endpoint._id!==existing?._id)await ctx.db.patch(endpoint._id,{enabled:false,updatedAt:Math.max(Date.now(),endpoint.updatedAt+1)});
  const sameOwner=existing?.accountId===account._id;
  const patch={...keys,accountId:account._id,sessionId:session._id,enabled:true,updatedAt:Math.max(Date.now(),(existing?.updatedAt??0)+1),
    messagesEnabled:sameOwner?existing!.messagesEnabled:true,bookingEnabled:sameOwner?existing!.bookingEnabled:true,lastError:undefined};
  if(existing)await ctx.db.patch(existing._id,patch);else await ctx.db.insert("renter_push_subscriptions",{...patch,deviceId,createdAt:Date.now()});
  return {enabled:true};
}});
export const preferences=mutation({args:{token:v.string(),deviceId:v.string(),messagesEnabled:v.boolean(),bookingEnabled:v.boolean()},handler:async(ctx,{token,deviceId,messagesEnabled,bookingEnabled})=>{
  const {account}=await identity(ctx,token);const row=await ctx.db.query("renter_push_subscriptions").withIndex("by_device",q=>q.eq("deviceId",deviceId)).first();
  if(!row||row.accountId!==account._id)throw Error("Enable notifications on this device first.");
  await ctx.db.patch(row._id,{messagesEnabled,bookingEnabled});
}});
export const disable=mutation({args:{token:v.string(),deviceId:v.string()},handler:async(ctx,{token,deviceId})=>{
  const {account}=await identity(ctx,token);const row=await ctx.db.query("renter_push_subscriptions").withIndex("by_device",q=>q.eq("deviceId",deviceId)).first();
  if(row&&row.accountId===account._id)await ctx.db.patch(row._id,{enabled:false,updatedAt:Math.max(Date.now(),row.updatedAt+1)});
}});
export const claim=internalMutation({args:{deliveryId:v.id("renter_push_deliveries"),claimId:v.string()},handler:async(ctx,{deliveryId,claimId})=>{
  const d=await ctx.db.get(deliveryId),now=Date.now();
  if(!d||["sent","skipped","permanent_failure"].includes(d.status)||d.nextAttemptAt>now||d.status==="delivering"&&(d.claimedAt??0)>now-120000)return null;
  const s=await ctx.db.get(d.subscriptionId),n=await ctx.db.get(d.notificationId);
  const a=s?await ctx.db.get(s.accountId):null,session=s?await ctx.db.get(s.sessionId):null;
  const thread=n?await rentalThread(ctx,n.accountId,n.bookingId):null;
  const booking=n?.bookingId?await ctx.db.get(n.bookingId):null;
  const skip=!s?.enabled||!n||s.updatedAt!==d.subscriptionUpdatedAt||s.accountId!==n.accountId||!a||a.blockedAt!=null||a.emailVerificationRequired&&!a.emailVerifiedAt||
    !session||session.accountId!==s.accountId||session.expiresAt!=null&&session.expiresAt<=now||now-n.createdAt>86400000||
    (thread?.renterReadAt??-1)>=n.messageAt||n.bookingId&&!belongsToRentalAccount(booking,a)||!(n.kind==="messages"?s.messagesEnabled:s.bookingEnabled);
  if(skip){await ctx.db.patch(deliveryId,{status:"skipped",updatedAt:now});return null;}
  await ctx.db.patch(deliveryId,{status:"delivering",claimId,claimedAt:now,attempts:d.attempts+1,updatedAt:now,nextAttemptAt:now+120000});
  return {subscription:s,notification:n};
}});
export const finish=internalMutation({args:{deliveryId:v.id("renter_push_deliveries"),claimId:v.string(),sent:v.boolean(),expired:v.boolean(),error:v.optional(v.string())},handler:async(ctx,{deliveryId,claimId,sent,expired,error})=>{
  const d=await ctx.db.get(deliveryId);if(!d||d.claimId!==claimId||d.status!=="delivering")return;
  const retry=!sent&&!expired&&d.attempts<5,next=Date.now()+Math.min(3600000,30000*2**d.attempts);
  await ctx.db.patch(deliveryId,{status:sent?"sent":retry?"retry":"permanent_failure",updatedAt:Date.now(),nextAttemptAt:next,lastError:error});
  const s=await ctx.db.get(d.subscriptionId);
  if(s?.updatedAt===d.subscriptionUpdatedAt)await ctx.db.patch(s._id,{...(expired?{enabled:false}:{}),lastError:sent?undefined:expired?"This device's subscription expired. Enable notifications again.":error});
  if(retry)await ctx.scheduler.runAfter(next-Date.now(),internal.renterPushDelivery.deliver,{deliveryId});
}});
export const due=internalQuery({args:{},handler:async(ctx)=>{
  const pages=await Promise.all(["queued","retry","delivering"].map(status=>ctx.db.query("renter_push_deliveries").withIndex("by_status_due",q=>q.eq("status",status).lte("nextAttemptAt",Date.now())).take(20)));
  return pages.flat().map(d=>d._id);
}});
