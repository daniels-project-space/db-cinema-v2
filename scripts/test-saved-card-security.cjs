/** Actual application handlers with isolated fixtures; no real customers or money. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {load, db, put, setMock} = require('./lib/rentalTestHarness.cjs');
const policy = load('shared/rentalSecurity.ts');
const consent = load('shared/savedCardSecurity.ts');
const agreement = load('shared/rentalAgreement.ts');
const {AGREEMENTS} = load('src/lib/legal.ts');
const scheduled = [];
const owner = 'saved-card-admin-fixture';
process.env.ADMIN_TOKEN = owner;
const ctx = {db, scheduler:{runAfter:async (...args)=>scheduled.push(args)}};
const account = put('accounts', {email:'card-owner@example.invalid'});
put('sessions', {token:'saved-card-renter', accountId:account._id, expiresAt:Date.now()+86400000});
const other = put('accounts', {email:'other-card@example.invalid'});
put('sessions', {token:'other-renter', accountId:other._id, expiresAt:Date.now()+86400000});
const line = {listingId:'listing-fixture', title:'Camera', qty:1, start:Date.now()-86400000, end:Date.now(), lineTotal:100};
function rental(overrides={}) {
  const signed=Date.now()-10*86400000;
  const a={customerName:'Card Owner',customerEmail:account.email,billingAddress:'London fixture',fulfilment:'pickup',pickupTime:'10:00',returnTime:'18:00',lineItems:[line],subtotal:100,deliveryFee:0,depositAmount:0,depositHoldAmount:0,currency:'GBP',securityPolicyVersion:policy.SECURITY_POLICY_VERSION,savedCardLimit:250,savedCardConsentText:consent.savedCardConsentText(250),agreementName:'Card Owner',agreementDocs:AGREEMENTS,securityHoldConsent:true,laterChargeConsent:true};
  return put('bookings',{...a,accountId:account._id,status:'returned',agreementSignedAt:signed,laterChargeConsentAt:signed,agreementSnapshot:agreement.snapshotAgreement(a,signed,100,0),savedCardStatus:'saved',savedCardCustomerId:'cus_owned',savedCardPaymentMethodId:'pm_owned',pickedUpAt:Date.now()-2*86400000,actualReturnedAt:Date.now()-86400000,replacementValues:[{listingId:line.listingId,unitPence:250000}],returnDecision:{damageKept:200,inspection:[{listingId:line.listingId,condition:'issue',note:'Housing damaged'}]},lateFeeAmount:100,...overrides});
}
const state=load('convex/securityChargeState.ts');
const cards=load('convex/savedCardState.ts');
async function prepare(b, kind, amount, suffix) {return state.prepare.handler(ctx,{token:owner,bookingId:b._id,requestId:'assessment-request-'+suffix,kind,amount,reason:'Documented inspected issue or late time; evidenced actual cost.'});}
async function notified(id) {await state.noticeResult.handler(ctx,{id,sent:true,recipient:account.email,subject:'Evidence',html:'Retained delivered evidence'});}
let createCalls=0, refundCalls=0, bankMode='paid';
const provider = new Map();
class Bank {
  paymentMethods={retrieve:async(id)=>({id,type:'card',customer:'cus_owned'})};
  paymentIntents={
    create:async(a,options)=>{createCalls++;assert.equal(a.capture_method,'automatic');assert.equal(a.off_session,true);assert.equal(a.customer,'cus_owned');assert.equal(a.payment_method,'pm_owned');assert.equal(options.idempotencyKey,'dbc-security-charge-'+a.metadata.securityChargeId);const id='pi_'+a.metadata.securityChargeId.replaceAll('-','_');if(provider.has(id))return provider.get(id);const pi={id,...a,status:bankMode==='auth'?'requires_action':bankMode==='decline'?'requires_payment_method':'succeeded',amount_received:['auth','decline'].includes(bankMode)?0:a.amount,payment_method:bankMode==='decline'?null:a.payment_method,last_payment_error:bankMode==='decline'?{payment_method:{id:a.payment_method}}:null,client_secret:'owned-fixture-client-secret',metadata:a.metadata};provider.set(id,pi);if(bankMode==='lost')throw Error('Lost response after provider creation');return pi;},
    retrieve:async(id)=>provider.get(id),
    list:async()=>({data:[...provider.values()],has_more:false}),
    cancel:async(id)=>{const pi={...provider.get(id),status:'canceled'};provider.set(id,pi);return pi;},
  };
  refunds={list:async()=>({data:[],has_more:false}),create:async()=>{refundCalls++;throw Error('Background must not create a refund');}};
}
setMock('stripe',{default:Bank});process.env.STRIPE_SECRET_KEY='sk_test_fixture';
const actions=load('convex/securityCharges.ts');
const actionCtx={runQuery:async(ref,args)=>{
 if(ref==='securityChargeState.context')return state.context.handler(ctx,args);
 if(ref==='securityChargeState.byIntent')return state.byIntent.handler(ctx,args);
 if(ref==='accounts._byToken')return load('convex/accounts.ts')._byToken.handler(ctx,args);
 throw Error('Unexpected query '+ref);
},runMutation:async(ref,args)=>{
 if(ref==='adminAuth.assertAdminInternal'){assert.equal(args.token,owner);return;}
 const name=ref.split('.')[1];if(ref.startsWith('securityChargeState.')&&state[name])return state[name].handler(ctx,args);
 throw Error('Unexpected mutation '+ref);
},runAction:async(ref,args)=>actions[ref.split('.')[1]].handler(actionCtx,args)};
(async()=>{
 for(const value of [0,150,999.99,1000,2500,10000])for(const protection of ['verify','deposit'])assert.deepEqual(policy.rentalSecurity(protection,value),{deposit:0,hold:0});
 assert.equal(policy.savedCardChargeLimit(2500),250);assert.equal(policy.savedCardChargeLimit(999.99),100);assert.equal(policy.savedCardChargeLimit(0),0);
 assert.deepEqual(policy.securityForPolicy(policy.LEGACY_TEN_PERCENT_HOLD_POLICY,'verify',2500),{deposit:62.5,hold:250});
 assert.deepEqual(policy.securityForPolicy(policy.LEGACY_TEN_PERCENT_HOLD_POLICY,'deposit',2500),{deposit:1250,hold:2500});
 assert.throws(()=>policy.savedCardChargeLimit(NaN));assert.throws(()=>policy.savedCardChargeLimit(-1));
 const b=rental();assert.equal(consent.assertSavedCardConsent(b),250);assert.equal(consent.savedCardRentalValue(b),2500);consent.assertSavedCardCollection(b);
 const listing=put('listings',{title:'Canonical camera',active:true,depositAmount:2500,pricing:{daily:100}});
 const bookings=load('convex/bookings.ts');
 const createArgs={customerEmail:account.email,customerName:'Card Owner',billingAddress:'London fixture',fulfilment:'pickup',pickupTime:'10:00',returnTime:'18:00',lineItems:[{...line,listingId:listing._id}],subtotal:100,deliveryFee:0,depositAmount:0,depositHoldAmount:0,total:100,expectedTotalDue:100,currency:'GBP',securityPolicyVersion:policy.SECURITY_POLICY_VERSION,savedCardLimit:250,agreementName:'Card Owner',agreementDocs:AGREEMENTS,securityHoldConsent:true,laterChargeConsent:true,agreementRequestId:'canonical-saved-card-attempt-001'};
 await assert.rejects(bookings.createPending.handler(ctx,{...createArgs,savedCardLimit:251}),/limit/);
 const created=await bookings.createPending.handler(ctx,createArgs),canonical=await db.get(created.bookingId);
 assert.equal(canonical.depositAmount,0);assert.equal(canonical.depositHoldAmount,0);assert.equal(canonical.savedCardLimit,250);assert.equal(JSON.parse(canonical.agreementSnapshot).particulars.savedCardConsent,consent.savedCardConsentText(250));
 for(const patch of [{savedCardLimit:251},{depositAmount:1},{savedCardConsentText:'forged'},{agreementSignedAt:1}])assert.throws(()=>consent.assertSavedCardConsent({...b,...patch}));
 for(const patch of [{status:'active'},{pickedUpAt:undefined},{actualReturnedAt:Date.now()-31*86400000},{cancellationDecision:{}},{savedCardStatus:'needs_setup'}])assert.throws(()=>consent.assertSavedCardCollection({...b,...patch}));
 const ready={...b,status:'confirmed',savedCardStatus:'needs_setup',idVerifyStatus:'verified',verificationExpiresAt:Date.now()+86400000,verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},verificationArchiveReady:true};
 assert.equal(load('shared/rentalReadiness.ts').rentalStageLabel(ready),'Awaiting saved-card setup');assert.equal(load('shared/verificationJourney.ts').verificationJourney(ready).ready,false);assert.equal(load('shared/verificationJourney.ts').verificationJourney({...ready,savedCardStatus:'saved'}).ready,true);
 await assert.rejects(prepare(b,'damage',200.001,'fraction'),/penny/);
 await assert.rejects(state.prepare.handler(ctx,{token:'foreign',bookingId:b._id,requestId:'foreign-request-0001',kind:'damage',amount:20,reason:'Documented fixture'}));
 const damage=await prepare(b,'damage',200,'damage-0001');assert.equal(b.savedCardChargeReservedPence,20000);
 assert.equal(await prepare(b,'damage',200,'damage-0001'),damage);assert.equal(b.savedCardChargeReservedPence,20000);
 await assert.rejects(prepare(b,'damage',201,'damage-0001'),/different/);
 await assert.rejects(prepare(b,'damage',1,'damage-0002'),/remaining recorded/);
 await assert.rejects(prepare(b,'late',51,'late-0001'),/combined/);
 const late=await prepare(b,'late',50,'late-0002');assert.equal(b.savedCardChargeReservedPence,25000);
 assert.equal(createCalls,0,'Preparing assessments and account messages cannot request bank payment');
 await state.noticeResult.handler(ctx,{id:damage,sent:false});await assert.rejects(state.claim.handler(ctx,{id:damage}),/notice/);
 await notified(damage);const d=await db.get(damage);assert.equal(d.collectAfter-d.noticeAt,7*86400000);assert.equal(d.noticeEmail,account.email);await assert.rejects(state.claim.handler(ctx,{id:damage}),/notice/);
 await assert.rejects(state.list.handler(ctx,{token:'other-renter',bookingId:b._id}),/not available/);
 const publicData=await state.list.handler(ctx,{token:'saved-card-renter',bookingId:b._id});assert(!JSON.stringify(publicData).includes('pm_owned'));assert(!JSON.stringify(publicData).includes('cus_owned'));
 await state.dispute.handler(ctx,{token:'saved-card-renter',id:late,reason:'Please review the actual return time'});
 await db.patch(damage,{collectAfter:Date.now()-1000});await assert.rejects(state.claim.handler(ctx,{id:damage}),/dispute/);
 await assert.rejects(state.acceptResolution.handler(ctx,{token:owner,id:late,expectedResolution:'review'}),/access/);
 await state.proposeResolution.handler(ctx,{token:owner,id:late,explanation:'Reviewed return evidence shows the accepted charge.'});
 await assert.rejects(state.acceptResolution.handler(ctx,{token:'saved-card-renter',id:late,expectedResolution:'stale'}),/changed/);
 await state.acceptResolution.handler(ctx,{token:'saved-card-renter',id:late,expectedResolution:(await db.get(late)).disputeResolution});
 await notified(late);await db.patch(late,{collectAfter:Date.now()-1000});
 assert.equal((await actions.collect.handler(actionCtx,{token:owner,id:damage})).status,'paid');assert.equal(createCalls,1);assert.equal(b.savedCardChargePaidPence,20000);assert.equal(b.savedCardChargeReservedPence,5000);
 await state.record.handler(ctx,{id:damage,intentId:d.intentId,state:'paid',paidPence:20000});assert.equal(b.savedCardChargePaidPence,20000,'Replayed receipts cannot double-count');
 assert.equal((await actions.collect.handler(actionCtx,{token:owner,id:late})).status,'paid');assert.equal(createCalls,2);assert.equal(b.savedCardChargePaidPence,25000);assert.equal(b.lateFeePaidFromCard,50);
 const frozen=await state.beginRefund.handler(ctx,{id:late,amountPence:5000,reason:'Owner corrected return time'});
 await state.recordRefund.handler(ctx,{id:late,receipt:{...frozen.receipt,stripeRefundId:'re_fixture',status:'succeeded'},refundedPence:5000});
 assert.equal(b.savedCardChargePaidPence,25000,'Refund does not restore automatic billing allowance');assert.equal(b.lateFeePaidFromCard,0);
 await state.recordRefund.handler(ctx,{id:late,receipt:{...frozen.receipt,stripeRefundId:'re_fixture',status:'failed'},refundedPence:0});assert.equal(b.lateFeePaidFromCard,50,'Refund reversals update net paid from the bank receipt');
 await assert.rejects(prepare(b,'late',1,'after-refund'),/combined/);
 const unknown=rental();const u=await prepare(unknown,'damage',10,'unknown-001');await notified(u);await db.patch(u,{state:'uncertain',collectAfter:Date.now()-1,attemptedAt:Date.now()-24*3600000});await assert.rejects(state.claim.handler(ctx,{id:u}),/second payment/);assert.equal(createCalls,2);
 await db.patch(damage,{refundReceipt:{paymentIntentId:d.intentId,amountPence:20000,attemptedAt:Date.now(),status:'unknown'}});await actions.reconcileRefund.handler(actionCtx,{id:damage});assert.equal(refundCalls,0,'Read-only recovery never initiates financial execution');
 await assert.rejects(actions.reconcileReference.handler(actionCtx,{token:owner,id:u,paymentIntentId:d.intentId}),/does not match/);await assert.rejects(state.record.handler(ctx,{id:u,intentId:d.intentId,state:'paid',paidPence:1000}),/another assessment/);
 for(const mode of ['lost','auth','decline']){
  bankMode=mode;const rentalRow=rental(),id=await prepare(rentalRow,'damage',10,'bank-'+mode+'-0001');await notified(id);await db.patch(id,{collectAfter:Date.now()-1});const before=createCalls;
  const result=await actions.collect.handler(actionCtx,{token:owner,id});
  if(mode==='lost'){assert.equal(result.status,'uncertain');assert.equal(rentalRow.savedCardChargeReservedPence,1000);bankMode='paid';assert.equal((await actions.collect.handler(actionCtx,{token:owner,id})).status,'paid');assert.equal(createCalls,before+1,'A lost response is recovered by reading the original bank payment, without another creation');}
  if(mode==='auth'){assert.equal(result.status,'requires_action');assert.equal(rentalRow.savedCardChargePaidPence??0,0);assert.equal((await actions.refresh.handler(actionCtx,{token:owner,id,admin:true})).clientSecret,undefined);assert((await actions.refresh.handler(actionCtx,{token:'saved-card-renter',id})).clientSecret);await assert.rejects(actions.refresh.handler(actionCtx,{token:'other-renter',id}),/access/);await state.dispute.handler(ctx,{token:'saved-card-renter',id,reason:'Please review before bank approval'});const paused=await actions.refresh.handler(actionCtx,{token:'saved-card-renter',id});assert.equal(paused.status,'failed');assert.equal(paused.clientSecret,undefined);assert.equal(rentalRow.savedCardChargeReservedPence,0);}
  if(mode==='decline'){assert.equal(result.status,'failed');assert.equal(rentalRow.savedCardChargeReservedPence,0);assert.equal(rentalRow.savedCardChargePaidPence??0,0);}
 }
 const waiting=rental({status:'confirmed',returnDecision:undefined,actualReturnedAt:undefined,stripeCheckoutSessionId:'cs_owned',savedCardStatus:'awaiting_payment'});
 assert.equal(await cards.save.handler(ctx,{bookingId:waiting._id,sessionId:'cs_foreign',customerId:'cus_owned',paymentMethodId:'pm_owned'}),false);
 assert.equal(await cards.save.handler(ctx,{bookingId:waiting._id,sessionId:'cs_owned',customerId:'cus_owned',paymentMethodId:'pm_owned'}),true);
 await assert.rejects(cards.save.handler(ctx,{bookingId:waiting._id,sessionId:'cs_owned',customerId:'cus_other',paymentMethodId:'pm_other'}),/replay/);
 const closed=rental();await db.patch(closed._id,{returnDecision:{...closed.returnDecision,actualReturnedAt:closed.actualReturnedAt}});await cards.markReturn.handler(ctx,{bookingId:closed._id});assert.equal(closed.returnedAt,closed.actualReturnedAt,'The physical return starts the account document-retention clock');assert.equal(closed.depositRefundAmount,0);assert.equal(closed.depositHoldCapturedForDamage,0);
 const awaitingQuote=rental({returnDecision:{damageKept:0,inspection:[{condition:'issue',details:'Repair quote pending'}]}});await prepare(awaitingQuote,'damage',20,'first-repair-quote');assert.equal(awaitingQuote.savedCardDamageAssessed,20);await assert.rejects(prepare(awaitingQuote,'damage',20,'duplicate-repair-quote'),/remaining recorded/);
 const returnAt=Date.now(),goodInspection={key:'canonical-1',title:'Canonical camera',condition:'good',details:'',openCase:false};
 await db.patch(canonical._id,{status:'returned',savedCardStatus:'saved',returnDecision:{actualReturnedAt:returnAt,damageKept:0,chargeLate:false,startedAt:returnAt,inspection:[goodInspection]}});
 await bookings.recordLateFee.handler(ctx,{bookingId:canonical._id,actualReturnedAt:returnAt,amount:0,breakdown:[]});assert.equal(canonical.savedCardStatus,'closed','A completed good inspection with no fees closes permission');
 await db.patch(canonical._id,{savedCardStatus:'saved',returnDecision:{...canonical.returnDecision,inspection:[{...goodInspection,condition:'issue',details:'Repair quote pending'}]}});
 await bookings.recordLateFee.handler(ctx,{bookingId:canonical._id,actualReturnedAt:returnAt,amount:0,breakdown:[]});assert.equal(canonical.savedCardStatus,'saved','An inspected issue with a quote pending does not close permission prematurely');
 const removed=put('accounts',{email:'removed-account@example.invalid'}),orphan=rental({accountId:removed._id});const orphanId=await prepare(orphan,'damage',10,'removed-account-case');await notified(orphanId);await db.patch(orphanId,{collectAfter:Date.now()-1});await db.delete(removed._id);await assert.rejects(state.claim.handler(ctx,{id:orphanId}),/account/);
 await state.record.handler(ctx,{id:orphanId,intentId:'pi_removedaccount',state:'paid',paidPence:1000});const archivedRefund=await state.beginRefund.handler(ctx,{id:orphanId,amountPence:1000,reason:'Refund after account removal'});await state.recordRefund.handler(ctx,{id:orphanId,receipt:{...archivedRefund.receipt,stripeRefundId:'re_removedaccount',status:'succeeded'},refundedPence:1000});assert.equal((await db.get(orphanId)).refundedPence,1000,'Account removal cannot prevent recording an original-method refund');
 const legal=load('shared/legalDocuments.ts');assert.equal(legal.RENTAL_DRAFT_RELEASE_READY,false);const terms=JSON.stringify(legal.LEGAL_DOCS.terms);
 assert.match(terms,/£100 per rental/);assert.match(terms,/actually incurred and evidenced/);assert.match(terms,/age, condition and depreciation/);assert.match(terms,/separate payment approval/);
 assert(!consent.savedCardConsentText(250).includes('administration'));assert(!fs.readFileSync('src/app/checkout/page.tsx','utf8').includes('£100 damage'));
 assert.deepEqual(legal.LEGAL_ARCHIVE['2026-10-v12'],load('shared/legal-history/2026-10-v12.ts').default);
 console.log('PASS saved-card security: no upfront security, canonical 10%, historic holds, exact consent, ownership, seven-day delivery grace, combined cap/replay, dispute acceptance, bank receipts, refund/reversal without allowance reuse, unknown outcome safety, no background refund and terms-only fair £100 administration.');
})().catch(error=>{console.error(error);process.exitCode=1;});
