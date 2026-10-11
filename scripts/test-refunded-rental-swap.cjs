const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
process.env.ADMIN_TOKEN='refunded-swap-owner';process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.STRIPE_WEBHOOK_SECRET='whsec_fixture';
const provider=new Map(),keys=new Map(),jobs=[];let creates=0,loseResponse=false,nextStatus='succeeded';
h.setMock('stripe',{default:class{
 webhooks={constructEvent:(body,sig)=>{assert.equal(sig,'verified-fixture');return JSON.parse(body);}};
 paymentIntents={retrieve:async id=>({id,status:'succeeded',currency:'gbp',amount_received:13000})};
 refunds={list:({payment_intent})=>[...provider.values()].filter(r=>r.payment_intent===payment_intent),retrieve:async id=>provider.get(id),create:async(params,{idempotencyKey})=>{
  creates++;assert.equal(params.amount,2000,'Refund only the agreed rental difference');
  let r=keys.get(idempotencyKey);if(!r){r={id:'re_swap_'+provider.size,status:nextStatus,currency:'gbp',amount:params.amount,payment_intent:params.payment_intent,metadata:params.metadata};keys.set(idempotencyKey,r);provider.set(r.id,r);}
  if(loseResponse){loseResponse=false;throw Error('Provider response lost');}return r;
 }};
}});
const swaps=h.load('convex/rentalSwaps.ts'),ops=h.load('convex/rentalOperations.ts'),checkout=h.load('convex/checkout.ts');
const modules={rentalSwaps:swaps,rentalOperations:ops,checkout,adminAuth:h.load('convex/adminAuth.ts'),bookings:h.load('convex/bookings.ts')};
const dispatch=async(ref,args)=>{const [m,f]=ref.split('.');if(ref==='filmFundPayments.reconcileRefund')return null;assert(modules[m]?.[f],ref);return modules[m][f].handler(ctx,args);};
const ctx={db:h.db,scheduler:{runAfter:async(...args)=>jobs.push(args),runAt:async(...args)=>{jobs.push(args);return 'job_'+jobs.length;}},runMutation:dispatch,runQuery:dispatch,runAction:dispatch};
const start=Date.UTC(2030,0,1),end=start+86400000;
const oldUnit=h.put('inventory_units',{name:'Original body',quantityOwned:100}),newUnit=h.put('inventory_units',{name:'Replacement body',quantityOwned:100}),shared=h.put('inventory_units',{name:'Shared accessory',quantityOwned:100});
const original=h.put('listings',{title:'Original camera',active:true,pricing:{daily:20},depositAmount:1000,components:[{inventoryUnitId:oldUnit._id,qty:1},{inventoryUnitId:shared._id,qty:1}]}),replacement=h.put('listings',{title:'Lower-priced camera',active:true,pricing:{daily:10},depositAmount:1000,components:[{inventoryUnitId:newUnit._id,qty:1},{inventoryUnitId:shared._id,qty:1}]});
async function fixture(){
 const account=h.put('accounts',{email:'refund-swap-'+h.docs.size+'@example.invalid'}),token='renter-'+account._id;h.put('sessions',{token,accountId:account._id,expiresAt:Date.now()+600000});
 const b=h.put('bookings',{accountId:account._id,status:'confirmed',subtotal:80,total:130,depositAmount:50,depositHoldAmount:200,securityPolicyVersion:'2026-10-ten-percent-hold-v2',securityHoldPolicyVersion:'2026-10-pickup-hold-v1',securityHoldCustomerId:'cus_saved',securityHoldPaymentMethodId:'pm_saved',securityHoldGeneration:1,depositHoldStatus:'scheduled',pickupTime:'10:00',returnTime:'18:00',stripePaymentIntentId:'pi_original_'+account._id,lineItems:[{listingId:original._id,title:original.title,qty:2,start,end,lineTotal:80,dailyRate:40}]});
 b.securityHoldDueAt=h.load('shared/pickupSecurity.ts').pickupHoldAt(b);
 const window=h.load('convex/lib/stockWindows.ts').stockWindow({...b.lineItems[0],pickupTime:b.pickupTime,returnTime:b.returnTime},true);
 for(const unit of [oldUnit,shared])h.put('reservations',{bookingId:b._id,listingId:original._id,inventoryUnitId:unit._id,qty:2,...window,status:'confirmed',source:'site'});
 const request=h.put('rental_change_requests',{bookingId:b._id,accountId:account._id,kind:'items',status:'approved',createdAt:Date.now(),detail:'Replace one camera',kitSelection:{change:'swap',listingId:replacement._id,lineIndex:0,quantity:1,note:'Lower-price replacement',source:{listingId:original._id,qty:2,start,end},sourceListingId:original._id,sourceQty:2,sourceStart:start,sourceEnd:end,sourceTitle:original.title,additionTitle:replacement.title}});
 const args={token:process.env.ADMIN_TOKEN,bookingId:b._id,id:request._id};const q=await swaps.preview.handler(ctx,args);assert(q.available,q.reason);assert.equal(q.refund,20);assert.equal(q.charge,0);
 const offered=await swaps.offer.handler(ctx,{...args,quoteKey:q.quoteKey});await swaps.respond.handler(ctx,{...args,token,quoteKey:q.quoteKey,decision:'accepted'});
 return {b,request,row:h.docs.get(offered.id),token,args:{...args,quoteKey:q.quoteKey},window};
}
const stock=x=>h.tables.get('reservations').filter(r=>r.bookingId===x.b._id&&r.status==='confirmed');
async function run(){
 assert(checkout.refundSwap,'Accepted cheaper swaps need an original-method refund executor');
 const x=await fixture();await assert.rejects(checkout.refundSwap.handler(ctx,{...x.args,token:x.token}),/unauthorized/i);
 loseResponse=true;await assert.rejects(checkout.refundSwap.handler(ctx,x.args),/response lost/);
 assert.equal(x.b.lineItems.length,1);assert.equal(x.b.total,130);assert.equal(x.row.state,'accepted');assert(x.b.activeSwapRefundId);
 assert.equal(stock(x).filter(r=>r.inventoryUnitId===newUnit._id).length,1,'Replacement is reserved through an uncertain bank outcome');
 assert.equal(stock(x).filter(r=>r.inventoryUnitId===shared._id).reduce((s,r)=>s+r.qty,0),2,'Shared accessory is not reserved twice');
 keys.clear();await checkout.refundSwap.handler(ctx,x.args);assert.equal(creates,1,'Lost-response replay retrieves the provider refund before another request');
 assert.equal(x.row.state,'applied');assert.equal(x.request.execution.status,'applied');assert.equal(x.b.activeSwapRefundId,undefined);assert.equal(x.b.lineItems.length,2);assert.equal(x.b.subtotal,60);
 assert.equal(x.b.total,130,'Captured gross payment is immutable; refund is accounted once in the existing ledger');
 const refund=h.docs.get(x.row.settlementRefundId);assert.equal(refund.amountPence,2000);assert.equal(refund.status,'succeeded');assert.equal(refund.parts[0].paymentIntentId,x.b.stripePaymentIntentId);assert.equal(x.b.depositAmount,50);
 const receipt=JSON.stringify([x.b,x.row,x.request,stock(x),jobs]);await checkout.refundSwap.handler(ctx,x.args);assert.equal(creates,1);assert.equal(JSON.stringify([x.b,x.row,x.request,stock(x),jobs]),receipt);
 const pending=await fixture();nextStatus='pending';await checkout.refundSwap.handler(ctx,pending.args);assert.equal(pending.row.state,'accepted');assert(pending.b.activeSwapRefundId);assert.equal(pending.b.lineItems.length,1);
 await assert.rejects(ops.reschedule.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:pending.b._id,start:start+86400000,end:end+86400000,pickupTime:'10:00',returnTime:'18:00',reason:'Move hire during refund'}),/open|settlement/i);
 const pendingJob=h.docs.get(pending.row.settlementRefundId),part=pendingJob.parts[0];provider.get(part.stripeRefundId).status='succeeded';
 const bank=provider.get(part.stripeRefundId),event={type:'refund.updated',data:{object:bank}};bank.amount=1999;await assert.rejects(checkout.stripeWebhook.handler(ctx,{body:JSON.stringify(event),sig:'verified-fixture'}),/does not match/);assert.equal(pendingJob.status,'pending');bank.amount=2000;
 await checkout.stripeWebhook.handler(ctx,{body:JSON.stringify(event),sig:'verified-fixture'});assert.equal(pending.row.state,'applied','Actual bank callback completes the reserved kit exchange');
 const raced=await fixture();nextStatus='succeeded';loseResponse=true;await assert.rejects(checkout.refundSwap.handler(ctx,raced.args),/response lost/);newUnit.quantityOwned=0;const writes=creates;const review=await checkout.refundSwap.handler(ctx,raced.args);assert.equal(review.needsReview,true);assert.equal(creates,writes);assert.equal(h.docs.get(raced.row.settlementRefundId).status,'succeeded','Bank result stays durable while inventory needs review');assert(raced.b.activeSwapRefundId);assert.equal(raced.b.lineItems.length,1);newUnit.quantityOwned=100;await checkout.refundSwap.handler(ctx,raced.args);assert.equal(raced.row.state,'applied');assert.equal(creates,writes,'Reconciliation finishes the kit without another refund');
 const remaining=await ops.prepareRefund.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:x.b._id,requestId:'remaining-rental-refund-after-swap',reason:'Remaining rental cash after swap'});assert.equal(remaining.amountPence,6000,'Refunded difference is deducted exactly once while security is protected');
 const failed=await fixture();nextStatus='failed';await checkout.refundSwap.handler(ctx,failed.args);assert(failed.b.activeSwapRefundId);await assert.rejects(swaps.withdrawFailedRefundSwap.handler(ctx,{...failed.args,token:failed.token}),/unauthorized/);await swaps.withdrawFailedRefundSwap.handler(ctx,failed.args);assert.equal(failed.row.state,'withdrawn');assert.equal(failed.b.activeSwapRefundId,undefined);assert.equal(stock(failed).filter(r=>r.inventoryUnitId===newUnit._id).length,0);assert.equal(failed.b.lineItems.length,1);
 const stale=await fixture();stale.b.returnTime='19:00';await assert.rejects(checkout.refundSwap.handler(ctx,stale.args),/changed|proposal/);assert.equal(stale.b.activeSwapRefundId,undefined);
 const foreign=await fixture();foreign.row.accountId='accounts-another';await assert.rejects(checkout.refundSwap.handler(ctx,foreign.args),/account|rental/);assert.equal(foreign.b.activeSwapRefundId,undefined);
 console.log('PASS original-method cheaper swap: owner/consent binding, net stock reservation, lost-response recovery, pending bank callback, gross-versus-net cash ledger, once-only kit exchange and foreign/stale denial. No external writes.');
}
module.exports={fixture,ctx,dispatch,swaps,ops,checkout,h,provider,jobs,setProviderStatus:status=>{nextStatus=status;}};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
