/** Versioned v22 claims use a notice-first, one-attempt off-session flow.
 * This harness uses synthetic accounts/bookings and a fake Stripe client only. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const h=require('./lib/rentalTestHarness.cjs');
const {load,db,put,tables,setMock}=h;
const security=load('shared/rentalSecurity.ts');
const consent=load('shared/savedCardSecurity.ts');
const legal=load('src/lib/legal.ts');
const currentLegal=load('src/lib/currentLegalVersion.ts');
const agreement=load('shared/rentalAgreement.ts');
const legalDocs=load('shared/legalDocuments.ts').LEGAL_ARCHIVE;
const owner='immediate-claim-admin-fixture';
const ownerClaimFixture='c'.repeat(64);
process.env.ADMIN_TOKEN=owner;
process.env.OWNER_RETURN_CLAIM_TOKEN=ownerClaimFixture;
process.env.APP_URL='https://fixture.invalid';
process.env.INVOICE_SECRET='fixture-invoice-secret';
process.env.STRIPE_SECRET_KEY='sk_test_fixture';
const account=put('accounts',{email:'renter@example.invalid'});
const line={listingId:'listing-immediate-fixture',title:'Cinema camera',qty:1,start:Date.now()-2*86400000,end:Date.now()-86400000,lineTotal:100};
let emailCalls=[];
setMock('./lib/mailer',{sendMail:async message=>{emailCalls.push(message);return true;}});
const noticeQueue=[];
const ctx={db,scheduler:{runAfter:async(...args)=>noticeQueue.push(args)}};
const state=load('convex/securityChargeState.ts');
let bankMode='paid',createCalls=0;
const intents=new Map();
class StripeFixture {
 paymentMethods={retrieve:async id=>({id,type:'card',customer:'cus_fixture'})};
 paymentIntents={
  create:async(args,options)=>{
   createCalls++;assert.equal(options.idempotencyKey,`dbc-security-charge-${args.metadata.securityChargeId}`);
   const id=`pi_${args.metadata.securityChargeId.replaceAll('-','_')}`;
   if(intents.has(id))return intents.get(id);
   const status=bankMode==='auth'?'requires_action':bankMode==='decline'?'requires_payment_method':'succeeded';
   const pi={id,...args,status,amount_received:status==='succeeded'?args.amount:0,payment_method:args.payment_method,client_secret:'fixture-client-secret',metadata:args.metadata};
   intents.set(id,pi);return pi;
  },
  retrieve:async id=>intents.get(id),
  list:async()=>({data:[...intents.values()],has_more:false}),
  cancel:async id=>{const pi={...intents.get(id),status:'canceled'};intents.set(id,pi);return pi;},
 };
 refunds={list:async()=>({data:[],has_more:false}),create:async()=>{throw Error('No refund should be created in this test');}};
}
setMock('stripe',{default:StripeFixture});
const actions=load('convex/securityCharges.ts');
const actionCtx={
 runQuery:async(ref,args)=>{
  if(ref==='securityChargeState.context')return state.context.handler(ctx,args);
  if(ref==='securityChargeState.byIntent')return state.byIntent.handler(ctx,args);
  if(ref==='securityChargeState.refundNoticeContext')return state.refundNoticeContext.handler(ctx,args);
  throw Error('Unexpected query '+ref);
 },
 runMutation:async(ref,args)=>{
  if(ref==='adminAuth.assertAdminInternal'){if(args.token!==owner)throw Error('Admin access denied');return;}
  const name=ref.split('.')[1];if(ref.startsWith('securityChargeState.')&&state[name])return state[name].handler(ctx,args);
  throw Error('Unexpected mutation '+ref);
 },
 runAction:async(ref,args)=>actions[ref.split('.')[1]].handler(actionCtx,args),
};
function rental(policyVersion,agreementVersion){
 const signed=Date.now()-86400000,limit=100;
 const consentText=policyVersion===security.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION?consent.immediateClaimConsentText(limit):consent.setupIntentConsentText(limit);
 const selectedDocs=legal.agreementsForSecurityPolicy(policyVersion);
 const draft={customerName:'Fixture Renter',customerEmail:account.email,billingAddress:'12 Example Road, London',fulfilment:'pickup',pickupTime:'10:00',returnTime:'18:00',lineItems:[line],subtotal:100,discount:0,deliveryFee:0,depositAmount:0,depositHoldAmount:0,total:100,currency:'GBP',securityPolicyVersion:policyVersion,savedCardLimit:limit,savedCardConsentText:consentText,agreementName:'Fixture Renter',agreementDocs:selectedDocs,securityHoldConsent:true,laterChargeConsent:true};
 const snapshot=JSON.parse(agreement.snapshotAgreement(draft,signed,100,0));
 snapshot.version=agreementVersion;
 snapshot.documents=snapshot.documents.map(doc=>({...doc,version:agreementVersion,text:legalDocs[agreementVersion][doc.kind]}));
 const historicalDocs=selectedDocs.map(doc=>({...doc,version:agreementVersion}));
 return put('bookings',{...draft,agreementDocs:historicalDocs,accountId:account._id,status:'returned',agreementSignedAt:signed,laterChargeConsentAt:signed,agreementSnapshot:JSON.stringify(snapshot),savedCardStatus:'saved',savedCardCustomerId:'cus_fixture',savedCardPaymentMethodId:'pm_fixture',savedCardSessionId:'cs_fixture',pickedUpAt:Date.now()-2*86400000,actualReturnedAt:Date.now()-86400000,replacementValues:[{listingId:line.listingId,unitPence:250000}],returnDecision:{damageKept:20,inspection:[{listingId:line.listingId,condition:'issue',note:'Permanent casing damage'}]},lateFeeAmount:0});
}
(async()=>{
 const v1=security.SETUP_INTENT_SECURITY_POLICY_VERSION;
 for(const version of ['2026-11-v20','2026-11-v21']){
  const old=rental(v1,version);
  assert.equal(consent.assertSavedCardConsent(old),100,`historical ${version} consent remains valid`);
  assert.doesNotThrow(()=>consent.assertSavedCardCollection(old));
  assert(legalDocs[version]['deposit-agreement'].sections.some(section=>/at least seven days/i.test(section.p)),`${version} preserves seven-day text`);
  const id=await state.prepare.handler(ctx,{token:owner,bookingId:old._id,requestId:`legacy-${version}-claim-0001`,kind:'damage',claimBasis:'severe_cosmetic_damage',amount:10,reason:'Permanent casing damage supported by the inspection.'});
  await state.noticeResult.handler(ctx,{id,sent:true,recipient:account.email,subject:'Evidence',html:'Evidence'});
  const row=await db.get(id);assert.equal(row.collectAfter-row.noticeAt,7*86400000,`${version} still requires the full seven days`);
  await assert.rejects(state.claim.handler(ctx,{id}),/notice period finishes/);
  const willRelease=Object.fromEntries(["agreementName","agreementSignedAt","agreementDocs","agreementSnapshot","securityPolicyVersion","securityHoldConsentAt","laterChargeConsentAt"].map(key=>[key,old[key]]));
  await assert.rejects(Promise.resolve().then(()=>agreement.assertAgreementBeforeRelease({...willRelease,securityHoldConsentAt:old.agreementSignedAt})),/Broker, legal and operational review/);
 }
 assert.equal(currentLegal.legalVersionForPolicy({setupIntentSecurityEnabled:true}),legal.IMMEDIATE_CLAIM_LEGAL_VERSION,'the feature flag only selects v22 for future checkouts');
 const immediate=security.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION;
 assert(security.isSetupIntentSecurityPolicy(immediate));assert(security.isImmediateClaimSecurityPolicy(immediate));
 const clean= rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);
 assert.equal(consent.assertSavedCardConsent(clean),100);consent.assertSavedCardCollection(clean);
 const forgedOld={...clean,securityPolicyVersion:v1};assert.throws(()=>consent.assertSavedCardConsent(forgedOld),/missing or inconsistent/,'a v22 signature cannot be reinterpreted as the old seven-day policy');
 await assert.rejects(actions.submitClaim.handler(actionCtx,{token:owner,ownerClaimToken:ownerClaimFixture,confirmed:true,bookingId:rental(v1,'2026-11-v21')._id,requestId:'wrong-version-immediate-0001',kind:'damage',claimBasis:'severe_cosmetic_damage',amount:10,reason:'Permanent casing damage supported by the inspection.'}),/Immediate collection is not permitted/);
 await assert.rejects(actions.submitClaim.handler(actionCtx,{token:'foreign',ownerClaimToken:ownerClaimFixture,confirmed:true,bookingId:clean._id,requestId:'foreign-immediate-claim-0001',kind:'damage',claimBasis:'severe_cosmetic_damage',amount:10,reason:'Permanent casing damage supported by the inspection.'}),/unauthorized/i);
 await assert.rejects(actions.submitClaim.handler(actionCtx,{token:owner,ownerClaimToken:ownerClaimFixture,confirmed:true,bookingId:clean._id,requestId:'zero-immediate-claim-0001',kind:'damage',claimBasis:'severe_cosmetic_damage',amount:0,reason:'Permanent casing damage supported by the inspection.'}),/positive penny-accurate/);
 const reason='Screen housing has a measured permanent split. Repair quote £20; recovered value and avoided costs are deducted.';
 const args={token:owner,ownerClaimToken:ownerClaimFixture,confirmed:true,bookingId:clean._id,requestId:'v22-immediate-claim-request-001',kind:'damage',claimBasis:'severe_cosmetic_damage',amount:20,reason};
 const delayed=rental(security.SETUP_INTENT_SECURITY_POLICY_VERSION,'2026-11-v21');
 const delayedResult=await actions.prepareClaim.handler(actionCtx,{...args,bookingId:delayed._id,requestId:'v21-owner-authorized-notice-001'});
 assert.equal(delayedResult.status,'notice_pending','the separate owner-authorized delayed-notice route prepares a claim');
 const delayedRow=await db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',delayed._id)).first();
 assert.equal(delayedRow.state,'notice_pending');assert.equal('ownerClaimToken' in delayedRow,false,'the owner code is never stored in the claim record');
 assert.equal(createCalls,0,'a seven-day notice does not charge the card at preparation');
 await assert.rejects(actions.prepareClaim.handler(actionCtx,{...args,ownerClaimToken:''}),/Only the account owner can authorize/,'the delayed-notice path also requires the separate owner secret');
 await assert.rejects(actions.prepareClaim.handler(actionCtx,{...args,confirmed:false}),/Confirm the itemised claim/,'the delayed-notice path checks confirmation on the server');
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,ownerClaimToken:''}),/Only the account owner can authorize/,'the regular admin token cannot satisfy the separate owner-claim secret');
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,ownerClaimToken:'d'.repeat(64)}),/Only the account owner can authorize/,'a wrong owner secret is rejected');
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,confirmed:false}),/Confirm the itemised claim/,'server-side confirmation is required');
 assert.equal(createCalls,0,'invalid owner credentials and missing confirmation never call Stripe');

 const returnRetry=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION),returnTime=Date.now()-3600000;
 const returnReason='Permanent casing split measured at 18mm; repair quote £20 and item inspection attached.';
 const returnRequestId=`return-${String(returnRetry._id).replace(/[^A-Za-z0-9-]/g,'-').slice(-36)}-${Math.trunc(returnTime)}-damage`;
 await db.patch(returnRetry._id,{actualReturnedAt:returnTime,returnDecision:{actualReturnedAt:returnTime,damageKept:20,claimBasis:'severe_cosmetic_damage',damageNote:returnReason,chargeLate:false,lateClaimPolicyVersion:'owner-claim-v1',ownerClaimAuthorizedAt:Date.now(),inspection:[{key:'legacy:0:0',condition:'issue',details:returnReason,openCase:false}],startedAt:Date.now()}});
 const ownerTokenDuringRetry=process.env.OWNER_RETURN_CLAIM_TOKEN;delete process.env.OWNER_RETURN_CLAIM_TOKEN;
 let returnRetryResult;
 try{returnRetryResult=await actions.submitReturnDecisionClaim.handler(actionCtx,{token:owner,bookingId:returnRetry._id,requestId:returnRequestId,kind:'damage',claimBasis:'severe_cosmetic_damage',amount:20,reason:returnReason});}
 finally{process.env.OWNER_RETURN_CLAIM_TOKEN=ownerTokenDuringRetry;}
 assert.equal(returnRetryResult.status,'paid','An immutable owner-authorized return claim can resume without the owner secret.');
 assert.equal(createCalls,1,'The frozen return retry makes one idempotent payment attempt.');
 await assert.rejects(actions.submitReturnDecisionClaim.handler(actionCtx,{token:owner,bookingId:returnRetry._id,requestId:returnRequestId,kind:'damage',claimBasis:'severe_cosmetic_damage',amount:19,reason:returnReason}),/does not match the frozen owner-authorized return decision/,'A prior receipt cannot authorize a changed amount.');
 const unapprovedReturn=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);
 await assert.rejects(actions.submitReturnDecisionClaim.handler(actionCtx,{token:owner,bookingId:unapprovedReturn._id,requestId:'return-unapproved-decision-damage',kind:'damage',claimBasis:'severe_cosmetic_damage',amount:20,reason:returnReason}),/frozen owner-authorized returned decision/,'The internal retry path rejects a new claim without a persisted owner receipt.');
 assert.equal(createCalls,1,'Changed or new return claims never reach Stripe.');
 emailCalls=[];

 const createsBeforePublicSubmit=createCalls;
 const first=await actions.submitClaim.handler(actionCtx,args);
 assert.equal(first.status,'paid');assert.equal(createCalls,createsBeforePublicSubmit+1,'One submit makes one idempotent off-session attempt');
 const notice=emailCalls.find(message=>message.subject.includes('assessment'));
 assert(notice.html.includes('£20.00'));assert(notice.html.includes(reason),'notice email includes the exact recorded reason');
 const chatNotice=tables.get('messages').find(message=>message.bookingId===clean._id&&message.text.includes(reason));
 assert(chatNotice?.text.includes('£20.00'),'renter chat has the same amount and reason as the email');
 const assessmentRefund=await state.beginRefund.handler(ctx,{id:first.id,amountPence:1000,reason:'We corrected the repair estimate after review.'});
 await state.recordRefund.handler(ctx,{id:first.id,receipt:{...assessmentRefund.receipt,stripeRefundId:'re_fixture_assessment',status:'succeeded'},refundedPence:1000});
 const refundNotice=tables.get('rental_security_refund_notices').find(row=>row.chargeId===first.id);assert(refundNotice,'Confirmed refund creates a durable email event');
 const originalFetch=global.fetch;
 try{
  global.fetch=async(url)=>{assert.match(String(url),/phase=assessment/);return new Response(Buffer.from('%PDF-fixture-assessment-statement'),{status:200,headers:{'content-type':'application/pdf'}});};
  await actions.sendRefundNotice.handler(actionCtx,{noticeId:refundNotice._id});
 }finally{global.fetch=originalFetch;}
 const refundEmail=emailCalls.at(-1);assert.match(refundEmail.subject,/refund confirmed/i);assert.match(refundEmail.html,/£10\.00/);assert.match(refundEmail.html,/corrected the repair estimate/);assert.match(refundEmail.html,/not account credit/);assert.equal(refundEmail.deliveryKey,refundNotice.eventKey);assert.match(refundEmail.attachments[0].filename,/assessment-update/);
 assert.equal((await db.get(refundNotice._id)).status,'sent');assert.equal((await db.get(first.id)).refundEmailStatus,'sent');
 const replay=await actions.submitClaim.handler(actionCtx,args);
 assert.equal(replay.status,'paid');assert.equal(createCalls,createsBeforePublicSubmit+1,'Replaying the same request does not make a second charge');
 const paid=await db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',clean._id)).first();
 assert.equal(paid.state,'paid');assert.equal(paid.paidPence,2000);assert.equal(paid.reason,reason);
 global.fetch=async url=>{const parsed=new URL(url);assert.equal(parsed.searchParams.get('phase'),'assessment');assert.equal(parsed.searchParams.get('assessment'),String(paid._id));return new Response('%PDF-fixture',{status:200,headers:{'content-type':'application/pdf'}});};
 await actions.sendReceipt.handler(actionCtx,{id:paid._id});
 const receipt=emailCalls.at(-1);assert(receipt.html.includes('£20.00'));assert(receipt.html.includes(reason));assert.equal(receipt.attachments[0].filename,`DbCinema-assessment-${String(paid._id).slice(-8)}.pdf`);
 const pdfSource=fs.readFileSync('src/lib/invoice/InvoiceDocument.tsx','utf8');assert(pdfSource.includes('{assessment.reason}'));assert(pdfSource.includes('{gbp(assessment.paid)}'));assert(pdfSource.includes('does not replace the original rental invoice'));
 assert.equal((await db.get(clean._id)).savedCardChargePaidPence,2000,'successful charge is recorded on the rental ledger');
 const authentication=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);bankMode='auth';const createsBeforeAuthentication=createCalls;
 const authResult=await actions.submitClaim.handler(actionCtx,{...args,bookingId:authentication._id,requestId:'v22-sca-claim-request-001',amount:10});
 assert.equal(authResult.status,'requires_action');assert.equal((await db.get(authentication._id)).savedCardChargePaidPence??0,0);assert.equal((await db.get(authentication._id)).savedCardChargeReservedPence,1000);
 const authRow=await db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',authentication._id)).first();assert(tables.get('messages').some(message=>message.bookingId===authentication._id&&message.text.includes('bank requires an extra approval')));
 const authRetry=await actions.submitClaim.handler(actionCtx,{...args,bookingId:authentication._id,requestId:'v22-sca-claim-request-001',amount:10});assert.equal(authRetry.status,'requires_action');assert.equal(createCalls,createsBeforeAuthentication+1,'SCA replay does not create a second payment intent');
 assert.equal((await actions.refresh.handler(actionCtx,{token:owner,id:authRow._id,admin:true})).clientSecret,undefined,'admin does not receive renter SCA secret');
 bankMode='decline';const declined=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);const createsBeforeDecline=createCalls;
 const declineResult=await actions.submitClaim.handler(actionCtx,{...args,bookingId:declined._id,requestId:'v22-decline-claim-request-1',amount:10});assert.equal(declineResult.status,'failed');
 assert.equal((await db.get(declined._id)).savedCardChargePaidPence??0,0);assert.equal((await db.get(declined._id)).savedCardChargeReservedPence,0);
 const declineReplay=await actions.submitClaim.handler(actionCtx,{...args,bookingId:declined._id,requestId:'v22-decline-claim-request-1',amount:10});assert.equal(declineReplay.status,'failed');assert.equal(createCalls,createsBeforeDecline+1,'a declined payment is not retried automatically');
 const issueFree=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);await db.patch(issueFree._id,{returnDecision:{damageKept:0,inspection:[{listingId:line.listingId,condition:'good',note:''}]},lateFeeAmount:0});
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,bookingId:issueFree._id,requestId:'v22-clean-return-claim-01',amount:1}),/item-specific inspected issue/,'clean return cannot create a damage claim');
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,bookingId:issueFree._id,requestId:'v22-clean-late-claim-001',kind:'late',claimBasis:undefined,amount:1}),/remaining recorded assessment/,'clean return cannot create a late-fee claim');
 console.log('PASS immediate saved-card claims: v20/v21 stay seven-day; v22 exact consent only; admin auth and amount/reason checks; itemised email/chat/PDF statement; Stripe idempotency, SCA, decline, and clean-return no-claim safeguards.');
})().catch(async error=>{
 console.error(error);process.exitCode=1;
});
