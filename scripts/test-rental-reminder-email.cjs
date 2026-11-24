const assert=require("node:assert/strict"),h=require("./lib/rentalTestHarness.cjs");
const RealDate=Date;let now=RealDate.UTC(2030,0,1),mailResult={sent:true},storageSerial=0;
global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}};
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_ADMIN_CHAT_ID;
process.env.APP_URL="https://dbcinemarentals.com";
const mails=[],threads=new Map(),scheduled=[],stored=new Map();
const sendBusinessMailTracked=async message=>{mails.push(message);return mailResult};
h.setMock("./lib/mailer",{sendMail:async()=>true,sendBusinessMailTracked});
h.setMock("./mailer",{sendBusinessMailTracked});
const queue=h.load("convex/lib/rentalEmailQueue.ts");
const delivery=h.load("convex/rentalEmailDelivery.ts");
const worker=h.load("convex/rentalEmailMail.ts");
const notify=h.load("convex/notify.ts");
const feed=[];
const ctx={
 db:h.db,
 scheduler:{runAfter:async(ms,reference,args)=>{scheduled.push({ms,reference,args})}},
 storage:{store:async blob=>{const id=`_storage-${++storageSerial}`;stored.set(id,blob);return id},get:async id=>stored.get(id)??null,delete:async id=>stored.delete(id)},
 runQuery:async(reference,args)=>{
  if(reference==="bookings.remindersFeed")return feed;
  if(reference==="bookings.receiptContext"){
   const booking=await h.db.get(args.bookingId);if(!booking)return null;
   const account=booking.accountId?await h.db.get(booking.accountId):null;
   return {...booking,guestEmail:account?.email??(booking.accountId?null:booking.guestEmail)};
  }
  if(reference==="rentalEmailDelivery.ready")return delivery.ready.handler(ctx,args);
  throw Error(`Unexpected query ${reference}`);
 },
 runMutation:async(reference,args)=>{
  if(reference==="rentalEmailDelivery.queueReminder")return delivery.queueReminder.handler(ctx,args);
  if(reference==="rentalEmailDelivery.prepare")return delivery.prepare.handler(ctx,args);
  if(reference==="rentalEmailDelivery.finish")return delivery.finish.handler(ctx,args);
  if(reference==="rentalEmailDelivery.deferReviewIfNotDueForDelivery")return delivery.deferReviewIfNotDueForDelivery.handler(ctx,args);
  if(reference==="emailInbox.prepareRentalEmailThread"){
   const existing=threads.get(args.deliveryId);
   if(!existing)threads.set(args.deliveryId,{...args,attempts:0});
   threads.get(args.deliveryId).attempts++;
   return {ok:true,tracked:true,replyTo:`gaffer+${String(args.deliveryId).replace(/[^a-z0-9]/gi,"").slice(-24)}@resend.example.invalid`};
  }
  if(reference==="emailInbox.finishRentalEmailThread")return true;
  throw Error(`Unexpected mutation ${reference}`);
 },
 runAction:async(reference,args)=>{
  const [group,name]=reference.split(".");
  return ({notify})[group][name].handler(ctx,args);
 },
};

function addBooking({status="confirmed",start=Date.UTC(2030,0,2),end=Date.UTC(2030,0,3),idVerifyStatus="verified",remindedPickup=false,remindedReturn=false}={}){
 const account=h.put("accounts",{email:`renter-${feed.length}@example.invalid`,emailVerifiedAt:now,name:"Renter"});
 const booking=h.put("bookings",{
  accountId:account._id,guestEmail:account.email,status,idVerifyStatus,verificationExpiresAt:Date.UTC(2030,3,1),
  fulfilment:"pickup",pickupTime:"10:30",returnTime:"18:00",remindedPickup,remindedReturn,
  lineItems:[{title:"Sony FX3 camera",start,end,pickupTime:"10:30",returnTime:"18:00",qty:1}],
 });
 feed.push({_id:booking._id,start,end,guestEmail:account.email,fulfilment:booking.fulfilment,pickupTime:booking.pickupTime,returnTime:booking.returnTime,remindedPickup,remindedReturn,summary:"Sony FX3 camera"});
 return booking;
}
function deliveryFor(booking,kind){return h.tables.get("rental_email_deliveries").filter(row=>row.bookingId===booking._id&&row.kind===kind).at(-1)}
async function send(deliveryRow){
 assert.equal(await delivery.dispatchOne.handler(ctx,{deliveryId:deliveryRow._id}),true);
 const scheduledSend=scheduled.at(-1);
 assert.equal(scheduledSend.reference,"rentalEmailMail.deliver");
 await worker.deliver.handler(ctx,scheduledSend.args);
}

(async()=>{
 const pickup=addBooking();
 const returned=addBooking({status:"returned",start:Date.UTC(2029,11,31),end:Date.UTC(2030,0,1)});
 const unverified=addBooking({idVerifyStatus:"requires_input"});
 const returnDue=addBooking({status:"active",start:Date.UTC(2029,11,30),end:Date.UTC(2030,0,1)});
 const expiredApproval=addBooking();expiredApproval.verificationExpiresAt=Date.UTC(2029,11,31);expiredApproval.idVerifiedAt=Date.UTC(2029,8,30);

 assert.deepEqual(await notify.sendReminders.handler(ctx,{}),{checked:5,queued:3},"Confirmed pickup reminders survive badge expiry; only a verified upcoming pickup and active due return queue");
 assert.ok(deliveryFor(pickup,"pickup_reminder"));
 assert.ok(deliveryFor(returnDue,"return_reminder"));
 assert.equal(deliveryFor(returned,"return_reminder"),undefined,"A returned rental never gets a due-today return reminder");
 assert.equal(deliveryFor(unverified,"pickup_reminder"),undefined,"Unverified bookings do not get pickup reminders");
 assert.ok(deliveryFor(expiredApproval,"pickup_reminder"),"A confirmed rental keeps reminders after its account-level verification badge expires");
 const initialQueueJobs=scheduled.filter(job=>job.reference==="rentalEmailDelivery.dispatchOne").length;
 assert.deepEqual(await notify.sendReminders.handler(ctx,{}),{checked:5,queued:0},"Cron replay reuses the existing reminder delivery");
 assert.equal(scheduled.filter(job=>job.reference==="rentalEmailDelivery.dispatchOne").length,initialQueueJobs,"Idempotent cron replay does not schedule another delivery");

 await send(deliveryFor(pickup,"pickup_reminder"));
 assert.equal(pickup.remindedPickup,true,"Pickup reminder is marked only after provider acceptance");
 assert.equal(mails.length,1);
 assert.equal(mails[0].to,pickup.guestEmail);
 assert.equal(mails[0].subject,"Your DB Cinema pickup is tomorrow 🎬");
 assert.equal(mails[0].deliveryKey,deliveryFor(pickup,"pickup_reminder").key,"Provider idempotency key stays stable");
 assert.match(mails[0].html,/Sony FX3 camera/);
 assert.match(mails[0].html,new RegExp(`/account\\?rental=${pickup._id}#chat`),"Reminder links to the renter's rental conversation");
 assert.ok(threads.has(deliveryFor(pickup,"pickup_reminder")._id),"Pickup email is saved in the rental's tracked email conversation");

 await send(deliveryFor(returnDue,"return_reminder"));
 assert.equal(returnDue.remindedReturn,true,"Return reminder is marked only after provider acceptance");
 assert.equal(mails.length,2);
 assert.equal(mails[1].to,returnDue.guestEmail);
 assert.match(mails[1].subject,/return is due today/i);
 assert.ok(threads.has(deliveryFor(returnDue,"return_reminder")._id),"Return email is saved in the rental's tracked email conversation");

 const extended=addBooking({status:"active",start:Date.UTC(2029,11,31),end:Date.UTC(2030,0,1)});
 await notify.sendReminders.handler(ctx,{});
 const staleReturn=deliveryFor(extended,"return_reminder");assert.ok(staleReturn);
 extended.lineItems[0].end=Date.UTC(2030,0,2);feed.find(row=>row._id===extended._id).end=extended.lineItems[0].end;
 assert.equal(await delivery.dispatchOne.handler(ctx,{deliveryId:staleReturn._id}),false,"A queued return reminder is suppressed after a schedule extension");
 assert.equal(staleReturn.state,"skipped");
 now=Date.UTC(2030,0,2);
 assert.deepEqual(await notify.sendReminders.handler(ctx,{}),{checked:6,queued:1},"The new return date receives one reminder after the superseded notice is skipped");
 const replacementReturn=deliveryFor(extended,"return_reminder");
 assert.notEqual(replacementReturn._id,staleReturn._id);
 assert.equal(replacementReturn.sequence,2);
 assert.notEqual(replacementReturn.key,staleReturn.key,"A rescheduled reminder receives a distinct provider idempotency key");
 await send(replacementReturn);
 assert.equal(extended.remindedReturn,true,"The replacement return reminder marks the updated schedule only after send acceptance");
 assert.equal(mails.length,3);

 const exhausted=addBooking({status:"active",start:Date.UTC(2030,0,3),end:Date.UTC(2030,0,4)});
 assert.deepEqual(await notify.sendReminders.handler(ctx,{}),{checked:7,queued:1});
 const failingDelivery=deliveryFor(exhausted,"pickup_reminder");
 assert.ok(failingDelivery);
 mailResult={sent:false,ambiguous:false};
 const firstMailIndex=mails.length;
 for(let attempt=1;attempt<=8;attempt++){
  now=Math.max(now,failingDelivery.dueAt);
  await send(failingDelivery);
  assert.equal(failingDelivery.attempts,attempt);
 }
 assert.equal(failingDelivery.state,"failed","Reminder retries stop at the durable outbox limit");
 assert.equal(exhausted.remindedPickup,false,"Failed reminder is never recorded as sent");
 assert.equal(new Set(mails.slice(firstMailIndex).map(message=>message.deliveryKey)).size,1,"Retries retain one provider idempotency key");
 assert.equal(threads.get(failingDelivery._id).attempts,8,"Retries reuse the single tracked email thread");
 assert.ok(h.tables.get("admin_notifications").some(row=>row.bookingId===exhausted._id&&row.kind==="email_failure"),"Exhausted reminder retries alert the team");
 assert.deepEqual(await notify.sendReminders.handler(ctx,{}),{checked:7,queued:0},"Exhausted delivery is not duplicated by another cron run");
 assert.equal(h.tables.get("rental_email_deliveries").filter(row=>row.bookingId===exhausted._id&&row.kind==="pickup_reminder").length,1);
 console.log("PASS tracked pickup/return reminders: booking status gates, durable inbox thread, linked chat, duplicate cron replay, provider idempotency, bounded retries and failure alerting.");
})().catch(error=>{console.error(error);process.exitCode=1});
