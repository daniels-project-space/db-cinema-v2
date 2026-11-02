const assert=require('node:assert/strict');
const {load,db,put,tables}=require('./lib/rentalTestHarness.cjs');
const {queueEncoreRollup}=load('convex/lib/encoreRollup.ts'),rollups=load('convex/encoreRollups.ts');
const {reviewContext}=load('convex/lib/reviewContext.ts'),{reviewSettlementFingerprint}=load('convex/lib/reviewEligibility.ts');
const {loyaltyProgress}=load('convex/lib/loyalty.ts');
const tasks=[],ctx={db,scheduler:{runAfter:async(_delay,ref,args)=>tasks.push({ref,args})}};
const previous=process.env.ENCORE_EVIDENCE_READ_ENABLED;
(async()=>{
 const now=Date.now(),account=put('accounts',{email:'rollup@example.invalid'}),good=[];
 for(let index=0;index<3;index++){
  const booking=put('bookings',{accountId:account._id,accountAccessRequired:false,guestEmail:account.email,status:'returned',stripeCheckoutSessionId:`rollup-${index}`,depositAmount:0,actualReturnedAt:now,lineItems:[{start:now,end:now,qty:1}],returnDecision:{inspection:[{key:'camera',condition:'good',details:'',openCase:false}]}});
  const fingerprint=reviewSettlementFingerprint(await reviewContext(ctx,booking));booking.reviewEligibilityFingerprint=fingerprint;
  put('encore_eligibility_evidence',{accountId:account._id,bookingId:booking._id,checkoutKey:booking.stripeCheckoutSessionId,fingerprint,verifiedAt:now});good.push(booking);
 }
 for(let index=0;index<70;index++)put('encore_eligibility_evidence',{accountId:account._id,bookingId:`missing-booking-${index}`,checkoutKey:`missing-${index}`,fingerprint:'invalid',verifiedAt:now});
 await queueEncoreRollup(ctx,account._id);const rollup=tables.get('encore_account_rollups')[0],generation=rollup.generation;
 await rollups.page.handler(ctx,{accountId:account._id,generation});assert.equal(rollup.state,'running');assert.equal(rollup.candidates.length,0);
 await rollups.page.handler(ctx,{accountId:account._id,generation:generation-1});assert.equal(rollup.cursor,'25','a stale continuation cannot advance the scan');
 await rollups.page.handler(ctx,{accountId:account._id,generation});await rollups.page.handler(ctx,{accountId:account._id,generation});
 assert.equal(rollup.state,'ready');assert.equal(rollup.published.length,3);
 process.env.ENCORE_EVIDENCE_READ_ENABLED='true';assert.equal((await loyaltyProgress(ctx,account)).level,3,'proof-backed read grants only validated unique checkouts');
 await queueEncoreRollup(ctx,account._id);assert.equal((await loyaltyProgress(ctx,account)).level,3,'rebuilding preserves previously published proofs');
 await db.patch(good[0]._id,{accountId:'foreign-account'});assert.equal((await loyaltyProgress(ctx,account)).level,2,'reassignment invalidates the evidence immediately');
 await db.patch(good[1]._id,{returnDecision:{inspection:[{key:'camera',condition:'damaged'}]}});assert.equal((await loyaltyProgress(ctx,account)).level,1,'newly reported issues invalidate a cached proof');
 await db.patch(good[2]._id,{reviewEligibilityFingerprint:'stale'});assert.equal((await loyaltyProgress(ctx,account)).level,0,'stale settlement evidence fails closed');
 console.log('PASS Encore rollup: bounded pagination, generation fencing, published snapshot continuity and live ownership/issue/settlement revalidation.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{if(previous===undefined)delete process.env.ENCORE_EVIDENCE_READ_ENABLED;else process.env.ENCORE_EVIDENCE_READ_ENABLED=previous});
