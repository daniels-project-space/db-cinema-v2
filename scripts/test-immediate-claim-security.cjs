/** Versioned v22 claims use a notice-first, one-attempt off-session flow.
 * This harness uses synthetic accounts/bookings and a fake Stripe client only. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
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
process.env.INBOUND_REPLY_ADDRESS='support@resend-inbox.example.invalid';
const account=put('accounts',{email:'renter@example.invalid',emailVerifiedAt:Date.now(),name:'Fixture renter'});
const line={listingId:'listing-immediate-fixture',title:'Cinema camera',qty:1,start:Date.now()-2*86400000,end:Date.now()-86400000,lineTotal:100};
const evidenceBytes=new Map();
const pdfBytes=Buffer.from('%PDF-fixture-assessment-invoice');
const originalFetch=global.fetch;
global.fetch=async input=>{
 const url=String(input);
 if(url.includes('/api/invoice/'))return new Response(pdfBytes,{status:200,headers:{'content-type':'application/pdf'}});
 const match=/\/evidence\/([^/?]+)/.exec(url);
 if(match&&evidenceBytes.has(match[1]))return new Response(evidenceBytes.get(match[1]),{status:200,headers:{'content-type':'image/jpeg'}});
 return new Response('not found',{status:404});
};
async function makeEvidence(booking,suffix){
 const storageId=`storage-${suffix}`,bytes=Buffer.from(`fixture damage photo ${suffix}`),sha256=createHash('sha256').update(bytes).digest('hex');
 const attempt=put('chat_attachment_attempts',{accountId:booking.accountId,bookingId:booking._id,admin:true,requestKey:`request-${suffix}`,marker:`application/vnd.dbcinema.chat-${suffix.padEnd(32,'0').slice(0,32)}`,createdAt:Date.now(),status:'published',sha256,contentType:'image/jpeg',size:bytes.length,storageId,name:`damage-${suffix}.jpg`});
 const message=put('messages',{accountId:booking.accountId,bookingId:booking._id,sender:'owner',text:`Attachment: damage-${suffix}.jpg`,meta:{kind:'attachment',attachmentId:attempt._id,name:`damage-${suffix}.jpg`,contentType:'image/jpeg'}});
 await db.patch(attempt._id,{messageId:message._id});evidenceBytes.set(storageId,bytes);return attempt._id;
}
let emailCalls=[];
setMock('./mailer',{sendBusinessMailTracked:async message=>{emailCalls.push(message);return {sent:true,ambiguous:false,resendEmailId:`resend-${message.deliveryKey}`};}});
setMock('./lib/mailer',{sendMail:async message=>{emailCalls.push(message);return true;}});
const noticeQueue=[];
const ctx={db,storage:{getUrl:async storageId=>`https://fixture.invalid/evidence/${storageId}`},scheduler:{runAfter:async(...args)=>noticeQueue.push(args)}};
const state=load('convex/securityChargeState.ts');
const emailInbox=load('convex/emailInbox.ts');
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
  if(ref==='securityChargeState.noticeEvidence')return state.noticeEvidence.handler(ctx,args);
  if(ref==='securityChargeState.byIntent')return state.byIntent.handler(ctx,args);
  if(ref==='securityChargeState.refundNoticeContext')return state.refundNoticeContext.handler(ctx,args);
  throw Error('Unexpected query '+ref);
 },
 runMutation:async(ref,args)=>{
  if(ref==='adminAuth.assertAdminInternal'){if(args.token!==owner)throw Error('Admin access denied');return;}
  if(ref==='emailInbox.prepareRentalContextEmail')return emailInbox.prepareRentalContextEmail.handler(ctx,args);
  if(ref==='emailInbox.finishRentalContextEmail')return emailInbox.finishRentalContextEmail.handler(ctx,args);
  const name=ref.split('.')[1];if(ref.startsWith('securityChargeState.')&&state[name])return state[name].handler(ctx,args);
  throw Error('Unexpected mutation '+ref);
 },
 runAction:async(ref,args)=>actions[ref.split('.')[1]].handler(actionCtx,args),
};
function rental(policyVersion,agreementVersion){
 const signed=Date.now()-86400000,limit=100;
 const consentText=security.isImmediateClaimSecurityPolicy(policyVersion)?consent.immediateClaimConsentText(limit,agreementVersion):consent.setupIntentConsentText(limit);
 const selectedDocs=legal.agreementsForSecurityPolicy(policyVersion).map(doc=>['terms','rental-terms','rental-agreement','cancellation','deposit-agreement','insurance'].includes(doc.kind)?{...doc,version:agreementVersion}:doc);
 const draft={customerName:'Fixture Renter',customerEmail:account.email,billingAddress:'12 Example Road, London',fulfilment:'pickup',pickupTime:'10:00',returnTime:'18:00',lineItems:[line],subtotal:100,discount:0,deliveryFee:0,depositAmount:0,depositHoldAmount:0,total:100,currency:'GBP',securityPolicyVersion:policyVersion,savedCardLimit:limit,savedCardConsentText:consentText,agreementName:'Fixture Renter',agreementDocs:selectedDocs,securityHoldConsent:true,laterChargeConsent:true};
 const snapshot={format:1,version:agreementVersion,acceptedAt:signed,signer:'Fixture Renter',documents:selectedDocs.map(doc=>({...doc,text:legalDocs[agreementVersion]?.[doc.kind]??{title:doc.kind,updated:'Fixture',sections:[{h:'Fixture',p:'Archived fixture text'}]}})),particulars:{customerName:'Fixture Renter',email:account.email,billingAddress:'12 Example Road, London',fulfilment:'pickup',address:null,pickupArea:'Trafalgar Square',deliveryTermsAccepted:false,pickupTime:'10:00',returnTime:'18:00',timeZone:'Europe/London',lineItems:[line],subtotal:100,discount:0,deliveryFee:0,securityPayment:0,securityHold:0,total:100,creditApplied:0,currency:'GBP',securityPolicyVersion:policyVersion,securityWaiverReason:null,savedCardLimit:limit,savedCardConsent:consentText,serialConditionSchedule:'pending-agreed-handover'}};
 return put('bookings',{...draft,accountId:account._id,status:'returned',agreementSignedAt:signed,securityHoldConsentAt:signed,laterChargeConsentAt:signed,agreementSnapshot:JSON.stringify(snapshot),savedCardStatus:'saved',savedCardCustomerId:'cus_fixture',savedCardPaymentMethodId:'pm_fixture',savedCardSessionId:'cs_fixture',pickedUpAt:Date.now()-2*86400000,actualReturnedAt:Date.now()-86400000,replacementValues:[{listingId:line.listingId,unitPence:250000}],returnDecision:{damageKept:20,inspection:[{key:'fixture-item',title:line.title,listingId:line.listingId,condition:'issue',details:'Permanent casing damage',openCase:false}]},lateFeeAmount:0});
}
(async()=>{
 const v1=security.SETUP_INTENT_SECURITY_POLICY_VERSION;
 for(const version of ['2026-11-v20','2026-11-v21']){
  const old=rental(v1,version);
  assert.equal(consent.assertSavedCardConsent(old),100,`historical ${version} consent remains valid`);
  assert.doesNotThrow(()=>consent.assertSavedCardCollection(old));
  assert(legalDocs[version]['deposit-agreement'].sections.some(section=>/at least seven days/i.test(section.p)),`${version} preserves seven-day text`);
  const legacyRequestId=`legacy-${version}-claim-0001`,legacyReason='Permanent casing damage supported by the inspection.';
  await assert.rejects(state.prepare.handler(ctx,{token:owner,bookingId:old._id,requestId:legacyRequestId,kind:'damage',claimBasis:'severe_cosmetic_damage',amount:10,reason:legacyReason}),/supporting evidence file/,'legacy signed SetupIntent claims cannot skip the promised evidence');
  const legacyEvidence=await makeEvidence(old,`legacy-${version}`);
  const id=await state.prepare.handler(ctx,{token:owner,bookingId:old._id,requestId:legacyRequestId,kind:'damage',claimBasis:'severe_cosmetic_damage',evidenceIds:[legacyEvidence],amount:10,reason:legacyReason});
  assert.equal(await actions.sendNotice.handler(actionCtx,{id}),true,'the historical seven-day notice sends only after invoice and evidence attachments are validated');
  const legacyMail=emailCalls.at(-1);
  assert(legacyMail.html.includes(legacyReason));assert(legacyMail.html.includes('at least seven days'));assert.equal(legacyMail.attachments.length,2,'legacy SetupIntent notice includes its itemised invoice and selected evidence');
  const row=await db.get(id);assert.equal(row.collectAfter-row.noticeAt,7*86400000,`${version} still requires the full seven days`);
  await assert.rejects(state.claim.handler(ctx,{id}),/notice period finishes/);
  const willRelease=Object.fromEntries(["agreementName","agreementSignedAt","agreementDocs","agreementSnapshot","securityPolicyVersion","securityHoldConsentAt","laterChargeConsentAt"].map(key=>[key,old[key]]));
  await assert.rejects(Promise.resolve().then(()=>agreement.assertAgreementBeforeRelease({...willRelease,securityHoldConsentAt:old.agreementSignedAt})),/Broker, legal and operational review/);
 }
 assert.equal(currentLegal.legalVersionForPolicy({setupIntentSecurityEnabled:true}),legal.IMMEDIATE_CLAIM_LEGAL_VERSION,'the feature flag selects the latest full agreement version for new checkouts');
 const immediate=security.IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION;
 assert(security.isSetupIntentSecurityPolicy(immediate));assert(security.isImmediateClaimSecurityPolicy(immediate));
 for(const version of ['2026-11-v22','2026-11-v23','2026-11-v24','2026-11-v25']){
  const historical=rental(security.PREVIOUS_IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION,version);
  assert.equal(consent.assertSavedCardConsent(historical),100,`historical ${version} consent remains valid with its accepted cap`);
  assert.equal(JSON.parse(historical.agreementSnapshot).particulars.savedCardConsent,consent.immediateClaimConsentText(100,version));
 }
 assert.throws(()=>consent.assertSavedCardConsent(rental(security.PREVIOUS_IMMEDIATE_CLAIM_SECURITY_POLICY_VERSION,legal.IMMEDIATE_CLAIM_LEGAL_VERSION)),/missing or inconsistent/,'the previous flat-cap policy cannot claim the scaled agreement');
 assert.throws(()=>consent.assertSavedCardConsent(rental(immediate,legal.PREVIOUS_BOOKING_CONFIRMATION_LEGAL_VERSION)),/missing or inconsistent/,'the scaled policy cannot reuse previous flat-cap consent');
 for(const version of legal.SCALED_IMMEDIATE_CLAIM_LEGAL_VERSIONS){
  const retained=rental(immediate,version),snapshot=JSON.parse(retained.agreementSnapshot);
  assert.equal(snapshot.version,version,`${version} keeps its own versioned agreement snapshot`);
  assert.equal(snapshot.documents.find(doc=>doc.kind==='rental-agreement').version,version,`${version} snapshot retains its accepted document version`);
  assert.deepEqual(snapshot.documents.find(doc=>doc.kind==='deposit-agreement').text,legalDocs[version]['deposit-agreement'],`${version} security text is not rewritten`);
  assert.equal(consent.assertSavedCardConsent(retained),100,`${version} accepted scaled cap remains valid`);
  assert.throws(()=>agreement.assertAgreementBeforeRelease(retained),/Broker, legal and operational review/,`${version} remains accepted without bypassing the release-review gate`);
 }
 const clean= rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);
 assert.equal(consent.assertSavedCardConsent(clean),100);consent.assertSavedCardCollection(clean);
 const highValue=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);
 highValue.replacementValues=[{listingId:line.listingId,unitPence:450000}];
 highValue.savedCardLimit=250;
 const highSnapshot=JSON.parse(highValue.agreementSnapshot);
 highSnapshot.particulars.savedCardLimit=250;
 highSnapshot.particulars.savedCardConsent=consent.immediateClaimConsentText(250,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);
 highValue.savedCardConsentText=highSnapshot.particulars.savedCardConsent;
 highValue.agreementSnapshot=JSON.stringify(highSnapshot);
 assert.equal(consent.assertSavedCardConsent(highValue),250,'v27 validates the scaled cap against the saved equipment value');
 assert.throws(()=>consent.assertSavedCardConsent({...highValue,savedCardLimit:200}),/missing or inconsistent/,'v27 rejects a mismatched equipment-value cap');
 const historicalHighValue=rental(immediate,'2026-11-v26');historicalHighValue.replacementValues=[{listingId:line.listingId,unitPence:450000}];historicalHighValue.savedCardLimit=250;
 const historicalHighSnapshot=JSON.parse(historicalHighValue.agreementSnapshot);historicalHighSnapshot.particulars.savedCardLimit=250;historicalHighSnapshot.particulars.savedCardConsent=consent.immediateClaimConsentText(250,'2026-11-v26');historicalHighValue.savedCardConsentText=historicalHighSnapshot.particulars.savedCardConsent;historicalHighValue.agreementSnapshot=JSON.stringify(historicalHighSnapshot);
 assert.equal(consent.assertSavedCardConsent(historicalHighValue),250,'a previously accepted v26 rental retains its exact scaled cap validation');
 const forgedOld={...clean,securityPolicyVersion:v1};assert.throws(()=>consent.assertSavedCardConsent(forgedOld),/missing or inconsistent/,'a v22 signature cannot be reinterpreted as the old seven-day policy');
 await assert.rejects(actions.submitClaim.handler(actionCtx,{token:owner,ownerClaimToken:ownerClaimFixture,confirmed:true,bookingId:rental(v1,'2026-11-v21')._id,requestId:'wrong-version-immediate-0001',kind:'damage',claimBasis:'severe_cosmetic_damage',amount:10,reason:'Permanent casing damage supported by the inspection.'}),/Immediate collection is not permitted/);
 await assert.rejects(actions.submitClaim.handler(actionCtx,{token:'foreign',ownerClaimToken:ownerClaimFixture,confirmed:true,bookingId:clean._id,requestId:'foreign-immediate-claim-0001',kind:'damage',claimBasis:'severe_cosmetic_damage',amount:10,reason:'Permanent casing damage supported by the inspection.'}),/unauthorized/i);
 await assert.rejects(actions.submitClaim.handler(actionCtx,{token:owner,ownerClaimToken:ownerClaimFixture,confirmed:true,bookingId:clean._id,requestId:'zero-immediate-claim-0001',kind:'damage',claimBasis:'severe_cosmetic_damage',amount:0,reason:'Permanent casing damage supported by the inspection.'}),/positive penny-accurate/);
 const reason='Screen housing has a measured permanent split. Repair quote £20; recovered value and avoided costs are deducted.';
 const cleanEvidence=await makeEvidence(clean,'main001');
 const evidenceOptions=await state.evidenceOptions.handler(ctx,{token:owner,bookingId:clean._id});assert.deepEqual(evidenceOptions.map(file=>file.id),[cleanEvidence]);assert.equal('storageId' in evidenceOptions[0],false,'admin picker exposes only the file identity and display metadata');
 await assert.rejects(state.evidenceOptions.handler(ctx,{token:'foreign',bookingId:clean._id}),/unauthorized/i,'customers cannot enumerate admin claim evidence');
 const args={token:owner,ownerClaimToken:ownerClaimFixture,confirmed:true,bookingId:clean._id,requestId:'v22-immediate-claim-request-001',kind:'damage',claimBasis:'severe_cosmetic_damage',itemKey:'fixture-item',evidenceIds:[cleanEvidence],amount:20,reason};
 const delayed=rental(security.SETUP_INTENT_SECURITY_POLICY_VERSION,'2026-11-v21'),delayedEvidence=await makeEvidence(delayed,'delayed-v21');
 await assert.rejects(actions.prepareClaim.handler(actionCtx,{...args,bookingId:delayed._id,requestId:'v21-owner-authorized-notice-no-evidence-001',evidenceIds:undefined}),/supporting evidence file/,'the public admin notice action cannot bypass the shared evidence check');
 const delayedResult=await actions.prepareClaim.handler(actionCtx,{...args,bookingId:delayed._id,requestId:'v21-owner-authorized-notice-001',evidenceIds:[delayedEvidence]});
 assert.equal(delayedResult.status,'notice_pending','the separate owner-authorized delayed-notice route prepares a claim');
 assert.equal(await actions.sendNotice.handler(actionCtx,{id:delayedResult.id}),true,'the v21 notice includes a delivered itemised invoice and selected evidence');
 const delayedRow=await db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',delayed._id)).first();
 assert.equal(delayedRow.state,'notice_sent');assert.equal('ownerClaimToken' in delayedRow,false,'the owner code is never stored in the claim record');assert.equal(delayedRow.collectAfter-delayedRow.noticeAt,7*86400000,'legacy notice retains the full seven-day dispute window');
 const delayedMail=emailCalls.at(-1);assert(delayedMail.html.includes(args.reason));assert.equal(delayedMail.attachments.length,2,'the delayed notice attaches invoice and evidence');
 assert.equal(createCalls,0,'a seven-day notice does not charge the card at preparation');
 await assert.rejects(actions.prepareClaim.handler(actionCtx,{...args,ownerClaimToken:''}),/Only the account owner can authorize/,'the delayed-notice path also requires the separate owner secret');
 await assert.rejects(actions.prepareClaim.handler(actionCtx,{...args,confirmed:false}),/Confirm the itemised claim/,'the delayed-notice path checks confirmation on the server');
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,ownerClaimToken:''}),/Only the account owner can authorize/,'the regular admin token cannot satisfy the separate owner-claim secret');
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,ownerClaimToken:'d'.repeat(64)}),/Only the account owner can authorize/,'a wrong owner secret is rejected');
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,confirmed:false}),/Confirm the itemised claim/,'server-side confirmation is required');
 assert.equal(createCalls,0,'invalid owner credentials and missing confirmation never call Stripe');
 const missingEvidence=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,bookingId:missingEvidence._id,requestId:'v26-claim-without-evidence-001',evidenceIds:undefined}),/supporting evidence file/,'damage claim cannot be charged without attached supporting files');
 assert.equal(createCalls,0,'missing evidence never reaches Stripe');
 const invoiceFailure=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION),invoiceFailureEvidence=await makeEvidence(invoiceFailure,'invoicefail001'),fetchBeforeInvoiceFailure=global.fetch,createsBeforeInvoiceFailure=createCalls;
 global.fetch=async input=>String(input).includes('/api/invoice/')?new Response('unavailable',{status:502}):fetchBeforeInvoiceFailure(input);
 let failedInvoiceResult;
 try{failedInvoiceResult=await actions.submitClaim.handler(actionCtx,{...args,bookingId:invoiceFailure._id,requestId:'v26-invoice-generation-failure-001',itemKey:'fixture-item',evidenceIds:[invoiceFailureEvidence]});}
 finally{global.fetch=fetchBeforeInvoiceFailure;}
 assert.equal(failedInvoiceResult.status,'notice_failed','a claim invoice generation failure stops the payment path');
 assert.equal(createCalls,createsBeforeInvoiceFailure,'no card attempt follows a failed invoice attachment');

 const returnRetry=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION),returnTime=Date.now()-3600000,returnEvidence=await makeEvidence(returnRetry,'retry001');
 const returnReason='Permanent casing split measured at 18mm; repair quote £20 and item inspection attached.';
 const returnRequestId=`return-${String(returnRetry._id).replace(/[^A-Za-z0-9-]/g,'-').slice(-36)}-${Math.trunc(returnTime)}-combined`;
 await db.patch(returnRetry._id,{actualReturnedAt:returnTime,returnDecision:{actualReturnedAt:returnTime,damageKept:20,claimBasis:'severe_cosmetic_damage',damageNote:returnReason,claimItemKey:'fixture-item',claimEvidenceIds:[returnEvidence],chargeLate:false,lateClaimPolicyVersion:'owner-claim-v1',ownerClaimAuthorizedAt:Date.now(),inspection:[{key:'fixture-item',title:line.title,condition:'issue',details:returnReason,openCase:false}],startedAt:Date.now()}});
 const returnAssessment={damageAmountPence:2000,damageOffsetPence:0,damageReason:returnReason,lateAmountPence:0,lateReason:''};
 const returnItemisation=`Damage/loss 20.00: ${returnReason}`;
 const ownerTokenDuringRetry=process.env.OWNER_RETURN_CLAIM_TOKEN;delete process.env.OWNER_RETURN_CLAIM_TOKEN;
 let returnRetryResult;
 try{
  await assert.rejects(actions.submitReturnDecisionClaim.handler(actionCtx,{token:owner,bookingId:returnRetry._id,requestId:returnRequestId,kind:'damage',claimBasis:'severe_cosmetic_damage',itemKey:'fixture-item',returnAssessment,amount:20,reason:returnItemisation}),/combined claim does not match the frozen owner-authorized return decision/,'the automatic saved-return retry cannot omit its frozen evidence');
  assert.equal(createCalls,0,'a return retry without its frozen admin-selected evidence never reaches Stripe');
  returnRetryResult=await actions.submitReturnDecisionClaim.handler(actionCtx,{token:owner,bookingId:returnRetry._id,requestId:returnRequestId,kind:'damage',claimBasis:'severe_cosmetic_damage',itemKey:'fixture-item',evidenceIds:[returnEvidence],returnAssessment,amount:20,reason:returnItemisation});
 }
 finally{process.env.OWNER_RETURN_CLAIM_TOKEN=ownerTokenDuringRetry;}
 assert.equal(returnRetryResult.status,'paid','An immutable owner-authorized return claim can resume without the owner secret.');
 assert.equal(createCalls,1,'The frozen return retry makes one idempotent payment attempt.');
 await assert.rejects(actions.submitReturnDecisionClaim.handler(actionCtx,{token:owner,bookingId:returnRetry._id,requestId:returnRequestId,kind:'damage',claimBasis:'severe_cosmetic_damage',returnAssessment,amount:19,reason:returnItemisation}),/combined claim does not match the frozen owner-authorized return decision/,'A prior receipt cannot authorize a changed amount.');
 const unapprovedReturn=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);
 await assert.rejects(actions.submitReturnDecisionClaim.handler(actionCtx,{token:owner,bookingId:unapprovedReturn._id,requestId:'return-unapproved-decision-damage',kind:'damage',claimBasis:'severe_cosmetic_damage',amount:20,reason:returnReason}),/frozen owner-authorized returned decision/,'The internal retry path rejects a new claim without a persisted owner receipt.');
 assert.equal(createCalls,1,'Changed or new return claims never reach Stripe.');

 const lateReturn=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION),lateReturnAt=Date.now()-3600000;
 const lateReason='The rental was returned after the agreed time; the itemised late-period calculation is attached.';
 const lateEvidence=await makeEvidence(lateReturn,'return-late-evidence');
 lateReturn.lateFeeAmount=20;
 lateReturn.actualReturnedAt=lateReturnAt;
 lateReturn.returnDecision={actualReturnedAt:lateReturnAt,damageKept:0,chargeLate:true,lateClaimReason:lateReason,claimEvidenceIds:[lateEvidence],ownerClaimAuthorizedAt:Date.now(),inspection:[{key:'fixture-item',title:line.title,condition:'good',details:'',openCase:false}]};
 const lateRequestId=`return-${String(lateReturn._id).replace(/[^A-Za-z0-9-]/g,'-').slice(-36)}-${Math.trunc(lateReturnAt)}-combined`;
 const lateAssessment={damageAmountPence:0,damageOffsetPence:0,damageReason:'',lateAmountPence:2000,lateReason};
 const lateItemisation=`Late fee 20.00: ${lateReason}`;
 const beforeLateEvidenceFailure=createCalls;
 await assert.rejects(state.prepare.handler(ctx,{token:owner,bookingId:lateReturn._id,requestId:'late-claim-without-evidence-0001',kind:'late',amount:20,reason:lateReason,immediate:true}),/one combined, frozen itemised/,'the shared saved-card claim boundary rejects a second standalone return claim');
 await assert.rejects(actions.submitReturnDecisionClaim.handler(actionCtx,{token:owner,bookingId:lateReturn._id,requestId:lateRequestId,kind:'late',returnAssessment:lateAssessment,amount:20,reason:lateItemisation}),/combined claim does not match the frozen owner-authorized return decision/,'a return replay cannot omit evidence frozen with its late claim');
 await assert.rejects(actions.submitReturnDecisionClaim.handler(actionCtx,{token:owner,bookingId:lateReturn._id,requestId:lateRequestId,kind:'late',evidenceIds:[cleanEvidence],returnAssessment:lateAssessment,amount:20,reason:lateItemisation}),/combined claim does not match the frozen owner-authorized return decision/,'a return replay cannot substitute a different evidence file');
 assert.equal(createCalls,beforeLateEvidenceFailure,'missing or substituted late-claim evidence never reaches Stripe');
 const lateClaimResult=await actions.submitReturnDecisionClaim.handler(actionCtx,{token:owner,bookingId:lateReturn._id,requestId:lateRequestId,kind:'late',evidenceIds:[lateEvidence],returnAssessment:lateAssessment,amount:20,reason:lateItemisation});
 assert.equal(lateClaimResult.status,'paid','an authorized frozen late claim proceeds with its selected rental evidence');
 const lateClaimRow=await db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',lateReturn._id)).first();
 assert.deepEqual(lateClaimRow.evidenceIds,[lateEvidence],'the saved late claim retains the exact evidence used for its invoice and audit');
 assert.equal(lateClaimRow.amountPence,2000);assert.equal(lateClaimRow.consentSnapshot,lateReturn.agreementSnapshot);
 assert.equal(createCalls,beforeLateEvidenceFailure+1,'the accepted late claim creates exactly one provider attempt');
 const lateReplay=await actions.submitReturnDecisionClaim.handler(actionCtx,{token:owner,bookingId:lateReturn._id,requestId:lateRequestId,kind:'late',evidenceIds:[lateEvidence],returnAssessment:lateAssessment,amount:20,reason:lateItemisation});
 assert.equal(lateReplay.status,'paid');assert.equal(createCalls,beforeLateEvidenceFailure+1,'an exact return replay does not create a second provider attempt');

 const combinedReturn=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION),combinedAt=Date.now()-1800000;
 const combinedEvidence=await makeEvidence(combinedReturn,'combined-return-evidence');
 const combinedDamageReason='Body seam split confirmed in the return inspection; repair quote attached.';
 const combinedLateReason='Return occurred after the agreed time; the late period is itemised.';
 combinedReturn.lateFeeAmount=20;combinedReturn.actualReturnedAt=combinedAt;
 combinedReturn.returnDecision={actualReturnedAt:combinedAt,damageKept:30,depositKept:0,claimBasis:'severe_cosmetic_damage',damageNote:combinedDamageReason,claimItemKey:'fixture-item',claimEvidenceIds:[combinedEvidence],chargeLate:true,lateClaimReason:combinedLateReason,ownerClaimAuthorizedAt:Date.now(),inspection:[{key:'fixture-item',title:line.title,condition:'issue',details:combinedDamageReason,openCase:false}]};
 const combinedRequestId=`return-${String(combinedReturn._id).replace(/[^A-Za-z0-9-]/g,'-').slice(-36)}-${Math.trunc(combinedAt)}-combined`;
 const combinedAssessment={damageAmountPence:3000,damageOffsetPence:0,damageReason:combinedDamageReason,lateAmountPence:2000,lateReason:combinedLateReason};
 const combinedReason=`Damage/loss 30.00: ${combinedDamageReason}\nLate fee 20.00: ${combinedLateReason}`;
 const combinedClaim={token:owner,bookingId:combinedReturn._id,requestId:combinedRequestId,kind:'damage',claimBasis:'severe_cosmetic_damage',itemKey:'fixture-item',evidenceIds:[combinedEvidence],returnAssessment:combinedAssessment,amount:50,reason:combinedReason};
 const beforeCombined=createCalls;
 await assert.rejects(actions.submitReturnDecisionClaim.handler(actionCtx,{...combinedClaim,evidenceIds:undefined}),/combined claim does not match the frozen owner-authorized return decision/,'combined claim cannot omit the owner-selected evidence');
 await assert.rejects(actions.submitReturnDecisionClaim.handler(actionCtx,{...combinedClaim,amount:49}),/combined claim does not match the frozen owner-authorized return decision/,'combined claim cannot alter the total after owner approval');
 assert.equal(createCalls,beforeCombined,'invalid combined-return attempts never reach the payment provider');
 const combinedResult=await actions.submitReturnDecisionClaim.handler(actionCtx,combinedClaim);
 assert.equal(combinedResult.status,'paid','one frozen combined return assessment can complete');
 assert.equal(createCalls,beforeCombined+1,'damage and late fees share exactly one card attempt');
 const combinedRow=await db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',combinedReturn._id)).first();
 assert.equal(combinedRow.amountPence,5000);assert.deepEqual(combinedRow.returnAssessment,combinedAssessment);assert.equal(combinedRow.reason,combinedReason);
 assert.equal(combinedReturn.lateFeePaidFromCard,20,'the combined paid receipt records the late-fee component separately');
 assert(emailCalls.some(mail=>mail.html?.includes('Damage/loss: £30.00')&&mail.html.includes('Late fee: £20.00')&&mail.html.includes('Total: £50.00')),'the notice itemises damage, late fee and one combined total');
 const combinedReplay=await actions.submitReturnDecisionClaim.handler(actionCtx,combinedClaim);
 assert.equal(combinedReplay.status,'paid');assert.equal(createCalls,beforeCombined+1,'a replay with the stable combined request key does not charge again');
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,bookingId:combinedReturn._id,requestId:'later-second-claim-attempt-01',amount:1}),/one combined, frozen itemised/,'the generic admin claim route cannot create a second assessment after return');
 assert.equal(createCalls,beforeCombined+1,'a second distinct request ID never creates a second return charge');
 emailCalls=[];

 highValue.returnDecision.damageKept=300;
 const highValueEvidence=await makeEvidence(highValue,'highcap001');
 const highValueClaim={token:owner,ownerClaimToken:ownerClaimFixture,confirmed:true,bookingId:highValue._id,requestId:'v26-scaled-cap-claim-001',kind:'damage',claimBasis:'severe_cosmetic_damage',itemKey:'fixture-item',evidenceIds:[highValueEvidence],amount:251,reason:'Documented permanent camera damage exceeds the return inspection amount.'};
 const chargesBeforeHighValue=createCalls;
 await assert.rejects(actions.submitClaim.handler(actionCtx,highValueClaim),/combined damage and late-fee card limit/,'a £251 claim cannot exceed the £250 limit for £4,500 of equipment');
 assert.equal(createCalls,chargesBeforeHighValue,'an over-cap claim never reaches the payment provider');
 const atHighValueCap=await actions.submitClaim.handler(actionCtx,{...highValueClaim,requestId:'v26-scaled-cap-claim-002',amount:250});
 assert.equal(atHighValueCap.status,'paid','a claim at the agreed £250 ceiling for £4,500 remains payable when evidence supports it');
 assert.equal(highValue.savedCardChargePaidPence,25000,'the payment ledger records no more than the scaled equipment-value ceiling');
 emailCalls=[];

 const createsBeforePublicSubmit=createCalls;
 const first=await actions.submitClaim.handler(actionCtx,args);
 assert.equal(first.status,'paid');assert.equal(createCalls,createsBeforePublicSubmit+1,'One submit makes one idempotent off-session attempt');
 const archivedCase=tables.get('rental_damage_cases').find(row=>row.bookingId===clean._id&&row.itemKey==='fixture-item');assert(archivedCase,'a claimed damaged item opens a rental case');assert(tables.get('chat_case_archives').some(row=>row.caseId===archivedCase._id&&row.bookingId===clean._id),'claim evidence chat is permanently archived for the case');
 const notice=emailCalls.find(message=>message.subject.includes('assessment'));
 assert(notice.html.includes('£20.00'));assert(notice.html.includes(reason),'notice email includes the exact recorded reason');
 assert(notice.html.includes('attached itemised claim invoice'));assert.equal(notice.attachments.length,2,'claim email attaches the pre-charge PDF and selected evidence');assert.match(notice.attachments[0].filename,/claim-invoice/);assert.match(notice.attachments[1].filename,/damage-main001/);assert.equal(notice.deliveryKey,`rental-context:rental-security:charge-${String(first.id)}`,'notice email has a durable booking-thread idempotency key');
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
 const refundEmail=emailCalls.at(-1);assert.match(refundEmail.subject,/refund confirmed/i);assert.match(refundEmail.html,/£10\.00/);assert.match(refundEmail.html,/corrected the repair estimate/);assert.match(refundEmail.html,/not account credit/);assert.equal(refundEmail.deliveryKey,`rental-context:rental-security:refund-${String(refundNotice._id)}`);assert.match(refundEmail.attachments[0].filename,/assessment-update/);
 assert.equal((await db.get(refundNotice._id)).status,'sent');assert.equal((await db.get(first.id)).refundEmailStatus,'sent');
 const replay=await actions.submitClaim.handler(actionCtx,args);
 assert.equal(replay.status,'paid');assert.equal(createCalls,createsBeforePublicSubmit+1,'Replaying the same request does not make a second charge');
 const paid=await db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',clean._id)).first();
 assert.equal(paid.state,'paid');assert.equal(paid.paidPence,2000);assert.equal(paid.reason,reason);
 global.fetch=async url=>{const parsed=new URL(url);assert.equal(parsed.searchParams.get('phase'),'assessment');assert.equal(parsed.searchParams.get('assessment'),String(paid._id));return new Response('%PDF-fixture',{status:200,headers:{'content-type':'application/pdf'}});};
 await actions.sendReceipt.handler(actionCtx,{id:paid._id});
 global.fetch=originalFetch;
 const receipt=emailCalls.at(-1);assert(receipt.html.includes('£20.00'));assert(receipt.html.includes(reason));assert.equal(receipt.attachments[0].filename,`DbCinema-assessment-${String(paid._id).slice(-8)}.pdf`);
 const pdfSource=fs.readFileSync('src/lib/invoice/InvoiceDocument.tsx','utf8');assert(pdfSource.includes('{assessment.reason}'));assert(pdfSource.includes('Proposed itemised claim · not yet collected'));assert(pdfSource.includes('Supporting evidence attached'));assert(pdfSource.includes('does not replace the original rental invoice'));
 assert.equal((await db.get(clean._id)).savedCardChargePaidPence,2000,'successful charge is recorded on the rental ledger');
 const authentication=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION),authEvidence=await makeEvidence(authentication,'auth001');bankMode='auth';const createsBeforeAuthentication=createCalls;
 const authResult=await actions.submitClaim.handler(actionCtx,{...args,bookingId:authentication._id,requestId:'v22-sca-claim-request-001',amount:10,itemKey:'fixture-item',evidenceIds:[authEvidence]});
 assert.equal(authResult.status,'requires_action');assert.equal((await db.get(authentication._id)).savedCardChargePaidPence??0,0);assert.equal((await db.get(authentication._id)).savedCardChargeReservedPence,1000);
 const authRow=await db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',authentication._id)).first();assert(tables.get('messages').some(message=>message.bookingId===authentication._id&&message.text.includes('bank requires an extra approval')));
 const authRetry=await actions.submitClaim.handler(actionCtx,{...args,bookingId:authentication._id,requestId:'v22-sca-claim-request-001',amount:10,itemKey:'fixture-item',evidenceIds:[authEvidence]});assert.equal(authRetry.status,'requires_action');assert.equal(createCalls,createsBeforeAuthentication+1,'SCA replay does not create a second payment intent');
 assert.equal((await actions.refresh.handler(actionCtx,{token:owner,id:authRow._id,admin:true})).clientSecret,undefined,'admin does not receive renter SCA secret');
 bankMode='decline';const declined=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION),declineEvidence=await makeEvidence(declined,'decline001');const createsBeforeDecline=createCalls;
 const declineResult=await actions.submitClaim.handler(actionCtx,{...args,bookingId:declined._id,requestId:'v22-decline-claim-request-1',amount:10,itemKey:'fixture-item',evidenceIds:[declineEvidence]});assert.equal(declineResult.status,'failed');
 assert.equal((await db.get(declined._id)).savedCardChargePaidPence??0,0);assert.equal((await db.get(declined._id)).savedCardChargeReservedPence,0);
 const declineReplay=await actions.submitClaim.handler(actionCtx,{...args,bookingId:declined._id,requestId:'v22-decline-claim-request-1',amount:10,itemKey:'fixture-item',evidenceIds:[declineEvidence]});assert.equal(declineReplay.status,'failed');assert.equal(createCalls,createsBeforeDecline+1,'a declined payment is not retried automatically');
 const issueFree=rental(immediate,legal.IMMEDIATE_CLAIM_LEGAL_VERSION);await db.patch(issueFree._id,{returnDecision:{damageKept:0,inspection:[{listingId:line.listingId,condition:'good',note:''}]},lateFeeAmount:0});
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,bookingId:issueFree._id,requestId:'v22-clean-return-claim-01',amount:1}),/item-specific inspected issue/,'clean return cannot create a damage claim');
 const issueFreeEvidence=await makeEvidence(issueFree,'cleanlate001');
 await assert.rejects(actions.submitClaim.handler(actionCtx,{...args,bookingId:issueFree._id,requestId:'v22-clean-late-claim-001',kind:'late',claimBasis:undefined,itemKey:undefined,evidenceIds:[issueFreeEvidence],amount:1}),/remaining recorded assessment/,'clean return cannot create a late-fee claim');
 console.log('PASS immediate saved-card claims: v20/v21 stay seven-day; v22 exact consent only; admin auth and amount/reason checks; itemised email/chat/PDF statement; Stripe idempotency, SCA, decline, and clean-return no-claim safeguards.');
})().catch(async error=>{
 console.error(error);process.exitCode=1;
});
