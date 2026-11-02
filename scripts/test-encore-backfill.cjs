const assert=require('node:assert/strict');
const harness=require('./lib/rentalTestHarness.cjs');
harness.setMock('stripe',{default:class Stripe{}});
const backfill=harness.load('convex/encoreBackfill.ts');
const state=harness.load('convex/encoreSettlementState.ts');
const action=harness.load('convex/encoreSettlement.ts');
const scheduled=[];
const context={db:harness.db,scheduler:{runAfter:async(_delay,ref,args)=>scheduled.push({ref,args})},
 runMutation:async(ref,args)=>state[ref.split('.')[1]].handler(context,args),runQuery:async(ref,args)=>state[ref.split('.')[1]].handler(context,args)};
const previousKey=process.env.STRIPE_SECRET_KEY;
process.env.STRIPE_SECRET_KEY='synthetic';process.env.ENCORE_EVIDENCE_CAPTURE_ENABLED='true';
(async()=>{
 const now=Date.now(),account=harness.put('accounts',{email:'backfill@example.invalid'});
 for(let index=0;index<121;index++)harness.put('bookings',{accountId:account._id,accountAccessRequired:false,guestEmail:account.email,status:'returned',stripeCheckoutSessionId:`backfill-${index}`,depositAmount:0,actualReturnedAt:now,lineItems:[{title:'Camera',qty:1,start:now,end:now}],returnDecision:{inspection:[{key:'camera',condition:'good',details:'',openCase:false}]}});
 await backfill.start.handler(context,{});
 const run=harness.tables.get('encore_backfills')[0],generation=run.generation;
 await backfill.start.handler(context,{});assert.equal(scheduled.length,1,'active backfill is single-flight');
 await backfill.page.handler(context,{generation});assert.equal(harness.tables.get('encore_settlement_checks').length,50);
 assert.equal(scheduled.filter(task=>task.ref==='encoreSettlement.processCheck').length,0,'provider work is drained by the bounded retry worker');
 await backfill.page.handler(context,{generation:generation-1});assert.equal(harness.tables.get('encore_settlement_checks').length,50,'stale continuations do nothing');
 const originalNow=Date.now;Date.now=()=>now+6*60000;
 try{await backfill.recover.handler(context,{})}finally{Date.now=originalNow}
 assert.equal(run.generation,generation+1,'lost continuation is recovered with a fresh generation');
 await backfill.page.handler(context,{generation});assert.equal(harness.tables.get('encore_settlement_checks').length,50,'recovery fences old continuations');
 await backfill.page.handler(context,{generation:run.generation});assert.equal(harness.tables.get('encore_settlement_checks').length,100);
 await backfill.page.handler(context,{generation:run.generation});assert.equal(harness.tables.get('encore_settlement_checks').length,121);assert.equal(run.state,'complete');
 const row=harness.tables.get('encore_settlement_checks')[0];assert.equal(row.notifyEligible,false);
 await action.processCheck.handler(context,{checkId:row._id});
 assert.equal(row.state,'complete');assert.equal(harness.tables.get('encore_eligibility_evidence').length,1);
 assert.equal(harness.tables.get('rental_email_deliveries'),undefined,'historical evidence does not send surprise emails');
 const proof=harness.tables.get('encore_eligibility_evidence')[0];assert.equal(proof.accountId,account._id);assert.equal(proof.bookingId,row.bookingId);
 const live=harness.load('convex/lib/encoreCheckQueue.ts');const next=harness.tables.get('encore_settlement_checks')[1];
 process.env.ENCORE_EVIDENCE_READ_ENABLED='true';await live.queueEncoreCheck(context,next.bookingId);assert.equal(next.notifyEligible,true,'a later live claim can supersede quiet backfill');
 console.log('PASS Encore backfill: bounded pages, quiet provider queue, generation fencing, durable evidence and live-claim promotion.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{if(previousKey===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=previousKey});
