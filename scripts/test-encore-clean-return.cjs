const assert=require('node:assert/strict');
const h=require('./lib/rentalTestHarness.cjs');
h.setMock('stripe',{default:class Stripe{}});
const state=h.load('convex/encoreSettlementState.ts'),worker=h.load('convex/encoreSettlement.ts'),rollups=h.load('convex/encoreRollups.ts'),notices=h.load('convex/encoreNotices.ts'),delivery=h.load('convex/rentalEmailDelivery.ts');
const {queueEncoreCheck}=h.load('convex/lib/encoreCheckQueue.ts'),{loyaltyProgress}=h.load('convex/lib/loyalty.ts');
const tasks=[],ctx={db:h.db,scheduler:{runAfter:async(_delay,ref,args)=>tasks.push({ref,args})}};
ctx.runMutation=async(ref,args)=>state[ref.split('.')[1]].handler(ctx,args);
ctx.runQuery=async(ref,args)=>state[ref.split('.')[1]].handler(ctx,args);
process.env.STRIPE_SECRET_KEY='synthetic';process.env.ENCORE_EVIDENCE_READ_ENABLED='true';
(async()=>{
 const now=Date.now(),account=h.put('accounts',{email:'clean@example.invalid'}),bookings=[];
 for(let index=0;index<3;index++){
  const booking=h.put('bookings',{accountId:account._id,accountAccessRequired:false,guestEmail:account.email,status:'returned',stripeCheckoutSessionId:`clean-${index}`,depositAmount:0,actualReturnedAt:now,lineItems:[{start:now,end:now,qty:1}],returnDecision:{inspection:[{key:'camera',condition:'good',details:'',openCase:false}]}});bookings.push(booking);
  await queueEncoreCheck(ctx,booking._id);const check=h.tables.get('encore_settlement_checks').find(row=>row.bookingId===booking._id);
  await worker.processCheck.handler(ctx,{checkId:check._id});const rollup=h.tables.get('encore_account_rollups').find(row=>row.accountId===account._id);
  await rollups.page.handler(ctx,{accountId:account._id,generation:rollup.generation});await notices.dispatch.handler(ctx,{accountId:account._id});
  assert.equal((await loyaltyProgress(ctx,account)).level,index+1);
  const mail=h.tables.get('rental_email_deliveries').filter(row=>row.bookingId===booking._id&&row.kind==='encore');assert.equal(mail.length,1);assert.equal(mail[0].encoreLevel,index+1);
  await queueEncoreCheck(ctx,booking._id);await worker.processCheck.handler(ctx,{checkId:check._id});assert.equal(h.tables.get('rental_email_deliveries').filter(row=>row.bookingId===booking._id&&row.kind==='encore').length,1);
 }
 const first=bookings[0],mail=h.tables.get('rental_email_deliveries').find(row=>row.bookingId===first._id),other=h.put('accounts',{email:'other@example.invalid'});
 await h.db.patch(first._id,{accountId:other._id});await delivery.dispatchOne.handler(ctx,{deliveryId:mail._id});assert.equal(mail.state,'skipped');
 await h.db.patch(first._id,{accountId:account._id});await queueEncoreCheck(ctx,first._id);
 const check=h.tables.get('encore_settlement_checks').find(row=>row.bookingId===first._id);await worker.processCheck.handler(ctx,{checkId:check._id});assert.equal(mail.state,'pending','previously skipped mail can safely be rearmed for its original account');
 const bad=h.put('bookings',{...first,_id:'bad-clean',stripeCheckoutSessionId:'bad-clean',returnDecision:{inspection:[{key:'camera',condition:'damaged',details:'damage',openCase:true}]}});
 await queueEncoreCheck(ctx,bad._id);const badCheck=h.tables.get('encore_settlement_checks').find(row=>row.bookingId===bad._id);await worker.processCheck.handler(ctx,{checkId:badCheck._id});assert.equal(badCheck.state,'complete');assert(!(h.tables.get('rental_email_deliveries')??[]).some(row=>row.bookingId===bad._id));
 console.log('PASS Encore clean return: gated provider evidence, durable rollup, three levels, replay deduplication, reassignment fence and safe rearm.');
})().catch(error=>{console.error(error);process.exitCode=1});
