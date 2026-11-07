const assert=require('node:assert/strict');
const {load,db,put,setMock}=require('./lib/rentalTestHarness.cjs');
let creates=0,session;
class Stripe{
 constructor(){
  this.checkout={sessions:{retrieve:async()=>session}};
  this.paymentIntents={retrieve:async id=>({id,status:'succeeded',currency:'gbp',amount_received:5000,metadata:{bookingId:session.metadata.bookingId}})};
  this.refunds={list:()=>({async *[Symbol.asyncIterator](){}}),create:async()=>{creates++;throw {raw:{code:'approval_required',message:'Approval required: https://dashboard.stripe.com/settings/approvals/requests/apreq_fixture'}}}};
 }
 async rawRequest(){return {id:'apreq_fixture',object:'v2.core.approval_request',action:'refund.create',status:'pending_approval'};}
}
setMock('stripe',{default:Stripe});process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.ADMIN_TOKEN='fixture-owner';process.env.INVENTORY_CONFLICT_REFUND_ENABLED='true';
const bookings=load('convex/bookings.ts'),checkout=load('convex/checkout.ts'),recovery=load('convex/cancellationRecovery.ts');
const b=put('bookings',{status:'pending_verification',verificationConfirmationIssue:'inventory_unavailable',guestEmail:'guest@example.invalid',stripeCheckoutSessionId:'cs_fixture',stripePaymentIntentId:'pi_fixture',currency:'GBP',total:50,creditApplied:20,checkoutCreditState:'unspent',depositAmount:0,lineItems:[]});
const account=put('accounts',{email:b.guestEmail});const credit=put('credits',{accountId:account._id,remaining:20,amount:20,status:'active',kind:'refund'});b.accountId=account._id;b.creditAllocations=[{creditId:credit._id,amount:20,kind:'refund'}];
session={id:'cs_fixture',status:'complete',payment_status:'paid',payment_intent:'pi_fixture',currency:'gbp',amount_total:5000,metadata:{bookingId:b._id}};
const ctx={db,scheduler:{runAfter:async()=>{}},runQuery:async(ref,args)=>{const [mod,name]=ref.split('.');if(mod==='bookings')return bookings[name].handler(ctx,args);if(mod==='cancellationRecovery')return recovery[name].handler(ctx,args);throw Error(ref);},runMutation:async(ref,args)=>{const [mod,name]=ref.split('.');if(mod==='adminAuth')return load('convex/adminAuth.ts')[name].handler(ctx,args);if(mod==='bookings')return bookings[name].handler(ctx,args);if(mod==='cancellationRecovery')return recovery[name].handler(ctx,args);throw Error(ref);}};
(async()=>{
 const args={token:process.env.ADMIN_TOKEN,bookingId:b._id,confirmed:true,reason:'Equipment unavailable'};
 await assert.rejects(checkout.refundInventoryConflict.handler(ctx,{...args,confirmed:false}),/confirm/i);
 session.metadata.bookingId='different';await assert.rejects(checkout.refundInventoryConflict.handler(ctx,args),/does not match/);assert.equal(creates,0);session.metadata.bookingId=b._id;
 b.checkoutCreditState=undefined;await assert.rejects(checkout.refundInventoryConflict.handler(ctx,args),/individual review/);b.checkoutCreditState='spent';await assert.rejects(checkout.refundInventoryConflict.handler(ctx,args),/individual review/);b.checkoutCreditState='unspent';b.paidConfirmedAt=1;await assert.rejects(checkout.refundInventoryConflict.handler(ctx,args),/individual review/);delete b.paidConfirmedAt;
 b.membershipCheckoutId='membership_fixture';await assert.rejects(checkout.refundInventoryConflict.handler(ctx,args),/individual review/);delete b.membershipCheckoutId;
 credit.revokedPendingPence=100;await assert.rejects(checkout.refundInventoryConflict.handler(ctx,args),/individual review/);credit.revokedPendingPence=0;credit.membershipGrantId='grant_fixture';
 await assert.rejects(checkout.refundInventoryConflict.handler(ctx,args),e=>e.data?.code==='CANCELLATION_PENDING');
 assert.equal(creates,1);assert.equal(b.status,'pending_verification');assert.equal(b.cancellationDecision.inventoryConflictRefund,true);
 assert.equal(b.cancellationDecision.quote.refundAmount,50);assert.equal(b.cancellationDecision.quote.creditAmount,0);
 await assert.rejects(checkout.refundInventoryConflict.handler(ctx,{...args,reason:'Changed reason'}),/Another cancellation decision/);assert.equal(creates,1);
 assert.deepEqual(await bookings.confirm.handler(ctx,{bookingId:b._id,paymentIntentId:'pi_fixture'}),{closed:true,duplicatePayment:false});
 await assert.rejects(checkout.refundInventoryConflict.handler(ctx,args),e=>e.data?.code==='CANCELLATION_PENDING');assert.equal(creates,1);
 console.log('PASS inventory-conflict refund freezes confirmation, checks original checkout, and retains Stripe approval without duplicate refund. Synthetic data only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
