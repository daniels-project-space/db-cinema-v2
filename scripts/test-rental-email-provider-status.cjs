/** Real lease and provider-check handlers, synthetic messages and provider only. */
const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
let now=Date.UTC(2030,0,1);Date.now=()=>now;process.env.RESEND_API_KEY='fixture';
const delivery=h.load('convex/rentalEmailDelivery.ts'),worker=h.load('convex/rentalEmailMail.ts');
const mailer=h.load('convex/lib/mailer.ts');
const scheduled=[];const ctx={db:h.db,scheduler:{runAfter:async(ms,ref,args)=>scheduled.push({ms,ref,args})},
 runQuery:async(ref,a)=>{assert.equal(ref,'rentalEmailDelivery.providerCheckContext');return delivery.providerCheckContext.handler(ctx,a)},
 runMutation:async(ref,a)=>{assert.equal(ref,'rentalEmailDelivery.recordProviderStatus');return delivery.recordProviderStatus.handler(ctx,a)}};
const booking=h.put('bookings',{guestEmail:'fixture@example.invalid',status:'pending_verification'});
const row=h.put('rental_email_deliveries',{bookingId:booking._id,kind:'paid_verification',key:'fixture',sequence:1,state:'sending',generation:1,attempts:1,dueAt:now+60000,createdAt:now,updatedAt:now});
let provider='sent';global.fetch=async(url,options)=>{assert.match(url,/^https:\/\/api\.resend\.com\/emails\/fixture-id$/);assert.equal(options.headers.authorization,'Bearer fixture');if(provider==='offline')throw Error('offline');return new Response(JSON.stringify({last_event:provider,message_id:'<rental@example.invalid>'}),{status:200,headers:{'content-type':'application/json'}})};
(async()=>{
 delete process.env.GMAIL_USER;delete process.env.GMAIL_APP_PASSWORD;
 const checkFetch=global.fetch;let receipt;global.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'fixture-key');return new Response(JSON.stringify({id:'fixture-id'}),{status:200})};
 assert.equal(await mailer.sendMail({to:'fixture@example.invalid',subject:'Test',html:'Test',deliveryKey:'fixture-key'},id=>receipt=id),true);assert.equal(receipt,'fixture-id');global.fetch=checkFetch;
 assert.equal(await delivery.finish.handler(ctx,{deliveryId:row._id,generation:1,result:'sent',providerMessageId:'fixture-id'}),true);
 const mirrored=h.put('email_messages',{providerId:`rental-notice:${row._id}`});
 assert.equal(row.providerDeliveryStatus,'accepted');assert.equal(row.providerCheckDueAt,now+120000);
 now+=120000;await delivery.checkProviderDue.handler(ctx,{});const first=scheduled.at(-1).args;assert.equal(first.generation,1);
 await delivery.checkProviderDue.handler(ctx,{});assert.equal(scheduled.length,1,'active provider lease is not reclaimed');
 await worker.checkProvider.handler(ctx,first);assert.equal(row.providerDeliveryStatus,'accepted');assert.equal(row.providerRfcMessageId,'<rental@example.invalid>');assert.equal(mirrored.messageId,'<rental@example.invalid>');assert.equal(row.providerCheckDueAt,now+900000);
 assert.equal(await delivery.recordProviderStatus.handler(ctx,{...first,generation:0,status:'bounced'}),false,'stale provider result is fenced');
 now+=900000;await delivery.checkProviderDue.handler(ctx,{});provider='delivered';await worker.checkProvider.handler(ctx,scheduled.at(-1).args);
 assert.equal(row.providerDeliveryStatus,'delivered');assert((h.tables.get('admin_notifications')||[]).some(n=>n.title==='Booking email delivered'));
 now+=3600000;await delivery.checkProviderDue.handler(ctx,{});provider='bounced';await worker.checkProvider.handler(ctx,scheduled.at(-1).args);
 assert.equal(row.providerDeliveryStatus,'bounced');assert.equal(row.providerCheckDueAt,undefined);assert((h.tables.get('admin_notifications')||[]).some(n=>n.title==='Booking email could not be delivered'));
 const complained=h.put('rental_email_deliveries',{bookingId:booking._id,kind:'paid_verification',key:'complained',sequence:1,state:'sent',generation:1,attempts:1,dueAt:now,createdAt:now,updatedAt:now,sentAt:now,providerMessageId:'fixture-id',providerDeliveryStatus:'delivered',providerCheckDueAt:now,providerCheckGeneration:0});
 await delivery.checkProviderDue.handler(ctx,{});provider='complained';await worker.checkProvider.handler(ctx,scheduled.at(-1).args);assert.equal(complained.providerDeliveryStatus,'complained');assert((h.tables.get('admin_notifications')||[]).some(n=>n.title==='Booking email marked as spam'));
 const unknown=h.put('rental_email_deliveries',{bookingId:booking._id,kind:'verification_reminder',key:'unknown',sequence:1,state:'sent',generation:1,attempts:1,dueAt:now,createdAt:now,updatedAt:now,sentAt:now,providerMessageId:'fixture-id',providerDeliveryStatus:'accepted',providerCheckDueAt:now,providerCheckGeneration:0});
 await delivery.checkProviderDue.handler(ctx,{});provider='offline';await worker.checkProvider.handler(ctx,scheduled.at(-1).args);assert.equal(unknown.providerDeliveryStatus,'accepted');
 now+=24*3600000;await delivery.checkProviderDue.handler(ctx,{});await worker.checkProvider.handler(ctx,scheduled.at(-1).args);assert.equal(unknown.providerDeliveryStatus,'unconfirmed');assert((h.tables.get('admin_notifications')||[]).some(n=>n.title==='Booking email delivery needs checking'));
 console.log('PASS provider receipt monitoring: accepted, delayed, delivered, late bounce, stale leases and unresolved transport. Synthetic provider only.');
})().catch(e=>{console.error(e);process.exitCode=1});
