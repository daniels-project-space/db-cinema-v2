const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
h.setMock('./lib/loyalty',{loyaltyProgress:async()=>({eligible:false,level:0,percent:0,completed:0}),celebratedLoyaltyLevel:()=>0,ENCORE_POLICY_VERSION:'fixture'});
const accounts=h.load('convex/accounts.ts'),checkout=h.load('convex/checkout.ts'),identity=h.load('convex/identity.ts'),{SECURITY_POLICY_VERSION}=h.load('shared/rentalSecurity.ts');
const owner=h.put('accounts',{email:'owner@example.invalid'}),foreign=h.put('accounts',{email:'other@example.invalid'}),blocked=h.put('accounts',{email:'blocked@example.invalid',blockedAt:Date.now()}),unverified=h.put('accounts',{email:'unverified@example.invalid',emailVerificationRequired:true});
for(const [token,account,expiresAt] of [['owner',owner,Date.now()+60000],['foreign',foreign,Date.now()+60000],['blocked',blocked,Date.now()+60000],['expired',owner,Date.now()-1],['unverified',unverified,Date.now()+60000]])h.put('sessions',{token,accountId:account._id,expiresAt});
const dbctx={db:h.db},booking={_id:'bookings-fixture',accountId:owner._id,status:'confirmed',securityPolicyVersion:SECURITY_POLICY_VERSION};let calls=0;
const ctx={runQuery:async(ref,args)=>{if(ref==='accounts._byToken')return accounts._byToken.handler(dbctx,args);if(ref==='savedCardState.context')return booking;throw Error('Unexpected query '+ref)},runMutation:async()=>{throw Error('Unexpected mutation')},runAction:async(ref)=>{assert.equal(ref,'checkout.prepareSavedCard');calls++}};
(async()=>{
 assert.equal((await accounts._byToken.handler(dbctx,{token:'owner'}))._id,owner._id);assert.equal((await accounts._byToken.handler(dbctx,{token:'foreign'}))._id,foreign._id);
 for(const token of ['blocked','expired','unverified','missing'])assert.equal(await accounts._byToken.handler(dbctx,{token}),null,token);
 for(const token of ['blocked','expired','unverified','missing','foreign'])await assert.rejects(checkout.retrySavedCard.handler(ctx,{token,bookingId:booking._id}),/access denied/i);
 await checkout.retrySavedCard.handler(ctx,{token:'owner',bookingId:booking._id});assert.equal(calls,1,'only owning active session reaches card handler');
 for(const token of ['blocked','expired','unverified','missing'])await assert.rejects(identity.createAccountSession.handler(ctx,{token,origin:'https://fixture.invalid'}),/sign in/i);
 const old=process.env.RENTAL_CHECKOUT_ENABLED;process.env.RENTAL_CHECKOUT_ENABLED='true';try{for(const token of ['blocked','expired','unverified','missing'])await assert.rejects(checkout.startMembership.handler(ctx,{token,tier:'pro',origin:'https://fixture.invalid'}),/sign in/i)}finally{if(old===undefined)delete process.env.RENTAL_CHECKOUT_ENABLED;else process.env.RENTAL_CHECKOUT_ENABLED=old}
 console.log('PASS synthetic account authorization: valid, foreign, blocked, expired, unverified and missing sessions through account, card, identity and membership handlers; no providers called.');
})().catch(error=>{console.error(error);process.exitCode=1});
