const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const Stripe=require('stripe');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');

(async()=>{
 const key=process.env.STRIPE_TEST_SECRET_KEY;
 if(!/^(sk|rk)_test_/.test(key??''))throw Error('A Stripe test-mode key is required. Live keys are rejected.');
 process.env.STRIPE_SECRET_KEY=key;process.env.ADMIN_TOKEN='sandbox-admin';process.env.INVENTORY_CONFLICT_REFUND_ENABLED='true';
 const run=randomUUID(),stripe=new Stripe(key),booking=put('bookings',{_id:`bookings-${run}`,status:'pending_verification',verificationConfirmationIssue:'inventory_unavailable',guestEmail:'sandbox-only@example.invalid',stripeCheckoutSessionId:`cs_fixture_${run}`,currency:'GBP',total:5,depositAmount:0,lineItems:[]});
 const payment=await stripe.paymentIntents.create({amount:500,currency:'gbp',payment_method:'pm_card_visa',confirm:true,automatic_payment_methods:{enabled:true,allow_redirects:'never'},metadata:{bookingId:String(booking._id),fixture:'dbc_inventory_refund_test',run}},{idempotencyKey:`dbc-inventory-payment-${run}`});
 assert.equal(payment.livemode,false);assert.equal(payment.status,'succeeded');booking.stripePaymentIntentId=payment.id;
 const session={id:booking.stripeCheckoutSessionId,status:'complete',payment_status:'paid',payment_intent:payment.id,currency:'gbp',amount_total:500,metadata:{bookingId:String(booking._id)}};
 class FixtureStripe extends Stripe{constructor(secret){super(secret);this.checkout.sessions.retrieve=async id=>{assert.equal(id,session.id);return session;};}}
 setMock('stripe',{default:FixtureStripe});
 const bookings=load('convex/bookings.ts'),checkout=load('convex/checkout.ts'),recovery=load('convex/cancellationRecovery.ts'),admin=load('convex/adminAuth.ts');
 const scheduled=[];const ctx={db,scheduler:{runAfter:async(...args)=>{scheduled.push(args);}}};
 const modules={bookings,cancellationRecovery:recovery,adminAuth:admin};
 ctx.runQuery=async(ref,args)=>{const [module,name]=ref.split('.');if(!modules[module]?.[name])throw Error(`Unexpected query ${ref}`);return modules[module][name].handler(ctx,args);};
 ctx.runMutation=async(ref,args)=>{const [module,name]=ref.split('.');if(!modules[module]?.[name])throw Error(`Unexpected mutation ${ref}`);return modules[module][name].handler(ctx,args);};
 const args={token:process.env.ADMIN_TOKEN,bookingId:booking._id,reason:'Fixture inventory unavailable',confirmed:true};
 const result=await checkout.refundInventoryConflict.handler(ctx,args);
 assert.equal(result.ok,true);assert.equal(booking.status,'cancelled');
 const receipts=await stripe.refunds.list({payment_intent:payment.id});assert.equal(receipts.data.length,1);assert.equal(receipts.data[0].amount,500);assert.equal(receipts.data[0].status,'succeeded');
 await checkout.refundInventoryConflict.handler(ctx,args);assert.equal((await stripe.refunds.list({payment_intent:payment.id})).data.length,1);
 console.log('PASS actual inventory-conflict handler with Stripe test-mode payment/refund and idempotent retry; checkout-session read is synthetic and scheduler does not execute emails.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
