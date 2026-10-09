const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
const intents=new Map(),sessions=new Map(),events=[];let cancelFailure=false;
class StripeFixture {
 paymentIntents={retrieve:async id=>intents.get(id),cancel:async id=>{events.push(['cancel',id]);if(cancelFailure)throw Error('Controlled release failure');intents.get(id).status='canceled';return intents.get(id);}};
 paymentMethodConfigurations={retrieve:async()=>({active:true,card:{display_preference:{value:'on'}},apple_pay:{display_preference:{value:'off'}},google_pay:{display_preference:{value:'off'}},link:{display_preference:{value:'off'}}})};
 checkout={sessions:{create:async args=>{events.push(['setup',args]);const s={id:'cs_recovery_fixture',url:'https://checkout.example.invalid/card',...args};sessions.set(s.id,s);return s;}}};
}
setMock('stripe',{default:StripeFixture});setMock('./lib/mailer',{sendMail:async()=>true});
process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.STRIPE_RENTAL_PAYMENT_METHOD_CONFIGURATION_ID='pmc_fixture';process.env.APP_URL='https://rental.example.invalid';
const bookings=load('convex/bookings.ts'),holds=load('convex/holdRenewal.ts'),pickup=load('convex/pickupSecurity.ts'),accounts=load('convex/accounts.ts');
const {PICKUP_HOLD_POLICY,pickupHoldAt}=load('shared/pickupSecurity.ts');
const now=Date.now(),account=put('accounts',{email:'original@example.invalid'}),other=put('accounts',{email:'other@example.invalid'});
put('sessions',{token:'owner',accountId:account._id,expiresAt:now+86400000});put('sessions',{token:'foreign',accountId:other._id,expiresAt:now+86400000});
const start=Math.floor(now/86400000)*86400000;
const b=put('bookings',{accountId:account._id,guestEmail:account.email,status:'confirmed',depositHoldStatus:'failed',depositHoldAmount:100,stripeDepositIntentId:'pi_renewal',securityHoldPolicyVersion:PICKUP_HOLD_POLICY,securityHoldGeneration:1,securityHoldCustomerId:'cus_owner',securityHoldPaymentMethodId:'pm_old',lineItems:[{start,end:start+86400000,pickupTime:'00:00'}]});b.securityHoldDueAt=pickupHoldAt(b);
const old={id:'pi_original',status:'canceled',amount:10000,amount_received:0,currency:'gbp',capture_method:'manual',customer:'cus_owner',payment_method:'pm_old',metadata:{bookingId:b._id,purpose:'pickup_security_hold'}};
const renewed={...old,id:'pi_renewal',metadata:{bookingId:b._id,purpose:'security_hold_renewal',replaces:old.id},client_secret:'fixture_secret',latest_charge:{payment_method_details:{card:{capture_before:(now+7*86400000)/1000}}}};
intents.set(old.id,old);intents.set(renewed.id,renewed);
const modules={bookings,holdRenewal:holds,pickupSecurity:pickup,accounts};
const mutationCtx={db,scheduler:{runAfter:async(delay,ref,args)=>events.push(['job',ref,args]),runAt:async(time,ref,args)=>events.push(['job',ref,args]),cancel:async()=>{}}};
const ctx={runQuery:async(ref,args)=>{const [m,f]=ref.split('.');return modules[m][f].handler({db},args);},runMutation:async(ref,args)=>{const [m,f]=ref.split('.');return modules[m][f].handler(mutationCtx,args);}};
(async()=>{
 await assert.rejects(holds.updatePickupCard.handler(ctx,{token:'foreign',bookingId:b._id}),/access denied/);
 const result=await holds.updatePickupCard.handler(ctx,{token:'owner',bookingId:b._id});
 assert.equal(result.url,'https://checkout.example.invalid/card','A failed linked renewal authorisation can reach the real card setup action');
 assert.equal(events.find(e=>e[0]==='setup')[1].mode,'setup','Recovery saves a card without charging a payment');
 assert.equal(b.securityHoldRecoveryReleasedIntentId,renewed.id);
 assert.equal(await pickup.recoverCard.handler(mutationCtx,{bookingId:b._id,sessionId:'cs_recovery_fixture',customerId:'cus_owner',paymentMethodId:'pm_replacement'}),true);
 assert.equal(b.securityHoldGeneration,2);assert.equal(b.securityHoldPaymentMethodId,'pm_replacement');assert.equal(b.stripeDepositIntentId,undefined);
 assert.equal(await pickup.recoverCard.handler(mutationCtx,{bookingId:b._id,sessionId:'cs_recovery_fixture',customerId:'cus_owner',paymentMethodId:'pm_replacement'}),false,'A setup receipt cannot reset security repeatedly');
 b.stripeDepositIntentId=renewed.id;b.securityHoldPaymentMethodId='pm_old';b.depositHoldStatus='requires_action';renewed.status='requires_action';
 assert.equal((await holds.resumePickup.handler(ctx,{token:'owner',bookingId:b._id})).clientSecret,renewed.client_secret);
 const setupCount=events.filter(e=>e[0]==='setup').length;
 for(const [field,value]of [['customer','cus_foreign'],['payment_method','pm_foreign'],['amount',1],['currency','usd'],['capture_method','automatic']]){const before=renewed[field];renewed[field]=value;await assert.rejects(holds.updatePickupCard.handler(ctx,{token:'owner',bookingId:b._id}),/does not match/);renewed[field]=before;}
 assert.equal(events.filter(e=>e[0]==='setup').length,setupCount);
 renewed.status='processing';await assert.rejects(holds.updatePickupCard.handler(ctx,{token:'owner',bookingId:b._id}),/still processing/);
 renewed.status='requires_capture';await assert.rejects(holds.updatePickupCard.handler(ctx,{token:'owner',bookingId:b._id}),/held, charged/);
 renewed.status='requires_action';cancelFailure=true;await assert.rejects(holds.updatePickupCard.handler(ctx,{token:'owner',bookingId:b._id}),/release failure/);cancelFailure=false;
 assert.equal(events.filter(e=>e[0]==='setup').length,setupCount,'No recovery setup before prior authorisation release succeeds');
 b.stripeDepositIntentId=old.id;b.depositHoldRenewalIntentId=renewed.id;b.depositHoldRenewalStatus='requires_action';account.email='changed@example.invalid';
 assert.equal((await holds.resume.handler(ctx,{token:'owner',bookingId:b._id})).clientSecret,renewed.client_secret,'Permanent account ownership survives an email change');
 other.email=b.guestEmail;await assert.rejects(holds.resume.handler(ctx,{token:'foreign',bookingId:b._id}),/access denied/,'A matching email cannot override another permanent account');
 old.status='requires_capture';renewed.status='requires_capture';cancelFailure=true;
 const oldConsole=console.error;let pending;
 try{console.error=()=>{};pending=await holds.sync.handler(ctx,{token:'owner',bookingId:b._id});}finally{console.error=oldConsole;cancelFailure=false;}
 assert.equal(pending.status,'renewed');assert.equal(pending.releasePending,true,'Successful new authorisation does not falsely report old-hold release');
 assert(b.depositHoldPreviousIntentIds.includes(old.id));
 assert.equal((await holds.sync.handler(ctx,{token:'owner',bookingId:b._id})).releasePending,true,'Refresh retains the unresolved release receipt');
 await holds.renewOne.handler(ctx,{bookingId:b._id});
 assert.equal((await holds.sync.handler(ctx,{token:'owner',bookingId:b._id})).releasePending,false,'Only confirmed old-hold release clears the pending message');
 b.depositHoldPreviousIntentIds=[old.id];old.status='processing';const cancellations=events.filter(e=>e[0]==='cancel').length;
 await holds.renewOne.handler(ctx,{bookingId:b._id});assert.equal((await holds.sync.handler(ctx,{token:'owner',bookingId:b._id})).releasePending,true,'An unresolved provider state is not a release receipt');
 old.status='succeeded';old.amount_received=10000;await holds.renewOne.handler(ctx,{bookingId:b._id});assert(b.depositHoldPreviousIntentIds.includes(old.id));assert.equal(events.filter(e=>e[0]==='cancel').length,cancellations,'Captured funds are retained for team settlement rather than cancelled or labelled released');
 const visible=await accounts.myBookings.handler({db},{token:'owner'});assert.equal(visible.find(row=>row._id===b._id).depositHoldReleasePending,true);assert.equal(visible.find(row=>row._id===b._id).depositHoldPreviousIntentIds,undefined,'Account panel gets the pending flag without provider intent identifiers');
 console.log('PASS renewed card recovery actual actions: setup without charge, one-time account-bound recovery/new generation, renewal bank challenge, foreign/malformed/held/processing/release-failed guards and permanent account identity. Controlled provider; no real card setup.');
})().catch(e=>{console.error(e);process.exitCode=1});
