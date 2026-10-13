const assert=require('node:assert/strict');const {load,db,put}=require('./lib/rentalTestHarness.cjs');
const policy=load('shared/rentalSecurity.ts'),consent=load('shared/savedCardSecurity.ts'),agreement=load('shared/rentalAgreement.ts'),{agreementsForSecurityPolicy}=load('src/lib/legal.ts');
process.env.ADMIN_TOKEN='dual-security-fixture-admin';const account=put('accounts',{email:'fixture@example.invalid'}),now=Date.now(),signed=now-4*86400000;
const base={customerName:'Fixture renter',customerEmail:account.email,billingAddress:'Fixture road, London',fulfilment:'pickup',pickupTime:'10:00',returnTime:'18:00',lineItems:[{listingId:'camera-fixture',title:'Camera',qty:1,start:now-3*86400000,end:now-86400000,lineTotal:100}],subtotal:100,deliveryFee:0,depositAmount:50,depositHoldAmount:0,currency:'GBP',securityPolicyVersion:policy.ASSESSMENT_SECURITY_POLICY_VERSION,savedCardLimit:0,savedCardConsentText:consent.assessmentConsentText(50),agreementName:'Fixture renter',agreementDocs:agreementsForSecurityPolicy(policy.ASSESSMENT_SECURITY_POLICY_VERSION),securityHoldConsent:true,laterChargeConsent:true};
const b=put('bookings',{...base,total:150,accountId:account._id,status:'returned',agreementSignedAt:signed,laterChargeConsentAt:signed,agreementSnapshot:agreement.snapshotAgreement(base,signed,150,0),savedCardStatus:'saved',savedCardCustomerId:'cus_fixture',savedCardPaymentMethodId:'pm_fixture',pickedUpAt:now-3*86400000,actualReturnedAt:now-86400000,replacementValues:[{listingId:'camera-fixture',unitPence:250000}],depositRefunded:true,depositKept:50,depositRefundAmount:0,returnDecision:{damageKept:175,inspection:[{condition:'issue',note:'Fixture inspected housing damage'}]},lateFeeAmount:100});
const state=load('convex/securityChargeState.ts');const ctx={db,scheduler:{runAfter:async()=>{}}};let serial=0;
const prep=(kind,amount)=>state.prepare.handler(ctx,{token:process.env.ADMIN_TOKEN,bookingId:b._id,requestId:'dual-fixture-request-'+(++serial),kind,amount,reason:'Fixture evidenced condition assessment.'});
(async()=>{
 assert.equal(consent.assertSavedCardConsent(b),0);assert.equal(consent.retainedDepositPence(b),5000);consent.assertSavedCardCollection(b);
 await assert.rejects(prep('damage',126),/remaining recorded assessment/);
 const damage=await prep('damage',125);
 
 const late=await prep('late',100);assert.equal(b.savedCardChargeReservedPence,22500);
 await assert.rejects(prep('damage',1),/remaining recorded assessment/);
 for(const bad of [-1,NaN,51,0.001])assert.throws(()=>consent.retainedDepositPence({...b,depositKept:bad}));
 assert.throws(()=>consent.assertSavedCardCollection({...b,depositRefunded:false}),/Finish the refundable deposit settlement/);
 assert.throws(()=>consent.assertSavedCardConsent({...b,depositAmount:100}),/missing or inconsistent/);
 const row=await db.get(damage);Object.assign(row,{state:'notice_sent',noticeAt:now-8*86400000,collectAfter:now-1});
 assert.equal((await state.claim.handler(ctx,{id:damage})).amountPence,12500);
 assert((await db.get(late)).state==='notice_pending');
 console.log('PASS actual dual-policy consent/prepare/claim: retained cash offsets same damage and future assessment amounts exceeding the former 10% cap, unfinished settlements blocked, malformed cash rejected, no provider calls.');
})().catch(e=>{console.error(e);process.exitCode=1});
