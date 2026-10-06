const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
let outcome='requires_capture',expired=false,events=[];
class StripeFixture {
 paymentIntents={
  retrieve:async id=>id.startsWith('old')?{id,status:'requires_capture',customer:'cus_test',payment_method:'pm_test'}:{id,status:outcome,latest_charge:{payment_method_details:{card:{capture_before:Date.now()/1000+(expired?-1:86400)}}}},
  create:async(args,opts)=>{events.push(['create',args,opts]);return {id:'new-'+args.metadata.bookingId};},
  cancel:async id=>{events.push(['cancel',id]);return {id,status:'canceled'};}
 };
}
setMock('stripe',{default:StripeFixture});setMock('./lib/mailer',{sendMail:async()=>true});process.env.STRIPE_SECRET_KEY='sk_test_fixture';
const renew=load('convex/holdRenewal.ts'),bookings=load('convex/bookings.ts');
const ctx={db,runQuery:(ref,args)=>bookings[ref.split('.')[1]].handler({db},args),runMutation:async(ref,args)=>{events.push([ref,args]);return bookings[ref.split('.')[1]].handler({db},args);}};
const make=(amount=250,status='confirmed',hours=2)=>put('bookings',{status,depositHoldAmount:amount,stripeDepositIntentId:'old-'+Math.random(),depositHoldStatus:'held',depositHoldExpiresAt:Date.now()+hours*3600000,lineItems:[]});
(async()=>{
 let b=make();await renew.renewOne.handler(ctx,{bookingId:b._id});let create=events.find(x=>x[0]==='create');assert.equal(create[1].amount,25000);assert.equal(create[1].currency,'gbp');assert.equal(create[1].capture_method,'manual');assert.equal(create[1].off_session,true);assert.match(create[2].idempotencyKey,/dbc-hold-renew/);assert.equal(b.stripeDepositIntentId,'new-'+b._id);assert(events.findIndex(x=>x[0]==='bookings.replaceHold')<events.findIndex(x=>x[0]==='cancel'),'Old hold is released only after replacement is recorded');
 events=[];b=make(125);await renew.renewOne.handler(ctx,{bookingId:b._id});assert.equal(events.find(x=>x[0]==='create')[1].amount,12500,'Renewal preserves an older booking’s agreed amount');
 for(const status of ['returned','cancelled']){events=[];b=make(250,status);await renew.renewOne.handler(ctx,{bookingId:b._id});assert(!events.some(x=>x[0]==='create'));}
 events=[];b=make(250,'confirmed',25);await renew.renewOne.handler(ctx,{bookingId:b._id});assert(!events.some(x=>x[0]==='create'),'No renewal outside the 24-hour window');
 events=[];outcome='requires_action';b=make();const old=b.stripeDepositIntentId;await renew.renewOne.handler(ctx,{bookingId:b._id});assert.equal(b.stripeDepositIntentId,old);assert.equal(b.depositHoldRenewalStatus,'requires_action');assert(!events.some(x=>x[0]==='cancel'),'Authentication never releases the existing hold');
 events=[];outcome='requires_capture';expired=true;b=make();const before=b.stripeDepositIntentId;await renew.renewOne.handler(ctx,{bookingId:b._id});assert.equal(b.stripeDepositIntentId,before);assert.equal(b.depositHoldRenewalStatus,'failed');assert.deepEqual(events.filter(x=>x[0]==='cancel').map(x=>x[1]),['new-'+b._id]);
 console.log('PASS hold renewal: saved 10% and historical amounts, 24-hour eligibility, manual/off-session/idempotent request, old-hold release ordering, ended rentals, authentication and expired replacements.');
})().catch(e=>{console.error(e);process.exitCode=1;});
