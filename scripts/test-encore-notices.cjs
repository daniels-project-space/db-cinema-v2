const assert=require('node:assert/strict');
const {load,db,put,tables}=require('./lib/rentalTestHarness.cjs');
const {queueEncoreNotice,dispatch}=load('convex/encoreNotices.ts'),{queueEncoreRollup}=load('convex/lib/encoreRollup.ts'),rollups=load('convex/encoreRollups.ts');
const {reviewContext}=load('convex/lib/reviewContext.ts'),{reviewSettlementFingerprint}=load('convex/lib/reviewEligibility.ts');
const tasks=[],ctx={db,scheduler:{runAfter:async(_delay,ref,args)=>tasks.push({ref,args})}},previous=process.env.ENCORE_EVIDENCE_READ_ENABLED;
process.env.ENCORE_EVIDENCE_READ_ENABLED='true';
(async()=>{
 const now=Date.now(),account=put('accounts',{email:'notice@example.invalid'}),bookings=[];
 for(let index=0;index<2;index++){
  const booking=put('bookings',{accountId:account._id,accountAccessRequired:false,guestEmail:account.email,status:'returned',stripeCheckoutSessionId:`notice-${index}`,depositAmount:0,actualReturnedAt:now,lineItems:[{start:now,end:now,qty:1}],returnDecision:{inspection:[{key:'camera',condition:'good',details:'',openCase:false}]}});
  const fingerprint=reviewSettlementFingerprint(await reviewContext(ctx,booking));booking.reviewEligibilityFingerprint=fingerprint;
  put('encore_eligibility_evidence',{accountId:account._id,bookingId:booking._id,checkoutKey:booking.stripeCheckoutSessionId,fingerprint,verifiedAt:now});bookings.push(booking);
  await queueEncoreNotice(ctx,booking._id,account._id,0);
 }
 await queueEncoreNotice(ctx,bookings[0]._id,account._id,0);assert.equal(tables.get('encore_notice_events').length,2,'event replay is idempotent');
 await queueEncoreRollup(ctx,account._id);const row=tables.get('encore_account_rollups')[0];await rollups.page.handler(ctx,{accountId:account._id,generation:row.generation});
 await dispatch.handler(ctx,{accountId:account._id});
 const deliveries=tables.get('rental_email_deliveries').filter(row=>row.kind==='encore');
 assert.deepEqual(deliveries.map(row=>row.encoreLevel),[1,2],'concurrent clean returns advance distinct levels in booking order');
 assert(deliveries.every(row=>row.encoreAccountId===account._id));
 await dispatch.handler(ctx,{accountId:account._id});assert.equal(deliveries.length,2,'dispatch retry does not duplicate a notice');
 const other=put('accounts',{email:'other@example.invalid'}),third=put('bookings',{...bookings[0],_id:'reassigned-booking',stripeCheckoutSessionId:'notice-3'});
 const fingerprint=reviewSettlementFingerprint(await reviewContext(ctx,third));third.reviewEligibilityFingerprint=fingerprint;
 put('encore_eligibility_evidence',{accountId:account._id,bookingId:third._id,checkoutKey:third.stripeCheckoutSessionId,fingerprint,verifiedAt:now});
 await queueEncoreNotice(ctx,third._id,account._id,2);await db.patch(third._id,{accountId:other._id});
 await dispatch.handler(ctx,{accountId:account._id});assert.equal(tables.get('encore_notice_events').find(event=>event.bookingId===third._id).state,'skipped','a reassigned rental cannot send a former owner’s notice');
 console.log('PASS Encore notices: durable booking keys, concurrent level order, replay dedupe and account-reassignment fence.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{if(previous===undefined)delete process.env.ENCORE_EVIDENCE_READ_ENABLED;else process.env.ENCORE_EVIDENCE_READ_ENABLED=previous});
