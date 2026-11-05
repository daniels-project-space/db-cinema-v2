const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
let outcome='requires_capture',expired=false,failRelease=false,events=[],mails=[];
const originals=new Map(),created=new Map();
class StripeFixture {
 paymentIntents={
  retrieve:async id=>id.startsWith('old')?{id,status:'requires_capture',customer:'cus_test',payment_method:'pm_test',metadata:{bookingId:originals.get(id)}}:{...created.get(id),id,status:outcome,amount_capturable:created.get(id).amount,amount_received:0,latest_charge:{payment_method_details:{card:{capture_before:Date.now()/1000+(expired?-1:7*86400)}}}},
  create:async(args,opts)=>{events.push(['create',args,opts]);const id='new-'+args.metadata.bookingId;created.set(id,args);return {id};},
  cancel:async id=>{events.push(['cancel',id]);if(failRelease&&id.startsWith('old'))throw Error('Isolated old-hold release failure');return {id,status:'canceled'};}
 };
}
setMock('stripe',{default:StripeFixture});setMock('./lib/mailer',{sendMail:async mail=>{mails.push(mail);return true;}});process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.APP_URL='https://example.invalid';
const renew=load('convex/holdRenewal.ts'),bookings=load('convex/bookings.ts');
const mutationCtx={db,scheduler:{runAfter:async(delay,ref,args)=>events.push(['scheduled',ref,args])}};
const ctx={db,runQuery:(ref,args)=>bookings[ref.split('.')[1]].handler({db},args),runMutation:async(ref,args)=>{events.push([ref,args]);return bookings[ref.split('.')[1]].handler(mutationCtx,args);},runAction:async(ref,args)=>renew[ref.split('.')[1]].handler(ctx,args)};
const make=(amount=250,status='confirmed',hours=2)=>{const b=put('bookings',{status,depositHoldAmount:amount,stripeDepositIntentId:'old-'+Math.random(),depositHoldStatus:'held',depositHoldExpiresAt:Date.now()+hours*3600000,lineItems:[]});originals.set(b.stripeDepositIntentId,b._id);return b;};
(async()=>{
 let b=make();await renew.renewOne.handler(ctx,{bookingId:b._id});let create=events.find(x=>x[0]==='create');assert.equal(create[1].amount,25000);assert.equal(create[1].currency,'gbp');assert.equal(create[1].capture_method,'manual');assert.equal(create[1].off_session,true);assert.match(create[2].idempotencyKey,/dbc-hold-renew/);assert.equal(b.stripeDepositIntentId,'new-'+b._id);assert(events.findIndex(x=>x[0]==='bookings.replaceHold')<events.findIndex(x=>x[0]==='cancel'),'Old hold is released only after replacement is recorded');
 assert.equal(b.rmv2Revision,1,'A replacement commits a new manager revision');
 assert.equal(b.rmv2SyncStatus,'pending');
 assert.equal(events.filter(x=>x[0]==='scheduled'&&x[1]==='rmv2_webhook.push').length,1);
 assert(events.findIndex(x=>x[0]==='scheduled')<events.findIndex(x=>x[0]==='cancel'),'Manager delivery is queued before old hold release');
 const prior=events.find(x=>x[0]==='bookings.replaceHold')[1];
 assert.equal(await bookings.replaceHold.handler(mutationCtx,prior),false,'Duplicate replacement cannot advance the revision again');
 assert.equal(b.rmv2Revision,1);
 assert.equal(events.filter(x=>x[0]==='scheduled').length,1);
 events=[];failRelease=true;b=make();
 const originalError=console.error;try{console.error=()=>{};await renew.renewOne.handler(ctx,{bookingId:b._id});}finally{console.error=originalError;failRelease=false;}
 assert.equal(b.rmv2Revision,1,'New authorisation remains queued if old-hold cleanup fails');
 assert.equal(b.depositHoldPreviousIntentIds.length,1,'Failed old-hold release remains recorded for recovery');
 events=[];await renew.renewOne.handler(ctx,{bookingId:b._id});
 assert.equal(b.depositHoldPreviousIntentIds.length,0);assert.equal(b.rmv2Revision,1);
 assert(!events.some(x=>x[0]==='create'||x[0]==='scheduled'),'Cleanup retry neither creates another authorisation nor repeats manager delivery');
 events=[];b=make(125);await renew.renewOne.handler(ctx,{bookingId:b._id});assert.equal(events.find(x=>x[0]==='create')[1].amount,12500,'Renewal preserves an older booking’s agreed amount');
 for(const status of ['returned','cancelled']){events=[];b=make(250,status);await renew.renewOne.handler(ctx,{bookingId:b._id});assert(!events.some(x=>x[0]==='create'));}
 events=[];b=make(250,'confirmed',25);await renew.renewOne.handler(ctx,{bookingId:b._id});assert(!events.some(x=>x[0]==='create'),'No renewal outside the 24-hour window');
 events=[];outcome='requires_action';b=make();const old=b.stripeDepositIntentId;await renew.renewOne.handler(ctx,{bookingId:b._id});assert.equal(b.stripeDepositIntentId,old);assert.equal(b.depositHoldRenewalStatus,'requires_action');assert(!events.some(x=>x[0]==='cancel'),'Authentication never releases the existing hold');
 events=[];outcome='requires_capture';expired=true;b=make();const before=b.stripeDepositIntentId;await renew.renewOne.handler(ctx,{bookingId:b._id});assert.equal(b.stripeDepositIntentId,before);assert.equal(b.depositHoldRenewalStatus,'failed');assert.deepEqual(events.filter(x=>x[0]==='cancel').map(x=>x[1]),['new-'+b._id]);
 events=[];mails=[];expired=false;outcome='requires_capture';const pickupAt=Date.now()+4*3600000;b=make();b.guestEmail='renter@example.invalid';b.securityHoldPolicyVersion='2026-11-checkout-hold-v1';b.securityHoldPickupAt=pickupAt;
 await renew.renewPickup.handler(ctx,{bookingId:b._id,pickupAt});
 const pickupRenewal=events.find(x=>x[0]==='create');assert(pickupRenewal,'Scheduled pickup refresh renews a still-valid hold');assert.equal(pickupRenewal[1].metadata.pickupAt,String(pickupAt),'Refresh is bound to the agreed pickup timestamp');assert.equal(b.securityHoldPickupRenewedForAt,pickupAt,'Successful replacement records the single pickup refresh');assert.equal(b.stripeDepositIntentId,'new-'+b._id);assert(events.findIndex(x=>x[0]==='bookings.replaceHold')<events.findIndex(x=>x[0]==='cancel'),'Pickup refresh keeps the old hold until replacement is recorded');assert.match(mails[0].subject,/renewed before pickup/i);assert.match(mails[0].html,/not a payment/i);assert.match(mails[0].html,/no extra rental charge/i);
 const pickupRenewCreates=events.filter(x=>x[0]==='create').length;await renew.renewPickup.handler(ctx,{bookingId:b._id,pickupAt});assert.equal(events.filter(x=>x[0]==='create').length,pickupRenewCreates,'A pickup refresh cannot be repeated for the same pickup');
 events=[];mails=[];outcome='requires_action';b=make();b.guestEmail='renter@example.invalid';b.securityHoldPolicyVersion='2026-11-checkout-hold-v1';b.securityHoldPickupAt=pickupAt;const protectedOld=b.stripeDepositIntentId;await renew.renewPickup.handler(ctx,{bookingId:b._id,pickupAt});assert.equal(b.stripeDepositIntentId,protectedOld,'Authentication preserves the prior authorization');assert.equal(b.depositHoldRenewalStatus,'requires_action');assert(!events.some(x=>x[0]==='cancel'),'Pickup authentication never releases the prior hold');assert.match(mails[0].html,/approve/i);assert.match(mails[0].html,/not a new payment/i);
 console.log('PASS hold renewal: saved 10% and historical amounts, 24-hour eligibility, manual/off-session/idempotent request, manager revision before release, duplicate receipt denial, failed cleanup recovery, ended rentals, authentication and expired replacements, one-time five-hour pickup refresh and renter notices. Controlled provider fixture; no real card requests.');
})().catch(e=>{console.error(e);process.exitCode=1;});
