/** Actual owner, checkout, refund and signed callback paths; provider transport controlled. */
const assert=require('node:assert/strict'),t=require('./test-paid-rental-swap.cjs');
const refunds=new Map(),keys=new Map();let nextStatus='succeeded',creates=0,loseResponse=false,onOriginalPaymentRead=null;
t.stripeMock.default=class {
 checkout={sessions:{create:async(p,{idempotencyKey})=>{
  const amount=p.line_items[0].price_data.unit_amount;
  assert.equal(p.customer,'cus_saved','Real combined checkout uses the bound rental customer, not a new Stripe customer');assert.equal(p.customer_creation,undefined);
  assert.equal(amount,5000,'Charge the £50 additional deposit, never net it against the £20 refund');
  assert.match(p.line_items[0].price_data.product_data.name,/refundable deposit/i);
  assert.equal(idempotencyKey,'dbc-addition-checkout-'+p.metadata.rentalAdditionId);
  const s={id:'cs_compound_'+t.sessions.size,status:'open',payment_status:'unpaid',currency:'gbp',amount_total:amount,customer:'cus_saved',metadata:p.metadata,url:'https://checkout.stripe.test/compound'};
  t.sessions.set(s.id,s);return s;
 },retrieve:async id=>{assert(t.sessions.has(id));return t.sessions.get(id);},expire:async id=>{const s=t.sessions.get(id);s.status='expired';return s;},list:async function*(){yield* t.sessions.values();}}};
 paymentIntents={retrieve:async id=>{assert(t.intents.has(id),id);if(onOriginalPaymentRead&&id.startsWith('pi_original_')){const hook=onOriginalPaymentRead;onOriginalPaymentRead=null;await hook();}return t.intents.get(id);},create:async()=>{throw Error('No card hold before pickup or during unresolved settlement');}};
 refunds={list:({payment_intent})=>[...refunds.values()].filter(r=>r.payment_intent===payment_intent),retrieve:async id=>refunds.get(id),create:async(p,{idempotencyKey})=>{
  creates++;let r=keys.get(idempotencyKey);
  if(!r){r={id:'re_compound_'+refunds.size,status:nextStatus,amount:p.amount??t.intents.get(p.payment_intent).amount_received,currency:'gbp',payment_intent:p.payment_intent,metadata:p.metadata};keys.set(idempotencyKey,r);refunds.set(r.id,r);}
  if(loseResponse){loseResponse=false;throw Error('Lost original refund response');}return r;
 }};
 webhooks={constructEvent:(body,sig)=>{assert.equal(sig,'verified-fixture');return JSON.parse(body);}};
};
const ops=t.h.load('convex/rentalOperations.ts'),security=t.h.load('convex/pickupSecurity.ts');
async function fixture(){
 const x=await t.fixture({targetValue:6000,expectedCharge:50});
 t.intents.set(x.b.stripePaymentIntentId,{id:x.b.stripePaymentIntentId,status:'succeeded',currency:'gbp',amount:13000,amount_received:13000});
 const started=await t.payments.startPaidSwap.handler(t.ctx,x.args);
 const addition=t.h.docs.get(started.id),job=t.h.docs.get(x.row.settlementRefundId),session=t.sessions.get(addition.sessionId);
 assert.equal(x.row.refundPence,2000);assert.equal(x.row.securityChargePence,5000);assert.equal(x.row.holdTotalPence,70000);
 assert.equal(addition.lineTotal,0);assert.equal(addition.securityCharge,50);assert.equal(job.status,'prepared');
 return {...x,addition,job,session};
}
function pay(x){x.session.status='complete';x.session.payment_status='paid';x.session.payment_intent='pi_'+x.session.id;t.intents.set(x.session.payment_intent,{id:x.session.payment_intent,status:'succeeded',currency:'gbp',amount:5000,amount_received:5000,amount_capturable:0,capture_method:'automatic',customer:'cus_saved'});}
async function finish(x){return t.payments.finalizePaid.handler(t.ctx,{id:x.addition._id,sessionId:x.session.id});}
const original=x=>assert.deepEqual([x.b.subtotal,x.b.total,x.b.depositAmount,x.b.depositHoldAmount,x.b.lineItems.length],[80,130,50,200,1]);
const refundArgs=x=>({token:process.env.ADMIN_TOKEN,bookingId:x.b._id,requestId:x.job.requestId,reason:x.job.reason,amountPence:x.job.amountPence});
async function bankCallback(x,status){const r=refunds.get(x.job.parts[0].stripeRefundId);r.status=status;return t.checkout.stripeWebhook.handler(t.ctx,{body:JSON.stringify({type:'refund.updated',data:{object:r}}),sig:'verified-fixture'});}
async function run(){
 const x=await fixture(),before=creates;
 await assert.rejects(t.checkout.refundRental.handler(t.ctx,refundArgs(x)),/deposit.*verified/i);assert.equal(creates,before);original(x);
 await assert.rejects(ops.bindRefundAllocations.handler(t.ctx,{id:x.job._id,allocations:[{paymentIntentId:x.b.stripePaymentIntentId,amountPence:2000}]}),/deposit.*verified/i);
 pay(x);nextStatus='pending';const pending=await finish(x);assert.equal(pending.updateApplied,false);assert.equal(pending.status,'swap_refund_pending');original(x);
 const customer=await t.h.load('convex/rentalAdditionState.ts').customerState.handler(t.ctx,{token:x.token,bookingId:x.b._id});
 assert.deepEqual(customer.proposedItems.map(i=>i.qty),[1,1],'The real renter panel displays the final swap, not the old kit plus another item');
 assert.equal(customer.rentalRefundAmount,20);assert.equal(customer.amount,50);assert.equal(customer.rentalRefundStatus,'pending');
 assert.equal(x.job.parts[0].paymentIntentId,x.b.stripePaymentIntentId);assert.equal(x.job.parts[0].amountPence,2000);assert.equal(creates,before+1);
 const reservations=t.h.tables.get('reservations').filter(r=>r.bookingId===x.b._id&&r.externalRef==='addition:'+x.addition._id);assert(reservations.length);assert(reservations.every(r=>r.status==='confirmed'&&r.holdExpiresAt===undefined),'Net replacement stock survives bank processing without an expiry');
 await assert.rejects(t.payments.withdrawByOwner.handler(t.ctx,{token:process.env.ADMIN_TOKEN,id:x.addition._id}),/refund has started/i);assert.equal(x.addition.withdrawalRequestedAt,undefined);
 const generation=x.b.securityHoldGeneration;const realNow=Date.now;try{
  Date.now=()=>x.b.securityHoldDueAt+60000;
  assert.equal(await security.claim.handler(t.ctx,{bookingId:x.b._id,generation}),false);
  await bankCallback(x,'succeeded');
 }finally{Date.now=realNow;}
 assert.equal(x.row.state,'applied');assert.equal(x.addition.status,'applied');assert.equal(x.b.activeAdditionId,undefined);assert.equal(x.b.activeSwapRefundId,undefined);
 assert.deepEqual([x.b.subtotal,x.b.total,x.b.depositAmount,x.b.depositHoldAmount],[60,180,100,700]);assert.equal(x.b.lineItems.length,2);
 assert.equal(x.b.total-x.job.amountPence/100,160,'Net cash equals £60 rental plus £100 refundable deposit');
 assert.equal(x.b.securityHoldGeneration,generation+1);assert.equal(x.b.depositHoldStatus,'scheduled');
 const sources=await t.h.load('convex/lib/rentalPaymentSources.ts').rentalPaymentSources(t.ctx,x.b);assert(sources.some(p=>p.paymentIntentId===x.session.payment_intent&&p.maxPaidPence===5000&&p.securityPence===5000),'Extra deposit is a protected security payment source');
 const remaining=await ops.prepareRefund.handler(t.ctx,{token:process.env.ADMIN_TOKEN,bookingId:x.b._id,requestId:'compound-remaining-rental-refund',reason:'Remaining rental cash only'});assert.equal(remaining.amountPence,6000,'Extra refundable security cannot become rental-refund cash');
 const receipt=JSON.stringify([x.b,x.row,x.request,t.jobs]);await bankCallback(x,'succeeded');assert.equal(JSON.stringify([x.b,x.row,x.request,t.jobs]),receipt);assert.equal(creates,before+1);
 const unpaid=await fixture();const c=creates;
 try{await t.checkout.refreshRentalRefund.handler(t.ctx,{token:process.env.ADMIN_TOKEN,bookingId:unpaid.b._id,id:unpaid.job._id});}catch(e){assert.match(e.message,/receipt|allocation|refund/i);}
 assert(unpaid.job.providerGeneration,'Actual read-only bank check records an observation fence');assert.equal(unpaid.job.allocations,undefined);assert.equal(creates,c);
 await t.payments.withdrawByOwner.handler(t.ctx,{token:process.env.ADMIN_TOKEN,id:unpaid.addition._id});original(unpaid);assert.equal(creates,c);assert.equal(unpaid.row.state,'withdrawn');assert.equal(unpaid.b.activeAdditionId,undefined);assert.equal(unpaid.b.activeSwapRefundId,undefined);assert(unpaid.job.cancelledBeforeBankAt);assert.equal(unpaid.job.status,'failed');
 const unknown=await fixture();pay(unknown);nextStatus='succeeded';loseResponse=true;await assert.rejects(finish(unknown),/Lost original refund response/);original(unknown);assert(unknown.b.activeSwapRefundId);const lostCreates=creates;keys.clear();await finish(unknown);assert.equal(unknown.row.state,'applied');assert.equal(creates,lostCreates,'Lost response recovers the original provider receipt instead of another refund');
 const failed=await fixture();pay(failed);nextStatus='failed';const stopped=await finish(failed);assert.equal(stopped.status,'swap_refund_failed');original(failed);
 await assert.rejects(t.swaps.withdrawFailedRefundSwap.handler(t.ctx,failed.args),/combined settlement/i);assert.equal(failed.row.state,'accepted');assert(failed.b.activeSwapRefundId);
 nextStatus='succeeded';await t.payments.withdrawByOwner.handler(t.ctx,{token:process.env.ADMIN_TOKEN,id:failed.addition._id});
 original(failed);assert.equal(failed.addition.status,'refunded');assert.equal(failed.addition.withdrawalRefundStatus,'succeeded');assert.equal(refunds.get(failed.addition.withdrawalRefundId).amount,5000,'Failed zero-money rental refund compensates the full extra deposit to its original payment');
 assert.equal(failed.b.activeAdditionId,undefined);assert.equal(failed.b.activeSwapRefundId,undefined);
 const ended=await fixture();pay(ended);const realClock=Date.now;try{
  Date.now=()=>Date.UTC(2030,0,3);const beforeEnded=creates;const review=await finish(ended);
  assert.equal(review.status,'swap_settlement_review');assert.equal(creates,beforeEnded,'Never start a new rental-price refund once the agreed physical exchange period has ended');original(ended);
  assert.equal(await security.claim.handler(t.ctx,{bookingId:ended.b._id,generation:ended.b.securityHoldGeneration}),false);
  assert.equal(ended.b.securityHoldFailureCode,'rental_window_ended');
 }finally{Date.now=realClock;}
 const bankLate=await fixture();pay(bankLate);nextStatus='pending';await finish(bankLate);const lateClock=Date.now;try{
  Date.now=()=>Date.UTC(2030,0,3);await security.claim.handler(t.ctx,{bookingId:bankLate.b._id,generation:bankLate.b.securityHoldGeneration});
  const bankWrites=creates;await bankCallback(bankLate,'succeeded');
  assert.equal(bankLate.job.status,'succeeded','A bank result remains durably recorded even after the physical rental window ended');
  assert.equal(bankLate.row.state,'accepted');assert(bankLate.row.settlementError);original(bankLate);assert.equal(creates,bankWrites);
 }finally{Date.now=lateClock;}
 const expiredStock=await fixture();for(const row of [...t.h.tables.get('reservations')])if(row.externalRef==='addition:'+expiredStock.addition._id)await t.h.db.delete(row._id);
 pay(expiredStock);nextStatus='pending';await finish(expiredStock);
 assert(t.h.tables.get('reservations').some(row=>row.externalRef==='addition:'+expiredStock.addition._id&&row.status==='confirmed'&&row.holdExpiresAt===undefined),'Expired short stock lease is reacquired as the exact permanent net delta before bank processing');
 const race=await fixture();pay(race);let foreign;const raceWrites=creates;
 onOriginalPaymentRead=async()=>{const unit=t.h.docs.get(race.row.targetListingId).components[0].inventoryUnitId;foreign=t.h.put('reservations',{inventoryUnitId:unit,qty:100,...race.window,source:'rm',status:'confirmed',externalRef:'concurrent-real-platform-rental'});};
 await assert.rejects(finish(race),/stock|source changed/i);assert.equal(creates,raceWrites,'Stock claimed during provider reads cannot start the rental refund');assert.equal(race.job.allocations,undefined);original(race);
 await t.h.db.delete(foreign._id);
 const closure=await fixture();pay(closure);nextStatus='pending';await finish(closure);
 const occupiedUnit=t.h.docs.get(closure.row.targetListingId).components[0].inventoryUnitId;
 const occupied=t.h.put('reservations',{inventoryUnitId:occupiedUnit,qty:100,...closure.window,source:'rm',status:'confirmed'});
 await bankCallback(closure,'succeeded');original(closure);assert.equal(closure.row.state,'accepted');
 await t.h.db.delete(occupied._id);
 const closeArgs={token:process.env.ADMIN_TOKEN,id:closure.addition._id,quoteKey:closure.row.quoteKey,reason:'Replacement cannot be supplied. Keep the original kit and completed concession.'};
 const beforeClosure=creates;
 await assert.rejects(t.payments.closeRefundOnlyByOwner.handler(t.ctx,{...closeArgs,token:closure.token}),/unauthorized/i);assert.equal(creates,beforeClosure);
 await assert.rejects(t.payments.closeRefundOnlyByOwner.handler(t.ctx,{...closeArgs,quoteKey:'wrong'}),/exact/i);assert.equal(closure.row.refundOnlyRequest,undefined);
 nextStatus='pending';const closing=await t.payments.closeRefundOnlyByOwner.handler(t.ctx,closeArgs);
 assert.equal(closing.pending,true);assert.equal(creates,beforeClosure+1);assert.equal(closure.addition.withdrawalRefundStatus,'pending');
 const depositRefund=refunds.get(closure.addition.withdrawalRefundId);assert.equal(depositRefund.amount,5000);assert.equal(depositRefund.payment_intent,closure.addition.paymentIntentId);
 assert.equal(closure.b.activeAdditionId,closure.addition._id);assert.equal(closure.b.activeSwapRefundId,closure.job._id);original(closure);
 await bankCallback(closure,'succeeded');assert.equal(closure.row.state,'accepted','A repeated original refund callback cannot apply the kit after the owner concession decision');original(closure);
 await assert.rejects(t.payments.closeRefundOnlyByOwner.handler(t.ctx,{...closeArgs,reason:'Changed decision'}),/reason changed/i);assert.equal(creates,beforeClosure+1);
 // A bank reversal during the extra-deposit refund retains both locks and
 // cannot trigger another financial write or pretend the original refund settled.
 const originalReceipt=closure.job.parts[0];const originalStatus=closure.job.status;closure.job.status='failed';originalReceipt.status='failed';
 await assert.rejects(t.payments.closeRefundOnlyByOwner.handler(t.ctx,closeArgs),/reconciliation/i);assert.equal(creates,beforeClosure+1);assert(closure.b.activeAdditionId);assert(closure.b.activeSwapRefundId);
 closure.job.status=originalStatus;originalReceipt.status='succeeded';depositRefund.status='succeeded';
 const final=await t.payments.closeRefundOnlyByOwner.handler(t.ctx,closeArgs);assert.equal(final.closed,true);assert.equal(creates,beforeClosure+1);
 assert.equal(closure.row.state,'withdrawn');assert.equal(closure.row.refundOnlyResolution.reason,closeArgs.reason);assert.equal(closure.row.refundOnlyResolution.refundedPence,2000);
 assert.deepEqual(closure.row.refundOnlyResolution.securityAtClosure,{depositPaidPence:5000,holdPence:20000});assert.equal(closure.b.activeAdditionId,undefined);assert.equal(closure.b.activeSwapRefundId,undefined);original(closure);
 assert(!t.h.tables.get('reservations').some(r=>r.externalRef==='addition:'+closure.addition._id));
 const jobsAfter=t.jobs.length,messagesAfter=(t.h.tables.get('messages')??[]).length;
 assert.equal((await t.payments.closeRefundOnlyByOwner.handler(t.ctx,closeArgs)).closed,true);assert.equal(creates,beforeClosure+1);assert.equal(t.jobs.length,jobsAfter);assert.equal((t.h.tables.get('messages')??[]).length,messagesAfter);
 await bankCallback(closure,'succeeded');assert.equal(closure.row.state,'withdrawn');original(closure);assert.equal(creates,beforeClosure+1);
 await bankCallback(closure,'failed');assert.equal(closure.row.state,'withdrawn');original(closure);assert.equal(creates,beforeClosure+1);
 const bankReturned=await t.swaps.proposal.handler(t.ctx,{...closure.args,admin:true});assert.equal(bankReturned.refundOnlyResolution.needsAttention,true);assert.equal(bankReturned.refundOnlyResolution.confirmedAmount,0);assert.equal(bankReturned.refundOnlyResolution.securityAtClosure.holdAmount,200);
 assert.equal((await t.payments.closeRefundOnlyByOwner.handler(t.ctx,closeArgs)).closed,true);assert.equal(creates,beforeClosure+1,'A later original bank reversal cannot return the extra deposit twice');
 console.log('PASS actual combined swap: £50 deposit and separate £20 original-method refund; unpaid/API/transaction guards, pending stock and hold fencing, post-pickup signed callback, atomic net cash/security/kit, protected deposit source, replay, unpaid withdrawal, lost-response recovery and transactional lease reacquisition/provider-read stock races, admin-only immutable refund concession, separate full deposit return, original bank reversal locks and exact closure replay. No external writes.');
}
module.exports={fixture,pay,finish,bankCallback,t,refunds,ops,security,getCreates:()=>creates,setStatus:s=>{nextStatus=s;}};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
