const assert=require('node:assert/strict');
const test=require('./test-refunded-rental-swap.cjs');
const {fixture,ctx,swaps,ops,checkout,h,provider,jobs}=test;
async function blockedSwap(){
 const target=[...h.docs.values()].find(r=>r.title==="Lower-priced camera");target.depositAmount=500;
 const x=await fixture();await swaps.prepareRefundSwap.handler(ctx,x.args);
 const listing=h.docs.get(x.row.targetListingId),unit=h.docs.get(listing.components[0].inventoryUnitId);
 unit.quantityOwned=0;test.setProviderStatus('succeeded');
 const result=await checkout.refundSwap.handler(ctx,x.args);assert.equal(result.needsReview,true);
 unit.quantityOwned=100;return x;
}
const stock=x=>h.tables.get('reservations').filter(r=>r.bookingId===x.b._id&&r.status==='confirmed');
async function run(){
 assert(swaps.closeRefundOnlySwap,'An already refunded, unfulfilled swap needs a real owner closure');
 const x=await blockedSwap(),refund=h.docs.get(x.row.settlementRefundId),reason='Replacement cannot be supplied; keep the original kit and the completed refund.';
 const args={...x.args,reason};
 const before=JSON.stringify({lines:x.b.lineItems,total:x.b.total,subtotal:x.b.subtotal,deposit:x.b.depositAmount,hold:x.b.depositHoldAmount});
 const refunds=provider.size;
 await assert.rejects(swaps.closeRefundOnlySwap.handler(ctx,{...args,token:x.token}),/unauthorized/);
 assert(x.b.activeSwapRefundId);assert.equal(x.row.state,'accepted');
 await assert.rejects(swaps.closeRefundOnlySwap.handler(ctx,{...args,reason:'x'}),/reason/);
 const part=refund.parts[0];part.status='pending';await assert.rejects(swaps.closeRefundOnlySwap.handler(ctx,args),/confirmed|refund/);part.status='succeeded';
 refund.amountPence=1999;await assert.rejects(swaps.closeRefundOnlySwap.handler(ctx,args),/amount|proposal/);refund.amountPence=2000;
 const held=stock(x).find(r=>r.externalRef===`swap-refund:${refund._id}`);held.status='active';await assert.rejects(swaps.closeRefundOnlySwap.handler(ctx,args),/handover|return/);held.status='confirmed';
 const result=await swaps.closeRefundOnlySwap.handler(ctx,args);
 assert.equal(result.closed,true);assert.equal(result.refunded,20);assert.equal(x.row.state,'withdrawn');assert.equal(x.b.activeSwapRefundId,undefined);
 assert.equal(JSON.stringify({lines:x.b.lineItems,total:x.b.total,subtotal:x.b.subtotal,deposit:x.b.depositAmount,hold:x.b.depositHoldAmount}),before,'Original kit, captured cash and security do not change');
 assert.equal(stock(x).length,2,'Only the replacement allocation is released');
 assert.equal(stock(x).reduce((n,r)=>n+r.qty,0),4,'Original two bodies and two shared accessories remain reserved');
 assert.equal(refund.status,'succeeded');assert.equal(refund.amountPence,2000);assert.equal(provider.size,refunds,'Closure creates no financial operation');
 assert.equal(x.row.refundOnlyResolution.reason,reason);assert.equal(x.row.refundOnlyResolution.refundedPence,2000);assert.equal(x.row.holdTotalPence,15000,'Unapplied replacement proposal has a lower hold');assert.equal(x.row.refundOnlyResolution.securityAtClosure.holdPence,20000,'Record the original agreed hold, not the unapplied replacement hold');
 const owner=await swaps.proposal.handler(ctx,{...x.args,admin:true}),renter=await swaps.proposal.handler(ctx,{...x.args,token:x.token,admin:false});
 assert.equal(owner.refundOnlyResolution.amount,20);assert.equal(renter.refundOnlyResolution.reason,reason);assert.equal('operationKey' in renter.refundOnlyResolution,false);assert.equal(renter.refundSettlement.error,undefined);
 const receipt=JSON.stringify([x.b,x.row,stock(x),jobs,h.tables.get('messages')]);
 await swaps.closeRefundOnlySwap.handler(ctx,args);await swaps.finishRefundSwap.handler(ctx,{id:refund._id});await checkout.refundSwap.handler(ctx,x.args);
 assert.equal(JSON.stringify([x.b,x.row,stock(x),jobs,h.tables.get('messages')]),receipt,'Retries and late callbacks cannot reopen the swap or send another notice');
 await assert.rejects(swaps.closeRefundOnlySwap.handler(ctx,{...args,reason:'Different decision'}),/saved|reason/);
 const next=await ops.prepareRefund.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:x.b._id,requestId:'refund-after-closed-swap-remaining',reason:'Remaining cash after the closed swap'});assert.equal(next.amountPence,6000,'Remaining cash deducts the completed refund once');
 const pending=await fixture();test.setProviderStatus('pending');await checkout.refundSwap.handler(ctx,pending.args);
 await assert.rejects(swaps.closeRefundOnlySwap.handler(ctx,{...pending.args,reason}),/confirmed|refund/);assert(pending.b.activeSwapRefundId);
 const elapsed=await blockedSwap(),clock=Date.now;Date.now=()=>Date.UTC(2030,0,3);try{await swaps.closeRefundOnlySwap.handler(ctx,{...elapsed.args,reason:'Hire period elapsed before exchange; retain original kit and completed refund.'});assert.equal(elapsed.b.activeSwapRefundId,undefined);}finally{Date.now=clock;}
 const applied=await fixture();test.setProviderStatus('succeeded');await checkout.refundSwap.handler(ctx,applied.args);
 await assert.rejects(swaps.closeRefundOnlySwap.handler(ctx,{...applied.args,reason}),/closed|applied|settlement/);
 console.log('PASS real owner refund-only closure: confirmed provider refund, original kit/cash/security preserved, scoped replacement released, immutable replay, private receipt, real notices, subsequent refund cash, pending/applied denial. No external writes.');
}
module.exports={blockedSwap,...test};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
