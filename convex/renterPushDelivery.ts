"use node";
import webpush from "web-push";
import { randomUUID, createHash } from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { validatePushSubscription } from "./lib/adminPush";
import { renterPushKeys } from "./lib/renterPush";
export const deliver=internalAction({args:{deliveryId:v.id("renter_push_deliveries")},handler:async(ctx,{deliveryId})=>{
  const claimId=randomUUID();const data=await ctx.runMutation(internal.renterNotifications.claim,{deliveryId,claimId});if(!data)return;
  let sent=false,expired=false,error:string|undefined;
  try{const s=data.subscription,n=data.notification,keys=renterPushKeys();validatePushSubscription(s.endpoint,s.p256dh,s.auth);
    if(!keys.publicKey||!keys.privateKey)throw Error("Push configuration missing");
    const url=n.bookingId?`/account?rental=${encodeURIComponent(n.bookingId)}#chat`:"/account?conversation=general#chat";
    await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify({title:"DB Cinema Rentals",body:n.kind==="messages"?"Your rental team sent you a message.":"There is an update to your rental. Open your account to review it.",url,tag:n.eventKey}),
      {vapidDetails:{subject:"https://dbcinemarentals.com",publicKey:keys.publicKey,privateKey:keys.privateKey},TTL:300,timeout:10000,urgency:"high",topic:createHash("sha256").update(n.eventKey).digest("hex").slice(0,32)});sent=true;
  }catch(e:any){expired=[404,410].includes(e.statusCode);error=expired?"Subscription expired":`Push delivery failed${e.statusCode?` (${e.statusCode})`:""}`;}
  await ctx.runMutation(internal.renterNotifications.finish,{deliveryId,claimId,sent,expired,error});
}});
export const retryDue=internalAction({args:{},handler:async(ctx)=>{for(const deliveryId of await ctx.runQuery(internal.renterNotifications.due,{}))await ctx.scheduler.runAfter(0,internal.renterPushDelivery.deliver,{deliveryId});}});
