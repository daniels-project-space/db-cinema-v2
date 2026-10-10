/** Real owner/consent/payment/stock handlers; isolated database and provider transport. */
const assert = require('node:assert/strict');
const h = require('./lib/rentalTestHarness.cjs');
process.env.ADMIN_TOKEN = 'paid-swap-owner';
process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
const sessions = new Map(), intents = new Map(), jobs = [];
let sessionCreates = 0, holdCreates = 0, refundCreates = 0;
class Stripe {
 checkout = {sessions: {
  create: async (params, opts) => {
   assert.equal(params.mode, 'payment');
   assert.equal(params.line_items[0].price_data.unit_amount, 2000, 'Only the agreed difference is charged');
   assert.equal(opts.idempotencyKey, 'dbc-addition-checkout-' + params.metadata.rentalAdditionId);
   const id = 'cs_swap_' + ++sessionCreates;
   const session = {id, status:'open', payment_status:'unpaid', currency:'gbp', amount_total:2000, customer:'cus_swap', metadata:params.metadata, url:'https://checkout.stripe.test/' + id};
   sessions.set(id, session); return session;
  }, retrieve: async id => { assert(sessions.has(id)); return sessions.get(id); },
  expire: async id => { const s=sessions.get(id);s.status='expired';return s; },
  list: async function* () { yield* sessions.values(); }
 }};
 paymentIntents = {retrieve: async id => {assert(intents.has(id));return intents.get(id);}, create:async()=>{holdCreates++;throw Error('No hold before pickup');}};
 refunds = {list:async function*(){}, create:async params=>{refundCreates++;return {id:'re_swap_'+refundCreates, payment_intent:params.payment_intent, amount:2000, currency:'gbp', status:'succeeded',metadata:params.metadata};}};
 webhooks = {constructEvent:(body,sig)=>{assert.equal(sig,'verified-fixture');return JSON.parse(body);}};
}
h.setMock('stripe', {__esModule:true, default:Stripe});
const swaps=h.load('convex/rentalSwaps.ts'), state=h.load('convex/rentalAdditionState.ts'), payments=h.load('convex/rentalAdditions.ts'), checkout=h.load('convex/checkout.ts');
const modules={rentalSwaps:swaps,rentalAdditionState:state,rentalAdditions:payments,adminAuth:h.load('convex/adminAuth.ts'),rentalOperations:h.load('convex/rentalOperations.ts'),pickupSecurity:h.load('convex/pickupSecurity.ts')};
const dispatch=async(ref,args)=>{const [m,f]=ref.split('.');assert(modules[m]?.[f],ref);return modules[m][f].handler(ctx,args);};
const ctx={db:h.db,scheduler:{runAfter:async(...args)=>jobs.push(args),runAt:async(...args)=>{jobs.push(args);return 'job_'+jobs.length;}},runQuery:dispatch,runMutation:dispatch,runAction:dispatch};
const start=Date.UTC(2030,0,1), end=start+86400000;
const oldUnit=h.put('inventory_units',{name:'Original body',quantityOwned:100}),targetUnit=h.put('inventory_units',{name:'Replacement body',quantityOwned:100}),shared=h.put('inventory_units',{name:'Shared battery',quantityOwned:100});
const catalog=(title,unit,daily)=>h.put('listings',{title,active:true,pricing:{daily},depositAmount:1000,components:[{inventoryUnitId:unit._id,qty:1},{inventoryUnitId:shared._id,qty:1}]});
const original=catalog('Original camera',oldUnit,20),replacement=catalog('Replacement camera',targetUnit,30);
async function fixture(){
 const account=h.put('accounts',{email:'paid-swap-'+h.docs.size+'@example.invalid'}),token='renter-'+account._id;
 h.put('sessions',{token,accountId:account._id,expiresAt:Date.now()+600000});
 const b=h.put('bookings',{accountId:account._id,guestEmail:account.email,status:'confirmed',subtotal:80,total:130,depositAmount:50,depositHoldAmount:200,protection:'verify',securityPolicyVersion:'2026-10-ten-percent-hold-v2',securityHoldPolicyVersion:'2026-10-pickup-hold-v1',securityHoldCustomerId:'cus_saved',securityHoldPaymentMethodId:'pm_saved',securityHoldGeneration:1,securityHoldAttempts:0,depositHoldStatus:'scheduled',pickupTime:'10:00',returnTime:'18:00',stripePaymentIntentId:'pi_original_'+account._id,lineItems:[{listingId:original._id,title:original.title,qty:2,start,end,lineTotal:80,dailyRate:40}]});
 b.securityHoldDueAt=h.load('shared/pickupSecurity.ts').pickupHoldAt(b);
 const window=h.load('convex/lib/stockWindows.ts').stockWindow({start,end,pickupTime:'10:00',returnTime:'18:00'},true);
 for(const unit of [oldUnit,shared])h.put('reservations',{bookingId:b._id,listingId:original._id,inventoryUnitId:unit._id,qty:2,...window,status:'confirmed',source:'site'});
 const request=h.put('rental_change_requests',{bookingId:b._id,accountId:account._id,kind:'items',status:'approved',createdAt:Date.now(),detail:'Swap one body',kitSelection:{change:'swap',listingId:replacement._id,lineIndex:0,quantity:1,note:'Upgrade one body',source:{listingId:original._id,qty:2,start,end},sourceListingId:original._id,sourceQty:2,sourceStart:start,sourceEnd:end,sourceTitle:original.title,additionTitle:replacement.title}});
 const args={token:process.env.ADMIN_TOKEN,bookingId:b._id,id:request._id};
 const q=await swaps.preview.handler(ctx,args);assert(q.available,q.reason);assert.equal(q.charge,20);
 const offered=await swaps.offer.handler(ctx,{...args,quoteKey:q.quoteKey});await swaps.respond.handler(ctx,{...args,token,quoteKey:q.quoteKey,decision:'accepted'});
 return {b,request,row:h.docs.get(offered.id),token,args:{...args,quoteKey:q.quoteKey},window};
}
function paid(session){session.status='complete';session.payment_status='paid';session.payment_intent='pi_'+session.id;intents.set(session.payment_intent,{id:session.payment_intent,status:'succeeded',currency:'gbp',amount:2000,amount_received:2000,amount_capturable:0,capture_method:'automatic',customer:session.customer});}
const stock=(x,status)=>h.tables.get('reservations').filter(r=>r.bookingId===x.b._id&&r.status===status);
async function run(){
 assert(payments.startPaidSwap,'A consented paid swap needs a real checkout executor');
 const x=await fixture();await assert.rejects(payments.startPaidSwap.handler(ctx,{...x.args,token:x.token}),/unauthorized|admin/i);
 const first=await payments.startPaidSwap.handler(ctx,x.args),addition=h.docs.get(first.id),session=sessions.get(addition.sessionId);
 assert.equal(addition.swapProposalId,x.row._id);assert.equal(x.row.settlementAdditionId,addition._id);assert.equal(x.b.activeAdditionId,addition._id);
 assert.equal(x.b.lineItems.length,1);assert.equal(x.b.total,130);assert.equal(stock(x,'confirmed').find(r=>r.inventoryUnitId===oldUnit._id).qty,2,'Original kit remains reserved until payment');
 const holds=stock(x,'hold');assert.equal(holds.length,1);assert.equal(holds[0].inventoryUnitId,targetUnit._id);assert.equal(holds[0].qty,1,'Shared accessories are not held twice');
 assert.equal(holds[0].end,x.window.end);assert.equal(holds[0].turnaroundBufferMinutes,60);
 await assert.rejects(swaps.withdrawOffer.handler(ctx,x.args),/settlement|withdraw/i);
 const replay=await payments.startPaidSwap.handler(ctx,x.args);assert.equal(replay.id,first.id);assert.equal(sessionCreates,1);assert.equal(stock(x,'hold').length,1);
 paid(session);const event={type:'checkout.session.completed',data:{object:session}};
 assert.equal(await checkout.stripeWebhook.handler(ctx,{body:JSON.stringify(event),sig:'verified-fixture'}),true);
 assert.equal(x.row.state,'applied');assert.equal(addition.status,'applied');assert.equal(x.request.execution.operation,'kit_swap');assert.equal(x.request.execution.status,'applied');
 assert.equal(x.b.total,150);assert.equal(x.b.subtotal,100);assert.equal(x.b.depositAmount,50);assert.equal(x.b.depositHoldAmount,200);assert.equal(x.b.activeAdditionId,undefined);
 assert.equal(x.b.lineItems.length,2);assert.equal(x.b.lineItems[0].listingId,original._id);assert.equal(x.b.lineItems[0].qty,1);assert.equal(x.b.lineItems[1].listingId,replacement._id);assert.equal(x.b.lineItems[1].lineTotal,60);
 assert.equal(stock(x,'confirmed').filter(r=>r.inventoryUnitId===shared._id).reduce((n,r)=>n+r.qty,0),2);assert.equal(stock(x,'hold').length,0);
 const sources=await h.load('convex/lib/rentalPaymentSources.ts').rentalPaymentSources(ctx,x.b);assert(sources.some(p=>p.paymentIntentId===session.payment_intent&&p.maxPaidPence===2000&&p.securityPence===0));
 const final=await checkout.finalize.handler(ctx,{sessionId:session.id});assert.equal(final.updateApplied,true,'Post-checkout receipt must attest the actual committed swap');assert.equal(final.updateKind,'swap');assert.equal(final.holdStatus,'scheduled','Future hold is not an unapplied kit');
 const receipt=JSON.stringify([x.b,x.row,x.request,stock(x,'confirmed'),jobs]);await checkout.stripeWebhook.handler(ctx,{body:JSON.stringify(event),sig:'verified-fixture'});assert.equal(JSON.stringify([x.b,x.row,x.request,stock(x,'confirmed'),jobs]),receipt,'Duplicate webhook cannot double-charge, replace stock or send another notice');
 assert.equal(holdCreates,0);assert.equal(refundCreates,0);
 x.b.depositHoldStatus='failed';const later=await checkout.finalize.handler(ctx,{sessionId:session.id});assert.equal(later.updateApplied,true,'A later card issue does not undo a committed equipment update');assert.equal(later.holdStatus,'failed');x.b.depositHoldStatus='scheduled';
 const stale=await fixture();stale.b.returnTime='19:00';await assert.rejects(payments.startPaidSwap.handler(ctx,stale.args),/changed|proposal/);assert.equal(stale.b.activeAdditionId,undefined);
 const unpaid=await fixture();const attempt=await payments.startPaidSwap.handler(ctx,unpaid.args);await payments.withdrawByOwner.handler(ctx,{token:process.env.ADMIN_TOKEN,id:attempt.id});assert.equal(unpaid.row.state,'withdrawn');assert.equal(unpaid.b.lineItems.length,1);assert.equal(unpaid.b.activeAdditionId,undefined);assert.equal(stock(unpaid,'hold').length,0);
 const changed=await fixture();const started=await payments.startPaidSwap.handler(ctx,changed.args);const paidSession=sessions.get(h.docs.get(started.id).sessionId);paid(paidSession);targetUnit.quantityOwned=0;await payments.finalizePaid.handler(ctx,{id:started.id,sessionId:paidSession.id});assert.equal(changed.b.lineItems.length,1);assert.equal(changed.row.state,'withdrawn');assert.equal(changed.b.total,130);assert.equal(h.docs.get(started.id).status,'refunded');assert.equal(refundCreates,1);const withdrawn=await checkout.finalize.handler(ctx,{sessionId:paidSession.id});assert.equal(withdrawn.closed,true);assert.equal(withdrawn.additionId,started.id);assert.equal(withdrawn.updateApplied,false);assert.equal(withdrawn.updateKind,'swap');assert.equal(withdrawn.holdStatus,'refunded');targetUnit.quantityOwned=100;
 console.log('PASS actual paid pre-pickup swap: owner/consent binding, difference-only checkout, net physical holds, signed webhook capture, atomic selected-kit exchange, cash-source receipt, replay, unpaid withdrawal and failed-availability original-method refund. No external provider writes.');
}
module.exports={fixture,ctx,dispatch,paid,sessions,intents,h,swaps,payments,checkout,jobs};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
