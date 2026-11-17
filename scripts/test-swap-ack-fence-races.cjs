const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
const messages=[],alerts=[],emails=[];
setMock('./lib/rentalChat',{postRentalMessage:async(_ctx,args)=>messages.push(args)});
setMock('./lib/adminPush',{queueOwnerNotification:async(_ctx,args)=>alerts.push(args)});
const delivery=load('convex/rmv2Delivery.ts'),webhook=load('convex/rmv2_webhook.ts'),ctx={db,scheduler:{runAfter:async(_delay,ref,args)=>emails.push({ref,args})}};
function scenario(kind){
 const account=put('accounts',{email:`${kind}@example.invalid`}),other=put('accounts',{email:`other-${kind}@example.invalid`});
 const booking=put('bookings',{accountId:kind==='owner-changed'?other._id:account._id,status:'confirmed',idVerifyStatus:'verified',idVerifiedAt:Date.now(),rmv2Revision:4,rmv2SyncStatus:'pending',rmv2SyncLeaseGeneration:1,rmv2SyncLeaseUntil:Date.now()+60000});
 const changes=kind==='remove-first'?[{action:'remove',oldLine:{qty:1,title:'Camera'},newLine:null},{action:'replace',oldLine:{qty:2,title:'Prime lens'},newLine:{qty:2,title:'Zoom lens'}}]:undefined;
 const swap=put('rental_item_swaps',{bookingId:booking._id,accountId:account._id,status:'applied',oldLine:changes?.[0].oldLine??{qty:1,title:'Camera'},newLine:changes?.[0].newLine??{qty:1,title:'Lens'},...(changes?{changes}:{})});
 booking.activeItemSwapId=swap._id;
 const receipt=put('swap_stock_applied_receipts',{swapId:swap._id,bookingId:booking._id,bookingRevision:4,managerRequestId:`claim-${kind}`,fingerprint:'fingerprint',executionKey:'execution',deliveryState:'pending',stockRisk:kind==='stock-risk'});
 return {booking,swap,receipt,ack:{swapId:swap._id,bookingRevision:4,managerRequestId:receipt.managerRequestId,fingerprint:'fingerprint',executionKey:'execution'}};
}
(async()=>{
 for(const kind of ['owner-changed','stock-risk','clear','remove-first']){
  const {booking,swap,receipt,ack}=scenario(kind),beforeMessages=messages.length,beforeEmails=emails.length;
  await delivery.record.handler(ctx,{bookingId:booking._id,revision:4,generation:1,ok:true,stockAcknowledgement:ack});
  assert.equal(receipt.deliveryState,'acknowledged');assert.equal(booking.rmv2SyncStatus,'delivered');
  if(kind==='clear'||kind==='remove-first'){
   assert.equal(booking.activeItemSwapId,undefined);assert.equal(messages.length,beforeMessages+1);assert.equal(emails.length,beforeEmails+1);
   if(kind==='remove-first'){
    assert.match(messages.at(-1).text,/1 × Camera → removed/);
    assert.match(messages.at(-1).text,/2 × Prime lens → 2 × Zoom lens/);
    assert.match(emails.at(-1).args.detail,/1 × Camera → removed/);
    assert.match(emails.at(-1).args.detail,/2 × Prime lens → 2 × Zoom lens/);
    await delivery.record.handler(ctx,{bookingId:booking._id,revision:4,generation:1,ok:true,stockAcknowledgement:ack});
    assert.equal(messages.length,beforeMessages+1,'replayed acknowledgement does not duplicate renter confirmation');
    assert.equal(emails.length,beforeEmails+1,'replayed acknowledgement does not duplicate confirmation email');
   }
  }else{assert.equal(booking.activeItemSwapId,swap._id,`${kind} must preserve the handover fence`);assert.equal(messages.length,beforeMessages);assert.equal(emails.length,beforeEmails);assert.ok(alerts.some(alert=>alert.eventKey===`swap-acknowledgement-review:${swap._id}`));}
 }
 const account=put('accounts',{email:'rmv2-recovery@example.invalid'}),booking=put('bookings',{accountId:account._id,status:'confirmed',idVerifyStatus:'verified',idVerifiedAt:Date.now(),rmv2Revision:1,rmv2SyncStatus:'pending',rmv2SyncDueAt:0}),swap=put('rental_item_swaps',{bookingId:booking._id,accountId:account._id,status:'applied',oldLine:{qty:1,title:'Camera'},newLine:{qty:1,title:'Lens'}});booking.activeItemSwapId=swap._id;
 const receipt=put('swap_stock_applied_receipts',{swapId:swap._id,bookingId:booking._id,bookingRevision:1,managerRequestId:'claim-recovery',fingerprint:'recovery-fingerprint',executionKey:'recovery-execution',deliveryState:'pending',stockRisk:false,appliedAt:Date.now(),windows:[]});
 const stockApplicationReceipt={swapId:String(swap._id),bookingId:String(booking._id),bookingRevision:1,managerRequestId:receipt.managerRequestId,fingerprint:receipt.fingerprint,executionKey:receipt.executionKey,appliedAt:receipt.appliedAt,windows:[]};
 const payload={id:booking._id,revision:1,status:'confirmed',verification:{status:'verified'},stockApplicationReceipt};let transmitted=0;
 const oldFetch=global.fetch,oldOutbound=process.env.RMV2_OUTBOUND_ENABLED,oldUrl=process.env.RMV2_WEBHOOK_URL,oldSecret=process.env.RMV2_WEBHOOK_SECRET;
 process.env.RMV2_OUTBOUND_ENABLED='false';process.env.RMV2_WEBHOOK_URL='https://manager.example.invalid/dbcinema/booking-sync';process.env.RMV2_WEBHOOK_SECRET='synthetic-rmv2-secret';
 const webhookCtx={runQuery:async()=>payload,runMutation:async(ref,args)=>ref==='rmv2Delivery.claim'?delivery.claim.handler(ctx,args):delivery.record.handler(ctx,args)};
 try{
  global.fetch=async()=>{transmitted++;return {ok:true,json:async()=>({ok:true,version:1,bookingId:booking._id,receivedRevision:1,appliedRevision:1,outcome:'applied',stockAcknowledgement:{managerRequestId:receipt.managerRequestId,fingerprint:receipt.fingerprint,executionKey:receipt.executionKey,bookingRevision:1}})}};
  assert.deepEqual(await webhook.push.handler(webhookCtx,{bookingId:booking._id}),{ok:false,reason:'delivery_disabled'});
  assert.equal(transmitted,0,'disabled outbound sync does not call the manager');assert.equal(booking.rmv2SyncStatus,'pending','the settled booking remains queued while outbound sync is paused');assert.equal(booking.rmv2SyncLeaseGeneration,undefined,'the disabled path does not consume a delivery lease');assert.equal(receipt.deliveryState,'pending','the stock acknowledgement receipt remains recoverable');
  process.env.RMV2_OUTBOUND_ENABLED='true';
  assert.deepEqual(await webhook.push.handler(webhookCtx,{bookingId:booking._id}),{ok:true});
  assert.equal(transmitted,1,'the same queued revision is delivered after outbound sync is re-enabled');assert.equal(receipt.deliveryState,'acknowledged','the saved stock receipt is acknowledged after recovery');assert.equal(booking.rmv2SyncStatus,'delivered');assert.equal(booking.activeItemSwapId,undefined,'the renter lock clears only after the recovered acknowledgement');
 }finally{global.fetch=oldFetch;oldOutbound===undefined?delete process.env.RMV2_OUTBOUND_ENABLED:process.env.RMV2_OUTBOUND_ENABLED=oldOutbound;oldUrl===undefined?delete process.env.RMV2_WEBHOOK_URL:process.env.RMV2_WEBHOOK_URL=oldUrl;oldSecret===undefined?delete process.env.RMV2_WEBHOOK_SECRET:process.env.RMV2_WEBHOOK_SECRET=oldSecret;}
 console.log('PASS RMV2 acknowledgement fences and outbound pause/re-enable receipt recovery; synthetic data and controlled transport only.');
})().catch(error=>{console.error(error);process.exitCode=1});
