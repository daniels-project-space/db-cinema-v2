/** Actual bank callback and stock transaction across pickup; provider transport controlled. */
const assert=require('node:assert/strict'),t=require('./test-refunded-rental-swap.cjs');
const security=t.h.load('convex/pickupSecurity.ts'),shared=t.h.load('shared/pickupSecurity.ts');
(async()=>{
 const x=await t.fixture();t.setProviderStatus('pending');await t.checkout.refundSwap.handler(t.ctx,x.args);
 const job=t.h.docs.get(x.row.settlementRefundId),bank=t.provider.get(job.parts[0].stripeRefundId),generation=x.b.securityHoldGeneration;
 assert.equal(x.row.state,'accepted');assert.equal(x.b.activeSwapRefundId,job._id);
 const realNow=Date.now;try{
  Date.now=()=>shared.pickupHoldAt(x.b)+5*60000;
  const before=JSON.stringify([x.b.lineItems,x.b.total,x.b.depositAmount,x.b.depositHoldAmount,x.b.securityHoldGeneration]);
  assert.equal(await security.claim.handler(t.ctx,{bookingId:x.b._id,generation}),false,'Pending agreed refund blocks authorising an obsolete hold');
  assert.equal(JSON.stringify([x.b.lineItems,x.b.total,x.b.depositAmount,x.b.depositHoldAmount,x.b.securityHoldGeneration]),before);
  assert.equal(x.b.securityHoldAttempts??0,0);assert.equal(x.b.securityHoldLeaseUntil,undefined);
  bank.status='succeeded';await t.checkout.stripeWebhook.handler(t.ctx,{body:JSON.stringify({type:'refund.updated',data:{object:bank}}),sig:'verified-fixture'});
  assert.equal(x.row.state,'applied','Actual bank completion can finish an uncollected settlement after pickup time');
  assert.equal(x.b.activeSwapRefundId,undefined);assert.equal(x.b.total,130,'Captured gross cash is preserved');assert.equal(x.b.subtotal,60);assert.equal(x.b.depositAmount,50);
  assert.equal(x.b.securityHoldGeneration,generation+1);assert.equal(x.b.depositHoldStatus,'scheduled');
  assert.equal(await security.claim.handler(t.ctx,{bookingId:x.b._id,generation}),false,'Old scheduled job cannot authorise after the kit changed');
  const current=await security.claim.handler(t.ctx,{bookingId:x.b._id,generation:x.b.securityHoldGeneration});assert(current,'New scheduled generation can claim the settled kit');assert.equal(current.depositHoldAmount,x.row.holdTotalPence/100);
  assert.equal(job.status,'succeeded');assert.equal(job.parts.length,1);assert.equal(t.provider.size,1,'Waiting and replay never issue another original-method refund');
 }finally{Date.now=realNow;}
 console.log('PASS actual pending-refund pickup boundary: untouched hold suspended, bank callback atomically applies exact kit and preserves cash/deposit, reschedules current amount and denies stale generation, one refund only. No external writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
