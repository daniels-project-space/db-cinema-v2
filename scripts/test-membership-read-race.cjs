const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
let releaseOld,readStarted;const started=new Promise(resolve=>readStarted=resolve),oldResult=new Promise(resolve=>releaseOld=resolve);
const base={id:'sub_race',customer:'cus_race',created:1000,metadata:{accountEmail:'race@example.invalid',membershipTier:'plus'},items:{data:[]},cancel_at_period_end:false};
let count=0;
class StripeFixture{
 webhooks={constructEvent:()=>({type:'customer.subscription.updated',data:{object:{id:'sub_race'}}})};
 subscriptions={retrieve:async()=>{if(++count===1){readStarted();await oldResult;return {...base,status:'active'};}return {...base,status:'canceled'};}};
 invoices={list:async()=>({data:[]})};
}
h.setMock('stripe',{default:StripeFixture});
const state=h.load('convex/membershipReconcileState.ts'),checkout=h.load('convex/checkout.ts'),accounts=h.load('convex/accounts.ts'),membershipBenefits=h.load('convex/membershipBenefits.ts');
const modules={membershipReconcileState:state,accounts,membershipBenefits},ctx={db:h.db,scheduler:{runAfter:async()=>{}},runQuery:async(ref,args)=>modules[ref.split('.')[0]][ref.split('.')[1]].handler(ctx,args),runMutation:async(ref,args)=>modules[ref.split('.')[0]][ref.split('.')[1]].handler(ctx,args)};
Object.assign(process.env,{STRIPE_SECRET_KEY:'synthetic',STRIPE_WEBHOOK_SECRET:'synthetic',MEMBERSHIP_BOUNDED_RECONCILE_ENABLED:'true'});
(async()=>{
 const account=h.put('accounts',{email:'race@example.invalid',stripeCustomerId:'cus_race',stripeSubscriptionId:'sub_race',membershipActive:true,membershipSubscriptionCreatedAt:1000000});
 await state.schedule.handler(ctx,{});const sweep=h.tables.get('membership_reconcile_sweeps')[0];
 const oldSweep=checkout.reconcileMemberships.handler(ctx,{generation:sweep.generation});await started;
 await checkout.stripeWebhook.handler(ctx,{body:'fixture',sig:'fixture'});assert.equal(account.membershipStatus,'canceled');
 releaseOld();await oldSweep;assert.equal(account.membershipStatus,'canceled');assert.equal(account.membershipActive,false,'older sweep must not undo a newer webhook');
 console.log('PASS actual subscription webhook versus delayed reconciliation: transaction generation prevents stale restoration.');
})().catch(error=>{console.error(error);process.exitCode=1});
