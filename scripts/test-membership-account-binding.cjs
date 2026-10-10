const assert = require('node:assert/strict');
const h = require('./lib/rentalTestHarness.cjs');
const billing = h.load('convex/membershipBenefits.ts');
const Stripe = require('stripe');
const verifier = new Stripe('sk_test_isolated_membership_fixture');
let providerSub, providerInvoice, providerLines = [];
h.setMock('stripe',{__esModule:true,default:class {
  webhooks = verifier.webhooks;
  subscriptions = {retrieve:async id=>{assert.equal(id,providerSub.id);return providerSub}};
  invoices = {
    retrieve:async id=>{assert.equal(id,providerInvoice.id);return providerInvoice},
    listLineItems:()=>({async *[Symbol.asyncIterator](){yield* providerLines}}),
  };
  creditNotes = {list:()=>({async *[Symbol.asyncIterator](){}})};
}});
const checkout = h.load('convex/checkout.ts');
const ctx = {db:h.db};
const owner = h.put('accounts',{email:'new-contact@example.invalid',stripeCustomerId:'cus_owner',stripeSubscriptionId:'sub_owner',membershipActive:true});
const recycled = h.put('accounts',{email:'old-contact@example.invalid',stripeCustomerId:'cus_other'});
const reservation = h.put('membership_checkouts',{accountId:owner._id,tier:'pro',intro:'none',subscriptionId:'sub_owner',state:'complete'});
const base = {subscriptionId:'sub_owner',customerId:'cus_owner',email:recycled.email};
const resolve = args => billing.subscriptionAccount.handler(ctx,args);
(async()=>{
  assert.equal((await resolve(base))._id,owner._id,'Existing subscription remains with permanent owner after email change/reuse');
  assert.equal((await resolve({...base,accountId:owner._id,checkoutId:reservation._id}))._id,owner._id);
  await assert.rejects(resolve({...base,accountId:recycled._id}),/ownership mismatch/);
  const foreign = h.put('membership_checkouts',{accountId:recycled._id,tier:'pro',intro:'none'});
  await assert.rejects(resolve({...base,checkoutId:foreign._id}),/ownership mismatch/);
  await assert.rejects(resolve({...base,customerId:'cus_other'}),/customer does not match/);
  await assert.rejects(resolve({...base,subscriptionId:'sub_other',checkoutId:reservation._id}),/subscription mismatch/);
  assert.equal(await resolve({...base,accountId:'accounts-deleted'}),null,'Deleted permanent owner never falls back to historical email');
  assert.equal(await resolve({...base,checkoutId:'membership_checkouts-deleted'}),null);
  assert.equal(await resolve({...base,accountId:'not-an-account-id'}),null);
  const fresh = h.put('accounts',{email:'fresh-contact@example.invalid',stripeCustomerId:'cus_fresh'});
  const freshCheckout = h.put('membership_checkouts',{accountId:fresh._id,tier:'pro',intro:'none',state:'open'});
  assert.equal((await resolve({subscriptionId:'sub_fresh',customerId:'cus_fresh',checkoutId:freshCheckout._id,email:recycled.email}))._id,fresh._id,'First event resolves checkout owner before subscription ID is bound');
  assert.equal((await resolve({subscriptionId:'sub_legacy',customerId:'cus_fresh',email:fresh.email.toUpperCase()}))._id,fresh._id,'Legacy fallback still requires exact Stripe customer');
  assert.equal(await resolve({subscriptionId:'sub_external',customerId:'cus_external',email:'external@example.invalid'}),null);
  const actionCtx={
    runQuery:async(ref,args)=>{assert.equal(ref,'membershipBenefits.subscriptionAccount');return resolve(args)},
    runMutation:async(ref,args)=>{
      if(ref==='membershipBenefits.syncSubscription')return billing.syncSubscription.handler(ctx,args);
      if(ref==='membershipBenefits.grantPaidInvoice')return billing.grantPaidInvoice.handler(ctx,args);
      throw Error('Unexpected mutation '+ref);
    },
  };
  await checkout.syncStripeMembership(actionCtx,{id:'sub_owner',customer:{id:'cus_owner'},metadata:{membershipTier:'pro',accountId:owner._id,accountEmail:recycled.email,membershipCheckoutId:reservation._id},status:'canceled',created:100,cancel_at_period_end:false,items:{data:[]}});
  assert.equal(owner.membershipStatus,'canceled','Actual subscription lifecycle caller updates permanent owner');
  assert.equal(recycled.membershipStatus,undefined,'Reused contact address receives no entitlement/status writes');
  await assert.rejects(checkout.syncStripeMembership(actionCtx,{id:'sub_owner',customer:'cus_owner',metadata:{membershipTier:'pro',membershipCheckoutId:reservation._id},items:{data:[]}},foreign._id),/checkout ownership mismatch/);
  process.env.STRIPE_SECRET_KEY='sk_test_isolated_membership_fixture';
  process.env.STRIPE_WEBHOOK_SECRET='whsec_isolated_membership_fixture';
  providerSub={id:'sub_owner',customer:'cus_owner',metadata:{membershipTier:'pro',accountId:owner._id,accountEmail:recycled.email,membershipCheckoutId:reservation._id},status:'active',created:100,cancel_at_period_end:false,latest_invoice:'in_binding',items:{data:[{id:'si_binding'}]}};
  providerInvoice={id:'in_binding',status:'paid',currency:'gbp',amount_paid:4900,billing_reason:'subscription_cycle',parent:{subscription_details:{subscription:'sub_owner'}}};
  providerLines=[{amount:4900,currency:'gbp',discount_amounts:[],parent:{type:'subscription_item_details',subscription_item_details:{subscription_item:'si_binding',proration:false}},period:{start:Math.floor(Date.now()/1000),end:Math.floor(Date.now()/1000)+30*86400}}];
  const body=JSON.stringify({id:'evt_binding',type:'invoice.paid',data:{object:{id:'in_binding'}}});
  const sig=verifier.webhooks.generateTestHeaderString({payload:body,secret:process.env.STRIPE_WEBHOOK_SECRET});
  assert.equal(await checkout.stripeWebhook.handler(actionCtx,{body,sig}),true);
  assert.equal(await checkout.stripeWebhook.handler(actionCtx,{body,sig}),true);
  const grants=h.tables.get('membership_credit_grants');
  assert.equal(grants.length,1,'Repeated signed invoice event grants credit once');
  assert.equal(grants[0].accountId,owner._id);
  assert.equal(grants[0].creditPence,5880);
  assert.equal(owner.membershipActive,true);
  assert.equal(recycled.membershipActive,undefined);
  await h.db.patch(owner._id,{stripeCustomerId:'cus_changed_during_action'});
  await assert.rejects(billing.syncSubscription.handler(ctx,{accountId:owner._id,customerId:'cus_owner',subscriptionId:'sub_owner',tier:'pro',status:'canceled',subscriptionCreatedAt:100,cancelAtPeriodEnd:false}),/customer does not match/);
  await assert.rejects(billing.grantPaidInvoice.handler(ctx,{accountId:owner._id,customerId:'cus_owner',subscriptionId:'sub_owner',invoiceId:'in_raced',paidMembershipPence:4900,periodEnd:Date.now()+86400000}),/customer does not match/);
  assert.equal(grants.length,1,'A changed billing owner cannot mint another credit');
  assert.equal(owner.membershipStatus,'active','Transactional customer fence rejects stale lifecycle writes');
  console.log('PASS permanent membership ownership and actual signed paid-invoice webhook: changed/reused emails, first checkout event, legacy customer guard, conflicting/deleted owners, lifecycle updates and exactly-once credit. No provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
