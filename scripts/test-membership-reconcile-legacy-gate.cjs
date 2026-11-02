const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const state=h.load('convex/membershipReconcileState.ts'),tasks=[],ctx={db:h.db,scheduler:{runAfter:async(delay,ref,args)=>tasks.push({delay,ref,args})}};
(async()=>{
 delete process.env.MEMBERSHIP_BOUNDED_RECONCILE_ENABLED;const now=Date.now(),original=Date.now;
 try{
  Date.now=()=>now;await state.schedule.handler(ctx,{});assert.equal(tasks.length,0,'flags-off initialization preserves the six-hour cadence');
  Date.now=()=>now+6*3600000-1;await state.schedule.handler(ctx,{});assert.equal(tasks.length,0,'legacy reconciliation does not run before the six-hour boundary');
  Date.now=()=>now+6*3600000;await state.schedule.handler(ctx,{})
 }finally{Date.now=original}
 assert.equal(tasks.length,1);assert.equal(tasks[0].ref,'checkout.reconcileMembershipsLegacy','flags-off schedules only the original scanner');
 console.log('PASS membership dark gate: legacy reconciliation remains authoritative until bounded scanning is explicitly enabled.');
})().catch(error=>{console.error(error);process.exitCode=1});
