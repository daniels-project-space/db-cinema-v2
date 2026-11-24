const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const {load,db,put,tables,setMock}=require('./lib/rentalTestHarness.cjs');
let failure=0;const sent=[];
setMock('web-push',{default:{sendNotification:async(s,payload)=>{if(failure)throw Object.assign(Error('private endpoint/body must never appear in error'),{statusCode:failure});sent.push({endpoint:s.endpoint,payload:JSON.parse(payload)});}}});
const notifications=load('convex/renterNotifications.ts'),delivery=load('convex/renterPushDelivery.ts'),accounts=load('convex/accounts.ts');
const {postRentalMessage}=load('convex/lib/rentalChat.ts'),{queueRenterNotification,renterPushKeys,renterPushNotice}=load('convex/lib/renterPush.ts');
const prior=Object.fromEntries(['RENTER_PUSH_PUBLIC_KEY','RENTER_PUSH_PRIVATE_KEY','ADMIN_PUSH_PUBLIC_KEY','ADMIN_PUSH_PRIVATE_KEY'].map(k=>[k,process.env[k]]));
process.env.RENTER_PUSH_PUBLIC_KEY='fixture-public';process.env.RENTER_PUSH_PRIVATE_KEY='fixture-private';
const scheduled=[];let serial=Promise.resolve();const ctx={db,scheduler:{runAfter:async(...a)=>scheduled.push(a)},runMutation:(ref,a)=>{const operation=serial.then(()=>notifications[ref.split('.')[1]].handler(ctx,a));serial=operation.catch(()=>{});return operation;},runQuery:(ref,a)=>notifications[ref.split('.')[1]].handler(ctx,a)};
const a=put('accounts',{email:'a@fixture.invalid'}),b=put('accounts',{email:'b@fixture.invalid'});
const session=put('sessions',{accountId:a._id,token:'a-token',expiresAt:Date.now()+3600000});put('sessions',{accountId:b._id,token:'b-token',expiresAt:Date.now()+3600000});
const rental=put('bookings',{accountId:a._id,guestEmail:a.email,status:'confirmed'});
const subscription={deviceId:'fixture-device',endpoint:'https://fcm.googleapis.com/fcm/send/fixture',p256dh:crypto.randomBytes(65).toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')};
async function message(sender='owner',bookingId=rental._id,meta){await postRentalMessage(ctx,{accountId:a._id,bookingId,sender,text:'Private customer document and charge details',meta});return tables.get('renter_push_deliveries')?.at(-1);}
async function enable(){await notifications.subscribe.handler(ctx,{token:'a-token',...subscription});}
(async()=>{
 const manifest=JSON.parse(fs.readFileSync('public/account.webmanifest','utf8'));assert.equal(manifest.start_url,'/account#chat');assert.equal(manifest.scope,'/account');
 await assert.rejects(notifications.device.handler(ctx,{token:'bad',deviceId:subscription.deviceId}));
 await assert.rejects(notifications.subscribe.handler(ctx,{token:'a-token',...subscription,endpoint:'https://localhost/private'}));
 await enable();await enable();assert.equal(tables.get('renter_push_subscriptions').length,1);
 assert.equal((await notifications.device.handler(ctx,{token:'b-token',deviceId:subscription.deviceId})).enabled,false);
 await assert.rejects(notifications.subscribe.handler(ctx,{token:'b-token',...subscription}),/previous account/);
 await notifications.disable.handler(ctx,{token:'b-token',deviceId:subscription.deviceId});assert.equal(tables.get('renter_push_subscriptions')[0].enabled,true);
 await assert.rejects(notifications.preferences.handler(ctx,{token:'b-token',deviceId:subscription.deviceId,messagesEnabled:false,bookingEnabled:false}));
 const first=await message();await Promise.all([delivery.deliver.handler(ctx,{deliveryId:first._id}),delivery.deliver.handler(ctx,{deliveryId:first._id})]);assert.equal(sent.length,1);assert.equal(first.status,'sent');assert.equal(sent[0].payload.url,`/account?rental=${rental._id}#chat`);assert.match(sent[0].payload.tag,/^dbc-renter-[A-Za-z0-9_-]{32}$/);assert.ok(!sent[0].payload.tag.includes(String(rental._id)));assert.ok(!JSON.stringify(sent[0]).includes('Private customer'));
 assert.equal(renterPushNotice('owner',rental._id), 'chat_message');
 assert.equal(renterPushNotice('system',undefined), 'support_reply');
 assert.equal(renterPushNotice('system',rental._id,{kind:'verification_update',status:'verified'}), 'verification_approved');
 assert.equal(renterPushNotice('system',rental._id,{kind:'verification_update',status:'manual_review'}), 'verification_review');
 assert.equal(renterPushNotice('system',rental._id,{kind:'verification_update',status:'requires_input'}), 'verification_action');
 assert.equal(renterPushNotice('system',rental._id,{kind:'delivery_quote'}), 'delivery_quote');
 assert.equal(renterPushNotice('system',rental._id,{kind:'extension_payment'}), 'extension_payment');
 assert.equal(renterPushNotice('system',rental._id,{kind:'rental_item_swap'}), 'kit_change');
 assert.equal(renterPushNotice('system',rental._id,{type:'rental_item_swap'}), 'kit_change');
 assert.equal(renterPushNotice('system',rental._id,{kind:'rental_price_proposal'}), 'rental_price');
 assert.equal(renterPushNotice('system',rental._id,{type:'rental_price_proposal'}), 'rental_price');
 assert.equal(renterPushNotice('system',rental._id,{kind:'full_credit_offer'}), 'credit_offer');
 assert.equal(renterPushNotice('system',rental._id,{kind:'paylink'}), 'payment_link');
 assert.equal(renterPushNotice('system',rental._id,{type:'rental_change_decision'}), 'rental_update','Completed/declined request decisions do not falsely claim renter action is needed');
 assert.equal(renterPushNotice('system',rental._id,{kind:'delivery_paid'}), 'rental_update');
 assert.equal(renterPushNotice('system',rental._id,{kind:'review_invitation'}), 'review_invitation');
 const catalogueItems=[{slug:'sony-fx3',title:'Sony FX3'}];
 const actionCardMetas=[
  {extensionOffer:{items:[{title:'Sony FX3'}]}},
  {kind:'checkout_cart',path:`/cart/quote/${'a'.repeat(43)}`,items:[{title:'Sony FX3'}]},
  {catalogueItems},
 ];
 assert.equal(renterPushNotice('bot',rental._id,actionCardMetas[0]),'extension_options','Gaffer extension cards identify extension choices');
 assert.equal(renterPushNotice('bot',rental._id,actionCardMetas[1]),'checkout_kit','Gaffer checkout cards identify the kit ready to review');
 assert.equal(renterPushNotice('bot',rental._id,actionCardMetas[2]),'gear_recommendation','Gaffer catalogue cards identify gear suggestions');
 assert.equal(renterPushNotice('bot',rental._id,{extensionOffer:{items:[]}}),'chat_message','non-renderable card metadata keeps generic chat copy');
 const verified=await message('system',rental._id,{kind:'verification_update',status:'verified'});assert.equal(tables.get('renter_notifications').at(-1).notice,'verification_approved');await delivery.deliver.handler(ctx,{deliveryId:verified._id});assert.equal(sent.at(-1).payload.notice,'verification_approved');assert.equal(sent.at(-1).payload.tag,sent[0].payload.tag,'Every notice for the same rental replaces its prior lock-screen alert');
 const n=tables.get('renter_notifications')[0],dedupCount=tables.get('renter_push_deliveries').length;await queueRenterNotification(ctx,{eventKey:n.eventKey,kind:n.kind,accountId:n.accountId,bookingId:n.bookingId,messageAt:n.messageAt});assert.equal(tables.get('renter_push_deliveries').length,dedupCount);
 await notifications.preferences.handler(ctx,{token:'a-token',deviceId:subscription.deviceId,messagesEnabled:false,bookingEnabled:true});const count=tables.get('renter_push_deliveries').length;await message();assert.equal(tables.get('renter_push_deliveries').length,count);
 const update=await message('system');assert.equal(tables.get('renter_notifications').at(-1).kind,'booking');assert.equal(tables.get('renter_notifications').at(-1).notice,'rental_update');await delivery.deliver.handler(ctx,{deliveryId:update._id});assert.equal(update.status,'sent');assert.equal(sent.at(-1).payload.notice,'rental_update');
 await notifications.preferences.handler(ctx,{token:'a-token',deviceId:subscription.deviceId,messagesEnabled:true,bookingEnabled:true});
 const bot=await message('bot');assert.equal(tables.get('renter_notifications').at(-1).kind,'messages');assert.equal(tables.get('renter_notifications').at(-1).notice,'chat_message');await delivery.deliver.handler(ctx,{deliveryId:bot._id});assert.equal(bot.status,'sent');assert.equal(sent.at(-1).payload.notice,'chat_message');assert.ok(!JSON.stringify(sent.at(-1)).includes('Private customer'));
 const botAction=await message('bot',rental._id,actionCardMetas[0]);assert.equal(tables.get('renter_notifications').at(-1).notice,'extension_options');await delivery.deliver.handler(ctx,{deliveryId:botAction._id});assert.equal(botAction.status,'sent');assert.equal(sent.at(-1).payload.notice,'extension_options');assert.equal(sent.at(-1).payload.tag,sent[0].payload.tag);assert.ok(!JSON.stringify(sent.at(-1)).includes('Sony FX3'));
 const read=await message();const thread=tables.get('chat_threads').find(t=>t.bookingId===rental._id);await db.patch(thread._id,{renterReadAt:tables.get('renter_notifications').at(-1).messageAt});await delivery.deliver.handler(ctx,{deliveryId:read._id});assert.equal(read.status,'skipped');
 const retry=await message();failure=503;await delivery.deliver.handler(ctx,{deliveryId:retry._id});assert.equal(retry.status,'retry');assert.equal(retry.lastError,'Push delivery failed (503)');const stale=retry.claimId;await db.patch(retry._id,{nextAttemptAt:0});failure=0;await delivery.deliver.handler(ctx,{deliveryId:retry._id});assert.equal(retry.status,'sent');await notifications.finish.handler(ctx,{deliveryId:retry._id,claimId:stale,sent:false,expired:true});assert.equal(retry.status,'sent');
 const renewed=await message();await enable();await delivery.deliver.handler(ctx,{deliveryId:renewed._id});assert.equal(renewed.status,'skipped','subscription generation change invalidates old queued work');
 const disabled=await message();await notifications.disable.handler(ctx,{token:'a-token',deviceId:subscription.deviceId});await delivery.deliver.handler(ctx,{deliveryId:disabled._id});assert.equal(disabled.status,'skipped');await enable();
 const expired=await message();failure=410;await delivery.deliver.handler(ctx,{deliveryId:expired._id});assert.equal(expired.status,'permanent_failure');assert.equal((await notifications.device.handler(ctx,{token:'a-token',deviceId:subscription.deviceId})).enabled,false);failure=0;await enable();
 const recovered=await message();await notifications.claim.handler(ctx,{deliveryId:recovered._id,claimId:'lost-worker'});assert.equal(await notifications.claim.handler(ctx,{deliveryId:recovered._id,claimId:'too-soon'}),null);await db.patch(recovered._id,{claimedAt:0,nextAttemptAt:0});await delivery.deliver.handler(ctx,{deliveryId:recovered._id});assert.equal(recovered.status,'sent');
 const general=await message('owner',undefined); // default argument selects rental; invoke general explicitly below.
 await postRentalMessage(ctx,{accountId:a._id,sender:'owner',text:'General private support'});const generalDelivery=tables.get('renter_push_deliveries').at(-1);await delivery.deliver.handler(ctx,{deliveryId:generalDelivery._id});assert.equal(sent.at(-1).payload.url,'/account?conversation=general#chat');assert.equal(sent.at(-1).payload.notice,'support_reply');assert.notEqual(sent.at(-1).payload.tag,sent[0].payload.tag,'General support alerts use a separate replaceable notice from a rental');
 const blocked=await message();await db.patch(a._id,{blockedAt:Date.now()});await delivery.deliver.handler(ctx,{deliveryId:blocked._id});assert.equal(blocked.status,'skipped');await db.patch(a._id,{blockedAt:undefined});
 const oldSession=await message();await db.patch(session._id,{expiresAt:0});await delivery.deliver.handler(ctx,{deliveryId:oldSession._id});assert.equal(oldSession.status,'skipped');await db.patch(session._id,{expiresAt:Date.now()+3600000});
 const logout=await message();await accounts.signOut.handler(ctx,{token:'a-token'});await delivery.deliver.handler(ctx,{deliveryId:logout._id});assert.equal(logout.status,'skipped');assert.equal(tables.get('renter_push_subscriptions')[0].enabled,false);
 await notifications.subscribe.handler(ctx,{token:'b-token',...subscription});assert.equal(tables.get('renter_push_subscriptions')[0].accountId,b._id);await delivery.deliver.handler(ctx,{deliveryId:general._id});assert.equal(general.status,'skipped');
 delete process.env.RENTER_PUSH_PRIVATE_KEY;process.env.ADMIN_PUSH_PRIVATE_KEY='different-pair';assert.equal(renterPushKeys().privateKey,undefined,'never mix one renter key with an unrelated admin key');
 const events={},shown=[],opened=[];let windows=[];const origin='https://dbcinemarentals.com';
 vm.runInNewContext(fs.readFileSync('public/renter-notifications-sw.js','utf8'),{URL,self:{location:{origin},addEventListener:(name,fn)=>events[name]=fn,registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>windows,openWindow:async url=>opened.push(url)}}});
 async function click(url){let pending;events.notificationclick({notification:{data:{url},close(){}},waitUntil:p=>pending=p});if(pending)await pending;}
 const warmAccount={url:origin+'/account#chat',navigations:[],focuses:0,navigate:async target=>{warmAccount.navigations.push(target);return warmAccount;},focus:async()=>{warmAccount.focuses++;return warmAccount;}};
 windows=[warmAccount];await click(`/account?rental=${rental._id}#chat`);assert.deepEqual(warmAccount.navigations,[origin+`/account?rental=${rental._id}#chat`],'A notification opens its exact rental in an already-open account');assert.equal(warmAccount.focuses,1,'The selected account window is focused after navigation');assert.equal(opened.length,0,'A warm account does not create a duplicate tab');
 warmAccount.navigations.length=0;warmAccount.focuses=0;await click('/account?conversation=general#chat');assert.deepEqual(warmAccount.navigations,[origin+'/account?conversation=general#chat'],'A support notification opens the exact general conversation in the existing account');assert.equal(warmAccount.focuses,1);
 windows=[];
 await click('/account?conversation=general#chat');assert.equal(opened.at(-1),origin+'/account?conversation=general#chat');
 const shopper={url:origin+'/gear',navigate:()=>{throw Error('Shopper must never be navigated')}};windows=[shopper];await click('/account?rental=abc#chat');assert.equal(opened.at(-1),origin+'/account?rental=abc#chat');
 const before=opened.length;for(const url of ['/admin#chat','https://evil.example/account#chat','/account?rental=x&rental=y#chat','/account?rental=x&conversation=general#chat','/account?conversation=wrong#chat','/account?secret=1#chat'])await click(url);assert.equal(opened.length,before);
 let push;events.push({data:{json:()=>({url:'/account?rental=abc#chat',notice:'verification_approved',title:'Injected title',body:'Private sensitive body',tag:'booking-replacement-tag'})},waitUntil:p=>push=p});await push;assert.equal(shown[0].title,'Verification passed');assert.equal(shown[0].options.body,'Check your booking status.');assert.equal(shown[0].options.tag,'booking-replacement-tag');assert.ok(!JSON.stringify(shown[0].title+shown[0].options.body).match(/Private|Injected|confirmed|document|payment|pickup/i),'Verification success must not be presented as booking confirmation or expose private details.');assert.equal(events.fetch,undefined);
 for(const [notice,title,body] of [
  ['chat_message','New rental reply','Open your rental chat.'],
  ['support_reply','Support replied','Open your support chat.'],
  ['verification_progress','Verification update','Check your account.'],
  ['verification_review','Team review','We’ll update your rental chat.'],
  ['verification_action','Verification action needed','Continue in your account.'],
  ['rental_action','Rental action','Review your rental chat.'],
  ['rental_update','Rental update','Check your account.'],
  ['delivery_quote','Delivery quote ready','Review it in your rental chat.'],
  ['extension_options','Extension options','Review available items in your rental chat.'],
  ['extension_payment','Extension approved','Pay in your rental chat to confirm.'],
  ['kit_change','Kit change update','Review the items in your rental chat.'],
  ['rental_price','Rental price proposal','Review and accept in your rental chat.'],
  ['credit_offer','Credit offer ready','Review it in your rental chat.'],
  ['payment_link','Rental link ready','Open your rental chat to continue.'],
  ['gear_recommendation','Gear suggestions','See Gaffer’s picks in your rental chat.'],
  ['checkout_kit','Kit ready to review','Open the checkout link in your rental chat.'],
  ['review_invitation','Review your rental','Share feedback in your rental chat.'],
 ]){let pending;events.push({data:{json:()=>({url:'/account?rental=abc#chat',notice,title:'Injected title',body:'Private pickup and payment details'})},waitUntil:p=>pending=p});await pending;assert.equal(shown.at(-1).title,title,`${notice} title`);assert.equal(shown.at(-1).options.body,body,`${notice} body`);assert.ok(!JSON.stringify(shown.at(-1).title+shown.at(-1).options.body).match(/Injected|Private|pickup|payment|document/i),`${notice} exposes no private details`);}
 let fallback;events.push({data:{json:()=>({url:'/account?rental=abc#chat',notice:'unknown',body:'Private sensitive body'})},waitUntil:p=>fallback=p});await fallback;assert.equal(shown.at(-1).title,'Rental update');assert.equal(shown.at(-1).options.body,'Check your account.');
 console.log('PASS real renter notification handlers and worker: session/account/device ownership, endpoint restrictions, real owner/system chat queue, dedup, preferences, read suppression, retry/lease fencing, generation changes, expired subscriptions, blocked/expired/logout sessions, safe account links and private lock-screen text. Controlled database/transport; no real push delivery.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{for(const[k,value]of Object.entries(prior))if(value===undefined)delete process.env[k];else process.env[k]=value;});
