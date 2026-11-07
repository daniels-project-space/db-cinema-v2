const assert = require('node:assert/strict');
const {load,db,put,setMock} = require('./lib/rentalTestHarness.cjs');
process.env.ADMIN_TOKEN='fixture-admin';process.env.STRIPE_SECRET_KEY='sk_test_fixture';
let changed=null,retrieved=0,customer='cus_fixture',email='member@example.invalid',status='canceled';
setMock('stripe',{default:class {constructor(){this.subscriptions={retrieve:async id=>{retrieved++;if(changed==='link')member.stripeSubscriptionId='sub_other';if(changed==='status')member.membershipStatus='past_due';return {id,customer,status,created:1000,metadata:{accountEmail:email,membershipTier:'pro'},items:{data:[]},cancel_at_period_end:false};}};}}});
const admin=load('convex/accountAdmin.ts'),checkout=load('convex/checkout.ts'),benefits=load('convex/membershipBenefits.ts');
const member=put('accounts',{email:'member@example.invalid',createdAt:1,stripeCustomerId:'cus_fixture',stripeSubscriptionId:'sub_fixture',membershipTier:'pro',membershipStatus:'active',membershipActive:true,membershipPaidThrough:9999999999999});
const ctx={db,runQuery:async(ref,args)=>{assert.equal(ref,'accounts._byEmail');return args.email===member.email?member:null;},runMutation:async(ref,args)=>{if(ref==='accountAdmin.billingPortalTarget')return admin.billingPortalTarget.handler(ctx,args);if(ref==='membershipBenefits.syncSubscription')return benefits.syncSubscription.handler(ctx,args);throw Error(`Unexpected mutation ${ref}`);}};
(async()=>{
 const args={token:'fixture-admin',accountId:member._id};
 await assert.rejects(checkout.adminRefreshMembership.handler(ctx,{...args,token:'bad'}),/unauthorized/);assert.equal(retrieved,0);
 customer='cus_foreign';await assert.rejects(checkout.adminRefreshMembership.handler(ctx,args),/does not match/);customer='cus_fixture';
 email='other@example.invalid';await assert.rejects(checkout.adminRefreshMembership.handler(ctx,args),/incomplete/);email=member.email;
 changed='link';await assert.rejects(checkout.adminRefreshMembership.handler(ctx,args),/billing link changed/);member.stripeSubscriptionId='sub_fixture';
 changed='status';await assert.rejects(checkout.adminRefreshMembership.handler(ctx,args),/status changed/);assert.equal(member.membershipStatus,'past_due');
 changed=null;member.membershipStatus='active';const result=await checkout.adminRefreshMembership.handler(ctx,args);assert.equal(result.status,'canceled');assert.equal(member.membershipStatus,'canceled');assert.equal(member.membershipActive,false);assert.equal(member.membershipPaidThrough,undefined);
 console.log('PASS admin Stripe membership refresh: authorization, provider ownership, concurrent relink/status fencing and real local state update; synthetic data only.');
})().catch(error=>{console.error(error);process.exitCode=1});
