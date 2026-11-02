const assert=require('node:assert/strict');
const h=require('./lib/rentalTestHarness.cjs');
h.setMock('stripe',{default:class Stripe{}});
const state=h.load('convex/encoreSettlementState.ts'),action=h.load('convex/encoreSettlement.ts');
const {queueEncoreCheck}=h.load('convex/lib/encoreCheckQueue.ts'),{loyaltyProgress}=h.load('convex/lib/loyalty.ts');
const tasks=[],ctx={db:h.db,scheduler:{runAfter:async(_delay,ref,args)=>tasks.push({ref,args})},
 runMutation:async(ref,args)=>state[ref.split('.')[1]].handler(ctx,args),runQuery:async(ref,args)=>state[ref.split('.')[1]].handler(ctx,args)};
const previousKey=process.env.STRIPE_SECRET_KEY;process.env.STRIPE_SECRET_KEY='synthetic';process.env.ENCORE_EVIDENCE_READ_ENABLED='true';
(async()=>{
 const now=Date.now(),account=h.put('accounts',{email:'owned-settlement@example.invalid'});
 const booking=h.put('bookings',{accountId:account._id,accountAccessRequired:false,status:'returned',guestEmail:account.email,stripeCheckoutSessionId:'session-1',depositAmount:0,actualReturnedAt:now,
  lineItems:[{title:'Camera',qty:1,start:now,end:now}],returnDecision:{inspection:[{key:'camera',condition:'good',details:'',openCase:false}]}});
 await queueEncoreCheck(ctx,booking._id);const check=h.tables.get('encore_settlement_checks')[0];
 assert.equal(check.state,'pending');await action.processCheck.handler(ctx,{checkId:check._id});
 const rollup=h.tables.get('encore_account_rollups').find(row=>row.accountId===account._id);await h.load('convex/encoreRollups.ts').page.handler(ctx,{accountId:account._id,generation:rollup.generation});await h.load('convex/encoreNotices.ts').dispatch.handler(ctx,{accountId:account._id});
 assert.equal(check.state,'complete');assert.equal((await loyaltyProgress(ctx,account)).level,1);
 assert.equal(h.tables.get('rental_email_deliveries').filter(row=>row.bookingId===booking._id&&row.kind==='encore').length,1);
 await queueEncoreCheck(ctx,booking._id);await action.processCheck.handler(ctx,{checkId:check._id});
 assert.equal(h.tables.get('rental_email_deliveries').filter(row=>row.bookingId===booking._id&&row.kind==='encore').length,1,'replays never duplicate the reward email');
 const retry=h.put('bookings',{...booking,_id:'retry-booking',stripeCheckoutSessionId:'session-2'});await queueEncoreCheck(ctx,retry._id);
 const retryCheck=h.tables.get('encore_settlement_checks').find(row=>row.bookingId===retry._id);
 delete process.env.STRIPE_SECRET_KEY;await action.processCheck.handler(ctx,{checkId:retryCheck._id});
 assert.equal(retryCheck.state,'pending');assert.equal(retryCheck.error,'provider_unconfigured');assert.ok(retryCheck.dueAt>Date.now());
 const stale=await state.claim.handler(ctx,{checkId:check._id});assert.equal(stale,null,'completed jobs cannot be re-claimed');
 assert.ok(tasks.some(task=>task.ref==='encoreSettlement.processCheck'),'closure schedules the durable worker');
 console.log('PASS Encore settlement outbox: durable closure, provider gate, retries, owned account, idempotent progression and email.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(previousKey===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=previousKey;});
