const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
const intents=new Map(),events=[];
class StripeFixture {
 paymentIntents={retrieve:async id=>{events.push(['retrieve',id]);if(!intents.has(id))throw Error('Unknown provider fixture');return intents.get(id);},cancel:async id=>{events.push(['cancel',id]);const p=intents.get(id);p.status='canceled';return p;}};
 webhooks={constructEvent:(body,sig)=>{if(sig!=='fixture-signature')throw Error('Invalid signature');return JSON.parse(body);}};
}
setMock('stripe',{default:StripeFixture});setMock('./lib/mailer',{sendMail:async()=>true});
process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.STRIPE_WEBHOOK_SECRET='whsec_fixture';
const bookings=load('convex/bookings.ts'),renew=load('convex/holdRenewal.ts'),checkout=load('convex/checkout.ts'),pickup=load('convex/pickupSecurity.ts'),accounts=load('convex/accounts.ts');
const {PICKUP_HOLD_POLICY,pickupHoldAt}=load('shared/pickupSecurity.ts');
const now=Date.now(),account=put('accounts',{email:'renewal@example.invalid'});
put('sessions',{token:'own-session',accountId:account._id,expiresAt:now+600000});
const other=put('accounts',{email:'foreign@example.invalid'});put('sessions',{token:'foreign-session',accountId:other._id,expiresAt:now+600000});
const b=put('bookings',{accountId:account._id,guestEmail:account.email,status:'confirmed',depositHoldAmount:100,depositHoldStatus:'held',depositHoldExpiresAt:now+3600000,stripeDepositIntentId:'old-hold',depositHoldRenewalIntentId:'new-hold',depositHoldRenewalStatus:'requires_action',rmv2Revision:10,
 securityHoldPolicyVersion:PICKUP_HOLD_POLICY,securityHoldGeneration:1,securityHoldCustomerId:'cus_owned',securityHoldPaymentMethodId:'pm_owned',lineItems:[{start:Date.UTC(2026,10,1),end:Date.UTC(2026,10,2),pickupTime:'12:00'}]});
b.securityHoldDueAt=pickupHoldAt(b);
const old={id:'old-hold',status:'requires_capture',capture_method:'manual',currency:'gbp',amount:10000,amount_capturable:10000,amount_received:0,customer:'cus_owned',payment_method:'pm_owned',metadata:{bookingId:b._id,purpose:'pickup_security_hold',generation:'1'}};
const next={...old,id:'new-hold',status:'requires_action',client_secret:'fixture_private_secret',metadata:{bookingId:b._id,purpose:'security_hold_renewal',replaces:old.id},latest_charge:{payment_method_details:{card:{capture_before:(now+7*86400000)/1000}}}};
intents.set(old.id,old);intents.set(next.id,next);
const modules={bookings,holdRenewal:renew,pickupSecurity:pickup,accounts};
const mutationCtx={db,scheduler:{runAfter:async(delay,ref,args)=>events.push(['queue',ref,args])}};
const ctx={runQuery:async(ref,args)=>{const [m,f]=ref.split('.');return modules[m][f].handler({db},args);},runMutation:async(ref,args)=>{events.push(['mutation',ref,args]);const [m,f]=ref.split('.');return modules[m][f].handler(mutationCtx,args);},runAction:async(ref,args)=>{events.push(['action',ref,args]);const [m,f]=ref.split('.');return modules[m][f].handler(ctx,args);}};
const deliver=(type,intent,sig='fixture-signature')=>checkout.stripeWebhook.handler(ctx,{body:JSON.stringify({type,data:{object:intent}}),sig});
(async()=>{
 assert.equal(await deliver('payment_intent.amount_capturable_updated',next,'invalid'),false);assert.equal(events.length,0);
 await assert.rejects(renew.resume.handler(ctx,{token:'foreign-session',bookingId:b._id}),/access denied/);
 const originalCustomer=next.customer;next.customer='cus_foreign';
 await assert.rejects(renew.resume.handler(ctx,{token:'own-session',bookingId:b._id}),/does not match/);next.customer=originalCustomer;
 assert.equal((await renew.resume.handler(ctx,{token:'own-session',bookingId:b._id})).clientSecret,next.client_secret);
 next.status='requires_capture';await deliver('payment_intent.amount_capturable_updated',next);
 assert.equal(b.stripeDepositIntentId,next.id,'Provider approval completes renewal through the actual webhook route');assert.equal(b.rmv2Revision,11);assert.equal(old.status,'canceled');
 const revision=b.rmv2Revision;await deliver('payment_intent.canceled',old);
 assert.equal(b.depositHoldStatus,'held','The old pickup cancellation must not invalidate the renewed hold');assert.equal(b.rmv2Revision,revision);
 next.status='canceled';await deliver('payment_intent.canceled',{...next,status:'requires_capture'});
 assert.equal(b.depositHoldStatus,'failed','Current provider state overrides stale webhook contents');assert.equal(b.rmv2Revision,revision+1);
 await deliver('payment_intent.canceled',next);assert.equal(b.rmv2Revision,revision+1,'Repeated terminal events do not enqueue duplicate revisions');
 for(const [field,value]of [['customer','cus_foreign'],['payment_method','pm_foreign'],['currency','usd'],['amount',1],['capture_method','automatic']]){
  const before=next[field];next[field]=value;next.status='requires_capture';await deliver('payment_intent.amount_capturable_updated',next);assert.equal(b.depositHoldStatus,'failed');assert.equal(b.rmv2Revision,revision+1);next[field]=before;
 }
 const stateBefore=b.depositHoldStatus;const impostor={...next,id:'unlinked',status:'requires_capture'};intents.set(impostor.id,impostor);await deliver('payment_intent.amount_capturable_updated',impostor);assert.equal(b.depositHoldStatus,stateBefore);assert(!events.some(e=>e[0]==='cancel'&&e[1]===impostor.id));
 next.status='requires_capture';await deliver('payment_intent.canceled',next);assert.equal(b.depositHoldStatus,'held','A delayed canceled event cannot undo the provider-current live hold');
 next.status='succeeded';next.amount_received=10000;await deliver('payment_intent.amount_capturable_updated',next);assert.equal(b.depositHoldStatus,'captured','A bank-confirmed captured amount cannot be presented as an authorisation');
 next.status='requires_capture';next.amount_received=0;const capturedRevision=b.rmv2Revision;await deliver('payment_intent.amount_capturable_updated',next);assert.equal(b.depositHoldStatus,'captured');assert.equal(b.rmv2Revision,capturedRevision,'An obsolete provider response cannot reopen a settled hold');
 const renewedRevision=b.rmv2Revision;b.status='returned';next.status='canceled';await deliver('payment_intent.canceled',next);assert.equal(b.rmv2Revision,renewedRevision,'Ended rentals remain untouched');b.status='confirmed';
 b.depositHoldRenewalIntentId=next.id;b.depositHoldRenewalStatus='requires_action';next.status='requires_action';b.cancellationDecision={mode:'refund'};
 await assert.rejects(renew.resume.handler(ctx,{token:'own-session',bookingId:b._id}),/access denied/);
 await deliver('payment_intent.amount_capturable_updated',next);assert.equal(b.rmv2Revision,renewedRevision);b.cancellationDecision=undefined;
 b.stripeDepositIntentId='another-current';assert.equal(await bookings.reconcileRenewedHold.handler(mutationCtx,{bookingId:b._id,intentId:next.id,status:'failed'}),false,'A race cannot update a superseded intent');
 console.log('PASS actual renewal webhook/account/provider handlers: bank approval, superseded pickup cancellation, latest-state replay, private challenge ownership, customer/card/currency/amount/manual guards, duplicate updates, ended rentals and changed-current-intent races. Controlled provider responses; no real funds or mail.');
})().catch(e=>{console.error(e);process.exitCode=1});
