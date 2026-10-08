const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const {load,db,put,tables,setMock}=require('./lib/rentalTestHarness.cjs');
let failure=0;const sent=[];
setMock('web-push',{default:{sendNotification:async(s,payload)=>{if(failure)throw Object.assign(Error('private endpoint/body must never appear in error'),{statusCode:failure});sent.push({endpoint:s.endpoint,payload:JSON.parse(payload)});}}});
const notifications=load('convex/renterNotifications.ts'),delivery=load('convex/renterPushDelivery.ts'),accounts=load('convex/accounts.ts');
const {postRentalMessage}=load('convex/lib/rentalChat.ts'),{queueRenterNotification,renterPushKeys}=load('convex/lib/renterPush.ts');
const prior=Object.fromEntries(['RENTER_PUSH_PUBLIC_KEY','RENTER_PUSH_PRIVATE_KEY','ADMIN_PUSH_PUBLIC_KEY','ADMIN_PUSH_PRIVATE_KEY'].map(k=>[k,process.env[k]]));
process.env.RENTER_PUSH_PUBLIC_KEY='fixture-public';process.env.RENTER_PUSH_PRIVATE_KEY='fixture-private';
const scheduled=[];let serial=Promise.resolve();const ctx={db,scheduler:{runAfter:async(...a)=>scheduled.push(a)},runMutation:(ref,a)=>{const operation=serial.then(()=>notifications[ref.split('.')[1]].handler(ctx,a));serial=operation.catch(()=>{});return operation;},runQuery:(ref,a)=>notifications[ref.split('.')[1]].handler(ctx,a)};
const a=put('accounts',{email:'a@fixture.invalid'}),b=put('accounts',{email:'b@fixture.invalid'});
const session=put('sessions',{accountId:a._id,token:'a-token',expiresAt:Date.now()+3600000});put('sessions',{accountId:b._id,token:'b-token',expiresAt:Date.now()+3600000});
const rental=put('bookings',{accountId:a._id,guestEmail:a.email,status:'confirmed'});
const subscription={deviceId:'fixture-device',endpoint:'https://fcm.googleapis.com/fcm/send/fixture',p256dh:crypto.randomBytes(65).toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')};
async function message(sender='owner',bookingId=rental._id){await postRentalMessage(ctx,{accountId:a._id,bookingId,sender,text:'Private customer document and charge details'});return tables.get('renter_push_deliveries')?.at(-1);}
async function enable(){await notifications.subscribe.handler(ctx,{token:'a-token',...subscription});}
(async()=>{
 await assert.rejects(notifications.device.handler(ctx,{token:'bad',deviceId:subscription.deviceId}));
 await assert.rejects(notifications.subscribe.handler(ctx,{token:'a-token',...subscription,endpoint:'https://localhost/private'}));
 await enable();await enable();assert.equal(tables.get('renter_push_subscriptions').length,1);
 assert.equal((await notifications.device.handler(ctx,{token:'b-token',deviceId:subscription.deviceId})).enabled,false);
 await assert.rejects(notifications.subscribe.handler(ctx,{token:'b-token',...subscription}),/previous account/);
 await notifications.disable.handler(ctx,{token:'b-token',deviceId:subscription.deviceId});assert.equal(tables.get('renter_push_subscriptions')[0].enabled,true);
 await assert.rejects(notifications.preferences.handler(ctx,{token:'b-token',deviceId:subscription.deviceId,messagesEnabled:false,bookingEnabled:false}));
 const first=await message();await Promise.all([delivery.deliver.handler(ctx,{deliveryId:first._id}),delivery.deliver.handler(ctx,{deliveryId:first._id})]);assert.equal(sent.length,1);assert.equal(first.status,'sent');assert.equal(sent[0].payload.url,`/account?rental=${rental._id}#chat`);assert.ok(!JSON.stringify(sent[0]).includes('Private customer'));
 const n=tables.get('renter_notifications')[0];await queueRenterNotification(ctx,{eventKey:n.eventKey,kind:n.kind,accountId:n.accountId,bookingId:n.bookingId,messageAt:n.messageAt});assert.equal(tables.get('renter_push_deliveries').length,1);
 await notifications.preferences.handler(ctx,{token:'a-token',deviceId:subscription.deviceId,messagesEnabled:false,bookingEnabled:true});const count=tables.get('renter_push_deliveries').length;await message();assert.equal(tables.get('renter_push_deliveries').length,count);
 const update=await message('system');assert.equal(tables.get('renter_notifications').at(-1).kind,'booking');await delivery.deliver.handler(ctx,{deliveryId:update._id});assert.equal(update.status,'sent');
 await notifications.preferences.handler(ctx,{token:'a-token',deviceId:subscription.deviceId,messagesEnabled:true,bookingEnabled:true});
 const read=await message();const thread=tables.get('chat_threads').find(t=>t.bookingId===rental._id);await db.patch(thread._id,{renterReadAt:tables.get('renter_notifications').at(-1).messageAt});await delivery.deliver.handler(ctx,{deliveryId:read._id});assert.equal(read.status,'skipped');
 const retry=await message();failure=503;await delivery.deliver.handler(ctx,{deliveryId:retry._id});assert.equal(retry.status,'retry');assert.equal(retry.lastError,'Push delivery failed (503)');const stale=retry.claimId;await db.patch(retry._id,{nextAttemptAt:0});failure=0;await delivery.deliver.handler(ctx,{deliveryId:retry._id});assert.equal(retry.status,'sent');await notifications.finish.handler(ctx,{deliveryId:retry._id,claimId:stale,sent:false,expired:true});assert.equal(retry.status,'sent');
 const renewed=await message();await enable();await delivery.deliver.handler(ctx,{deliveryId:renewed._id});assert.equal(renewed.status,'skipped','subscription generation change invalidates old queued work');
 const disabled=await message();await notifications.disable.handler(ctx,{token:'a-token',deviceId:subscription.deviceId});await delivery.deliver.handler(ctx,{deliveryId:disabled._id});assert.equal(disabled.status,'skipped');await enable();
 const expired=await message();failure=410;await delivery.deliver.handler(ctx,{deliveryId:expired._id});assert.equal(expired.status,'permanent_failure');assert.equal((await notifications.device.handler(ctx,{token:'a-token',deviceId:subscription.deviceId})).enabled,false);failure=0;await enable();
 const recovered=await message();await notifications.claim.handler(ctx,{deliveryId:recovered._id,claimId:'lost-worker'});assert.equal(await notifications.claim.handler(ctx,{deliveryId:recovered._id,claimId:'too-soon'}),null);await db.patch(recovered._id,{claimedAt:0,nextAttemptAt:0});await delivery.deliver.handler(ctx,{deliveryId:recovered._id});assert.equal(recovered.status,'sent');
 const general=await message('owner',undefined); // default argument selects rental; invoke general explicitly below.
 await postRentalMessage(ctx,{accountId:a._id,sender:'owner',text:'General private support'});const generalDelivery=tables.get('renter_push_deliveries').at(-1);await delivery.deliver.handler(ctx,{deliveryId:generalDelivery._id});assert.equal(sent.at(-1).payload.url,'/account?conversation=general#chat');
 const blocked=await message();await db.patch(a._id,{blockedAt:Date.now()});await delivery.deliver.handler(ctx,{deliveryId:blocked._id});assert.equal(blocked.status,'skipped');await db.patch(a._id,{blockedAt:undefined});
 const oldSession=await message();await db.patch(session._id,{expiresAt:0});await delivery.deliver.handler(ctx,{deliveryId:oldSession._id});assert.equal(oldSession.status,'skipped');await db.patch(session._id,{expiresAt:Date.now()+3600000});
 const logout=await message();await accounts.signOut.handler(ctx,{token:'a-token'});await delivery.deliver.handler(ctx,{deliveryId:logout._id});assert.equal(logout.status,'skipped');assert.equal(tables.get('renter_push_subscriptions')[0].enabled,false);
 await notifications.subscribe.handler(ctx,{token:'b-token',...subscription});assert.equal(tables.get('renter_push_subscriptions')[0].accountId,b._id);await delivery.deliver.handler(ctx,{deliveryId:general._id});assert.equal(general.status,'skipped');
 delete process.env.RENTER_PUSH_PRIVATE_KEY;process.env.ADMIN_PUSH_PRIVATE_KEY='different-pair';assert.equal(renterPushKeys().privateKey,undefined,'never mix one renter key with an unrelated admin key');
 const events={},shown=[],opened=[];let windows=[];const origin='https://dbcinemarentals.com';
 vm.runInNewContext(fs.readFileSync('public/renter-notifications-sw.js','utf8'),{URL,self:{location:{origin},addEventListener:(name,fn)=>events[name]=fn,registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>windows,openWindow:async url=>opened.push(url)}}});
 async function click(url){let pending;events.notificationclick({notification:{data:{url},close(){}},waitUntil:p=>pending=p});if(pending)await pending;}
 await click('/account?conversation=general#chat');assert.equal(opened.at(-1),origin+'/account?conversation=general#chat');
 const shopper={url:origin+'/gear',navigate:()=>{throw Error('Shopper must never be navigated')}};windows=[shopper];await click('/account?rental=abc#chat');assert.equal(opened.at(-1),origin+'/account?rental=abc#chat');
 const before=opened.length;for(const url of ['/admin#chat','https://evil.example/account#chat','/account?rental=x&rental=y#chat','/account?rental=x&conversation=general#chat','/account?conversation=wrong#chat','/account?secret=1#chat'])await click(url);assert.equal(opened.length,before);
 let push;events.push({data:{json:()=>({url:'/account?rental=abc#chat',body:'Private sensitive body'})},waitUntil:p=>push=p});await push;assert.ok(!shown[0].options.body.includes('Private'));assert.equal(events.fetch,undefined);
 console.log('PASS real renter notification handlers and worker: session/account/device ownership, endpoint restrictions, real owner/system chat queue, dedup, preferences, read suppression, retry/lease fencing, generation changes, expired subscriptions, blocked/expired/logout sessions, safe account links and private lock-screen text. Controlled database/transport; no real push delivery.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const[k,value]of Object.entries(prior))if(value===undefined)delete process.env[k];else process.env[k]=value;});
