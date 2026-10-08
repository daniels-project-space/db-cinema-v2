const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const {ensureCheckoutCustomer}=h.load('convex/lib/stripeCustomer.ts');
const accounts=h.load('convex/accounts.ts');
const missing=()=>Object.assign(new Error('No such customer'),{type:'StripeInvalidRequestError',code:'resource_missing',statusCode:404,param:'id'});
const account=structuredClone(h.put('accounts',{email:'recovery@example.invalid',name:'Recovery renter',stripeCustomerId:'cus_old'}));
const created=[],updated=[],bound=[];
let retrieval=async()=>{throw missing()};
const customer={id:'cus_live',deleted:false,metadata:{dbcAccountId:account._id}};
const stripe={customers:{retrieve:async(id)=>retrieval(id),create:async(params,opts)=>{created.push({params,opts});return customer},update:async(id,params)=>{updated.push({id,params});return customer}}};
const ctx={db:h.db};
const bind=async(customerId,expectedCustomerId)=>{bound.push({customerId,expectedCustomerId});await accounts._bindCheckoutCustomer.handler(ctx,{accountId:account._id,customerId,expectedCustomerId})};
const errorCode=code=>error=>error.data?.code===code;
(async()=>{
 assert.equal(await ensureCheckoutCustomer(stripe,{...account},bind),'cus_live');
 assert.equal((await h.db.get(account._id)).stripeCustomerId,'cus_live');
 assert.deepEqual(created[0].params,{metadata:{dbcAccountId:account._id,application:'db-cinema-rentals'}});
 assert.deepEqual(updated[0],{id:'cus_live',params:{email:account.email,name:account.name}});
 // A lost response reuses stable creation parameters/key and an already bound
 // recovery is idempotent. Contact changes do not change creation parameters.
 await ensureCheckoutCustomer(stripe,{...account,email:'changed@example.invalid'},bind);
 assert.deepEqual(created[0],created[1]);assert.equal(updated[1].params.email,'changed@example.invalid');
 retrieval=async()=>customer;assert.equal(await ensureCheckoutCustomer(stripe,{...account,stripeCustomerId:'cus_live'},bind),'cus_live');assert.equal(created.length,2);
 retrieval=async()=>({...customer,metadata:{dbcAccountId:'other-account'}});await assert.rejects(ensureCheckoutCustomer(stripe,account,bind),errorCode('BILLING_ACCOUNT_MISMATCH'));assert.equal(created.length,2);
 for(const failure of [Object.assign(missing(),{statusCode:403}),Object.assign(missing(),{param:'price'}),Object.assign(new Error('Unavailable'),{type:'StripeAPIError',statusCode:500}),new Error('Network'),new TypeError('bad transport')]){
  retrieval=async()=>{throw failure};await assert.rejects(ensureCheckoutCustomer(stripe,account,bind),errorCode('BILLING_UNAVAILABLE'));assert.equal(created.length,2);
 }
 retrieval=async()=>{throw missing()};await assert.rejects(ensureCheckoutCustomer(stripe,{...account,stripeSubscriptionId:'sub_existing'},bind),errorCode('BILLING_ACCOUNT_REVIEW'));assert.equal(created.length,2);
 retrieval=async()=>({id:'cus_old',deleted:true});await ensureCheckoutCustomer(stripe,account,bind);assert.equal(created.length,3);
 await h.db.patch(account._id,{stripeCustomerId:'cus_newer'});
 retrieval=async()=>{throw missing()};await assert.rejects(ensureCheckoutCustomer(stripe,account,bind),errorCode('BILLING_ACCOUNT_CHANGED'));assert.equal((await h.db.get(account._id)).stripeCustomerId,'cus_newer');
 const newcomer=h.put('accounts',{email:'new@example.invalid'});const newBind=(customerId,expectedCustomerId)=>accounts._bindCheckoutCustomer.handler(ctx,{accountId:newcomer._id,customerId,expectedCustomerId});await ensureCheckoutCustomer(stripe,newcomer,newBind);assert.equal((await h.db.get(newcomer._id)).stripeCustomerId,'cus_live');
 await h.db.patch(newcomer._id,{stripeCustomerId:'cus_prior',stripeSubscriptionId:'sub_active'});await assert.rejects(newBind('cus_other','cus_prior'),errorCode('BILLING_ACCOUNT_CHANGED'));assert.equal((await h.db.get(newcomer._id)).stripeCustomerId,'cus_prior');
 await h.db.patch(account._id,{blockedAt:Date.now()});await assert.rejects(bind('cus_other','cus_newer'),errorCode('BILLING_ACCOUNT_UNAVAILABLE'));
 console.log('PASS actual Stripe customer recovery and account binding: missing/deleted IDs, stable creation on retry/contact change, valid and foreign owners, permission/network failures, existing subscription protection, new accounts, stale concurrent writes and blocked accounts. No provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
