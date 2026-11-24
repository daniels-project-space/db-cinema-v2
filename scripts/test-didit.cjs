/** Didit webhook and booking approval boundary. No provider calls or customer data. */
const assert = require('node:assert/strict');
const { createHmac, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const reviewNotices = [];
const rentalEmailCalls = [];

function load(file) {
  const filename = path.resolve(__dirname, '..', file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const refs = new Proxy({}, { get: (_, group) => new Proxy({}, { get: (_, name) => `${String(group)}:${String(name)}` }) });
  const mock = {
    './_generated/server': { action: x => x, internalAction: x => x, internalMutation: x => x, internalQuery: x => x, mutation: x => x, query: x => x },
    './_generated/api': { internal: refs, api: refs },
    './adminAuth': { assertAdmin: () => {} },
    './availability': { peak: () => 0 },
    './lib/swapStockFence': { assertSwapStockReconciled: async () => {}, assertActiveItemSwapReady: async () => {}, expireUnacceptedItemSwap: async () => null },
    './lib/rmv2SyncQueue': { queueRmv2Sync: async () => {} },
    './lib/adminPush': { queueOwnerNotification: async (_ctx, notice) => { reviewNotices.push(notice); } },
    './lib/rentalEmailQueue': { queueRentalEmail: async (...args) => { rentalEmailCalls.push(args); return 'test-email-delivery'; } },
    './lib/rentalExposure': { assertRenterExposure: async () => ({}), renterExposure: async () => ({}), replacementValues: async () => ({}), attachRenterPerson: async () => {} },
    './verificationArchive': { queueVerificationArchive: async () => {}, assertVerificationArchive: async () => {} },
  };
  new Function('require', 'module', 'exports', source)((name) => {
    if (name in mock) return mock[name];
    if (name.startsWith('.')) {
      let target = path.resolve(path.dirname(filename), name);
      if (!path.extname(target) && fs.existsSync(`${target}.ts`)) target += '.ts';
      if (target.endsWith('.ts')) return load(path.relative(path.resolve(__dirname, '..'), target));
      return require(target);
    }
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}

Object.assign(process.env, {
  DIDIT_API_KEY: 'unused', DIDIT_WORKFLOW_ID: 'workflow-1', DIDIT_WEBHOOK_SECRET: 'webhook-test-secret',
  DIDIT_WEBHOOK_SECRET_PREVIOUS: 'webhook-previous-test-secret',
  DIDIT_APPLICATION_ID: 'application-1', DIDIT_ENVIRONMENT: 'sandbox', INVOICE_SECRET:'didit-test-identity-secret',
});

const { webhook, bookingSession, adminReview, reconcileOpenSessions, reconcileAmbiguousWebhook, refreshProgress } = load('convex/didit.ts');
const { setDiditResult, setDiditSession, adminSetIdStatus, setDiditManualReview, retryPaidDiditConfirmation, claimDiditProgressRefresh } = load('convex/bookings.ts');
const { assertDiditCheckoutCapacity } = load('convex/lib/diditCapacity.ts');
const reviewClaims = load('convex/diditReviewClaims.ts');

function signed(event, secret = process.env.DIDIT_WEBHOOK_SECRET) {
  const sort = value => Array.isArray(value) ? value.map(sort) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])])) : value;
  const body = JSON.stringify(event);
  return {
    body,
    signature: createHmac('sha256', secret).update(JSON.stringify(sort(event))).digest('hex'),
    timestamp: String(event.timestamp),
  };
}

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const retryBooking = {_id:'booking-confirmation-retry',status:'pending_verification',verificationProvider:'didit',diditSessionId:'approved-session',idVerifyStatus:'verified',guestEmail:'omar@example.invalid',checkoutPaidAt:now*1000,stripeCheckoutSessionId:'cs-paid',verificationChecks:{identity:'approved',selfie:'approved',address:'approved'}};
  const confirmationJobs=[];
  const retryMutationCtx={db:{get:async id=>id===retryBooking._id?retryBooking:null,patch:async(_id,patch)=>Object.assign(retryBooking,patch)},scheduler:{runAfter:async(...args)=>confirmationJobs.push(args)}};
  const diditFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({session_id:'approved-session',session_kind:'user',vendor_data:`dbc-booking-${retryBooking._id}`,contact_details:{email:retryBooking.guestEmail},workflow_id:'workflow-1',status:'Approved',decision_trace:{decided_at:new Date(now*1000).toISOString()}})});
  try {
    const result=await refreshProgress.handler({runQuery:async()=>retryBooking,runMutation:async(ref,args)=>{
      if(ref==='adminAuth:assertAdminInternal')return true;
      if(ref==='bookings:claimDiditProgressRefresh')return claimDiditProgressRefresh.handler(retryMutationCtx,args);
      if(ref==='bookings:retryPaidDiditConfirmation')return retryPaidDiditConfirmation.handler(retryMutationCtx,args);
      throw Error(`Unexpected verification recovery call: ${ref}`);
    }},{bookingId:retryBooking._id,accountToken:'admin-token',admin:true});
    assert.equal(result.status,'confirmation_retry_queued','a stored Didit approval retries the paid rental confirmation even when the website already shows verification as passed');
    assert.equal(confirmationJobs.length,1,'the recovered approval schedules one safe live-stock/payment confirmation');
    assert.equal(confirmationJobs[0][1],'checkout:confirmAfterVerification');
    const duplicate=await refreshProgress.handler({runQuery:async()=>retryBooking,runMutation:async(ref,args)=>{
      if(ref==='adminAuth:assertAdminInternal')return true;
      if(ref==='bookings:claimDiditProgressRefresh')return claimDiditProgressRefresh.handler(retryMutationCtx,args);
      if(ref==='bookings:retryPaidDiditConfirmation')return retryPaidDiditConfirmation.handler(retryMutationCtx,args);
      throw Error(`Unexpected duplicate verification recovery call: ${ref}`);
    }},{bookingId:retryBooking._id,accountToken:'admin-token',admin:true});
    assert.equal(duplicate.status,'throttled','confirmation recovery is rate-limited against duplicate admin or renter refreshes');
    assert.equal(confirmationJobs.length,1);
  } finally { globalThis.fetch=diditFetch; }
  const event = {
    event_id: 'event-1', webhook_type: 'status.updated', timestamp: now, created_at: now,
    application_id: 'application-1', environment: 'sandbox', workflow_id: 'workflow-1',
    session_id: 'session-1', vendor_data: 'dbc-booking-booking-1', status: 'Approved',
    decision: {
      status: 'Approved', id_verifications: [{status: 'Approved',full_name:'Test Rental Customer',date_of_birth:'1990-01-01'}],
      liveness_checks: [{status: 'Approved'}], face_matches: [{status: 'Approved'}],
      poa_verifications: [{status: 'Approved', poa_parsed_address: {postal_code: 'SW1A 1AA'}}],
      decision_trace: { automatic_status: 'In Review', decided_by: 'manual', decided_at: new Date(now * 1000).toISOString() },
    },
  };
  let result;const ownerAlerts=[];
  const ctx = { runMutation: async (ref, args) => { if(ref==='bookings:flagDiditWebhookRejection'){ownerAlerts.push(args);return true;}assert.equal(ref, 'bookings:setDiditResult'); result = args; return true; } };
  assert.equal(await webhook.handler(ctx, signed(event)), true);
  assert.equal(result.status, 'verified');
  assert.equal(result.decisionAt, now * 1000, 'a final manual approval is authoritative even when Didit retains an earlier automatic In Review trace');
  assert.deepEqual(result.poaPostcodes, ['SW1A 1AA']);
  const identity = JSON.stringify(['test rental customer', '1990-01-01']);
  assert.equal(result.personKey, createHmac('sha256', process.env.INVOICE_SECRET).update(`dbc-person-v1:${identity}`).digest('hex'), 'legacy invoice secret remains the default identity key');
  process.env.RESTRICTED_IDENTITY_HMAC_SECRET = 'dedicated-stable-restricted-identity-key';
  await webhook.handler(ctx, signed({...event, event_id:'event-dedicated-identity-key'}));
  assert.equal(result.personKey, createHmac('sha256', process.env.RESTRICTED_IDENTITY_HMAC_SECRET).update(`dbc-person-v1:${identity}`).digest('hex'), 'dedicated stable key is used when configured');
  delete process.env.RESTRICTED_IDENTITY_HMAC_SECRET;
  const flagged = {...event.decision, id_verifications: [{...event.decision.id_verifications[0], warnings: [{risk: 'FRAME_INJECTION_SUSPECTED', log_type: 'information'}]}]};
  assert.equal(await webhook.handler(ctx, signed({...event, event_id:'event-warning', decision:flagged})), true);
  assert.equal(result.status, 'verified', 'an informational warning does not override Didit approval');
  assert.equal(await webhook.handler(ctx, signed({...event, event_id:'event-approved-feature-review', decision:{...event.decision,id_verifications:[{status:'In Review'}]}})), true);
  assert.equal(result.status, 'verified', 'Didit’s final Approved session status wins over a stale feature-level review label');
  assert.deepEqual(result.checks, {identity:'approved',selfie:'approved',address:'approved'}, 'the website does not invent its own review gate after Didit’s final approval');
  const providerReviewEvent = {...event, event_id:'event-provider-review', status:'In Review', decision:{
    ...event.decision,
    warnings:[{feature:'POA',risk:'ADDRESS_MISMATCH',short_description:'Proof of address requires review.',long_description:'Private extended details.',additional_data:{document_number:'must-not-persist'}}],
    poa_verifications:[{status:'In Review'}],
  }};
  assert.equal(await webhook.handler(ctx, signed(providerReviewEvent)), true);
  assert.equal(result.status, 'manual_review', 'a provider-level In Review stays pending even if prior workflow checks had passed');
  assert.equal(result.providerStatus, 'In Review');
  assert.equal(result.note, 'Didit requested a team review: Proof of address requires review.', 'the provider review reason is surfaced without its extended/private payload');
  assert.equal(JSON.stringify(result).includes('must-not-persist'), false, 'provider PII and additional data never enter the booking note');
  const providerReviewWithoutWarning = {...event, event_id:'event-provider-review-feature-only', status:'In Review', decision:{
    ...event.decision,
    warnings:[],
    id_verifications:[{status:'In Review'}],
    liveness_checks:[{status:'Approved'}], face_matches:[{status:'Approved'}], poa_verifications:[{status:'Approved'}],
  }};
  await webhook.handler(ctx, signed(providerReviewWithoutWarning));
  assert.equal(result.status, 'manual_review');
  assert.equal(result.note, 'Didit requested a team review of the photo ID.', 'feature-level review is identified even if Didit omits a warning description');
  await webhook.handler(ctx, signed(providerReviewEvent));
  const mappedProviderReview = { ...result };
  assert.equal(mappedProviderReview.note, 'Didit requested a team review: Proof of address requires review.');
  await webhook.handler(ctx, signed({...event, event_id:'event-unreadable-id', status:'Declined', decision:{
    id_verifications:[{status:'Declined',warnings:[{risk:'PORTRAIT_IMAGE_NOT_DETECTED'}]}],
    liveness_checks:[{status:'Approved'}],face_matches:[{status:'Declined'}],poa_verifications:[{status:'Approved'}],decision_trace:{decided_by:'automatic'},
  }}));
  assert.equal(result.status,'rejected');
  assert.match(result.note,/could not read your photo ID/i);
  assert.equal(result.checks.address,'approved','a failed ID does not erase an independently approved address');
  await webhook.handler(ctx, signed({...event, event_id:'event-other-decline',status:'Declined',decision:{id_verifications:[{status:'Declined',warnings:[{risk:'UNRECOGNIZED_CODE'}]}],decision_trace:{decided_by:'automatic'}}}));
  assert.match(result.note,/contact the team/i,'unknown failure reasons do not expose provider codes or invent a cause');
  await webhook.handler(ctx,signed({...event,event_id:'event-human-decline',status:'Declined',decision:{id_verifications:[{status:'Declined'}],decision_trace:{decided_by:'manual'}}}));
  assert.equal(result.status,'rejected');assert.match(result.note,/cannot offer another attempt/i,'manual Didit declines do not masquerade as renter-retryable failures');
  await webhook.handler(ctx,signed({...event,event_id:'event-kyc-expired',status:'Kyc Expired',decision:{id_verifications:[{node_id:'expired-id',status:'Kyc Expired',expiration_date:'2020-01-01'}],liveness_checks:[{status:'Approved'}],face_matches:[{status:'Approved'}],poa_verifications:[{status:'Approved'}]}}));
  assert.equal(result.status,'requires_input','an expired ID requests a replacement rather than looking like an identity rejection');
  assert.match(result.note,/photo ID has expired/i);assert.equal(result.checks.identity,'requires_input');assert.equal(result.checks.address,'approved');
  assert.equal(await webhook.handler(ctx, signed({...event, event_id:'event-top-warning', decision:{...event.decision, warnings:[{risk:'OTHER'}]}})), true);
  assert.equal(result.status, 'verified', 'a provider warning does not override Didit approval');
  const currentSignature = signed({...event, event_id: 'event-previous'});
  assert.equal(await webhook.handler(ctx, {...currentSignature, signature: '0'.repeat(64), previousSignature: currentSignature.signature}), true,
    'a previous-signature header signed with the current key remains valid');
  const rotatedSignature = signed({...event, event_id: 'event-rotated'}, process.env.DIDIT_WEBHOOK_SECRET_PREVIOUS);
  assert.equal(await webhook.handler(ctx, {...rotatedSignature, signature: '0'.repeat(64), previousSignature: rotatedSignature.signature}), true,
    'the previous-signature header is checked with the configured previous key during Didit key rotation');
  const rawSignature = signed({...event, event_id: 'event-raw'});
  assert.equal(await webhook.handler(ctx, {...rawSignature, signature: '0'.repeat(64), rawSignature: createHmac('sha256', process.env.DIDIT_WEBHOOK_SECRET).update(rawSignature.body).digest('hex')}), true,
    'a valid full-body raw signature is accepted when V2 is unavailable');
  assert.equal(await webhook.handler(ctx, signed({...event, event_id: 'event-2', decision: {...event.decision, poa_verifications: []}})), true);
  assert.equal(result.status, 'verified', 'Didit final approval auto-approves even when feature details are omitted');
  assert.deepEqual(result.checks, {identity:'approved',selfie:'approved',address:'approved'}, 'the final provider approval backs all verification stages');
  const bindingCalls=[];
  const staleBindingCtx={runQuery:async(ref)=>{
    assert.equal(ref,'bookings:verificationAccess');
    return null;
  },runMutation:async(ref,args)=>{
    if(ref==='bookings:setDiditResult')return false;
    if(ref==='bookings:flagDiditWebhookRejection'){bindingCalls.push({ref,args});return true;}
    throw Error(`Unexpected mutation ${ref}`);
  }};
  const staleEvent={...event,event_id:'old-session-event',session_id:'old-session'};
  assert.equal(await webhook.handler(staleBindingCtx,signed(staleEvent)),false,'A validly signed event from a non-current session is rejected without changing the booking');
  assert.deepEqual(bindingCalls[0].args,{reason:'booking_binding',bookingId:'booking-1',
    sessionRef:createHash('sha256').update('old-session').digest('hex').slice(0,12),
    eventRef:createHash('sha256').update('old-session-event').digest('hex').slice(0,12),providerStatus:'Approved'},
    'A binding rejection carries a booking link and bounded hashes, never raw provider session or event IDs');
  let staleRejectionAlerted=false;
  const outOfOrderCtx={runQuery:async(ref,args)=>{
    assert.equal(ref,'bookings:verificationAccess');
    assert.equal(args.bookingId,'booking-1');
    return {verificationProvider:'didit',diditSessionId:event.session_id,diditEventId:'newer-approved-event',diditEventAt:(now+1)*1000};
  },runMutation:async(ref)=>{
    if(ref==='bookings:setDiditResult')return false;
    if(ref==='bookings:flagDiditWebhookRejection'){staleRejectionAlerted=true;return true;}
    throw Error(`Unexpected mutation ${ref}`);
  }};
  assert.equal(await webhook.handler(outOfOrderCtx,signed({...event,event_id:'delayed-in-progress',created_at:now-1,status:'In Progress'})),true,
    'A signed but superseded status event is acknowledged so Didit does not treat normal out-of-order delivery as a rejected webhook');
  assert.equal(staleRejectionAlerted,false,'a superseded event does not create a false webhook-rejection warning');
  result = null;
  assert.equal(await webhook.handler(ctx, {...signed(event), signature: '0'.repeat(64)}), false);
  assert.equal(result, null, 'forged callback must not change booking');
  assert.deepEqual(ownerAlerts.at(-1),{reason:'signature'},'a forged callback that claims the configured Didit app creates a rate-limited operational alert without booking data');
  const alertedCount=ownerAlerts.length;
  assert.equal(await webhook.handler(ctx,{...signed(event),signature:'0'.repeat(64),body:JSON.stringify({...event,application_id:'other-app'})}),false);
  assert.equal(ownerAlerts.length,alertedCount,'unrelated internet traffic is logged but does not page the owner');
  assert.equal(await webhook.handler(ctx, signed({...event, environment: 'live'})), false);
  assert.equal(await webhook.handler(ctx, signed({...event, timestamp: now - 3600})), false);
  assert.equal(await webhook.handler(ctx, signed({...event, event_id: 'event-expired', status: 'Expired'})), true);
  assert.equal(result.status, 'requires_input');
  assert.match(result.note, /link expired/);
  const resubmittedEvent = {...event, event_id: 'event-resubmitted', status: 'Resubmitted',
    resubmit_info: {nodes_to_resubmit: [{node_id: 'feature_poa', feature: 'PROOF_OF_ADDRESS'}], reasons: {feature_poa: 'Poor document quality'}}};
  delete resubmittedEvent.decision;
  assert.equal(await webhook.handler(ctx, signed(resubmittedEvent)), true);
  assert.equal(result.status, 'requires_input', 'a Didit resubmission webhook returns the booking to renter action');
  assert.equal(result.providerStatus, 'Resubmitted', 'webhook reconciliation keeps the provider session state attached to the booking update');
  assert.deepEqual(result.resubmissionFeatures, ['address'], 'the v3 resubmit_info feature maps the requested POA step without a decision object');
  assert.match(result.note, /proof of address.*Poor document quality/i, 'the renter-facing status carries the provider resubmission reason');
  const failureCalls=[];const broken={runMutation:async(ref,args)=>{failureCalls.push({ref,args});if(ref==='bookings:setDiditResult')throw Error('private provider detail');return true;}};
  assert.equal(await webhook.handler(broken,signed(event)),'processing_error','a signed callback with an internal failure is retryable, not malformed');
  assert.equal(failureCalls[1].ref,'bookings:flagDiditProcessingFailure');assert.equal(failureCalls[1].args.sessionId,event.session_id);
  failureCalls.length=0;assert.equal(await webhook.handler(broken,{...signed(event),signature:'0'.repeat(64)}),false);assert.equal(failureCalls.length,1,'a spoofed callback claiming this Didit application creates only a rate-limited operational alert');assert.equal(failureCalls[0].ref,'bookings:flagDiditWebhookRejection');assert.deepEqual(failureCalls[0].args,{reason:'signature'});
  failureCalls.length=0;assert.equal(await webhook.handler(broken,signed({...event,status:'Provider Added Status'})),'processing_error');assert.equal(failureCalls[0].ref,'bookings:flagDiditProcessingFailure','unknown signed statuses are surfaced instead of silently acknowledged');

  for (const idVerifyStatus of ['manual_review', 'rejected']) {
    let contactedProvider = false;
    const originalFetch = global.fetch;
    global.fetch = async () => { contactedProvider = true; throw Error('unexpected provider call'); };
    try {
      await assert.rejects(bookingSession.handler({runQuery:async()=>({status:'confirmed',verificationProvider:'didit',idVerifyStatus})},
        {bookingId:'booking-1'}),/not ready for verification/);
      assert.equal(contactedProvider,false);
    } finally { global.fetch = originalFetch; }
    assert.equal(await setDiditSession.handler({db:{get:async()=>({status:'confirmed',verificationProvider:'didit',idVerifyStatus})}},
      {bookingId:'booking-1',sessionId:'another-session'}),false);
  }

  for (const [billingAddress, expected] of [
    ['10 Downing Street, London SW1A 1AA', 'verified'],
    ['10 Downing Street, London SW1A 2AA', 'verified'],
    ['10 Downing Street, London', 'verified'],
  ]) {
    const booking = { _id:'booking-1',lineItems:[],verificationProvider: 'didit', diditSessionId: 'session-1', billingAddress, idVerifyStatus: 'processing', guestEmail: 'renter@example.invalid' };
    let patch;
    const db = {
      get: async () => booking,
      patch: async (_, value) => { patch = value; },
      query: () => ({ withIndex: () => ({ first: async () => null, collect: async () => [], take: async () => [] }) }),
    };
    const mutationCtx = { db, scheduler: { runAfter: async () => {} } };
    assert.equal(await setDiditResult.handler(mutationCtx, {
      bookingId: 'booking-1', sessionId: 'session-1', eventId: 'event-1', eventAt: now * 1000,
      status: 'verified', providerStatus: 'Approved', poaPostcodes: ['SW1A 1AA'],
    }), true);
    assert.equal(patch.idVerifyStatus, expected, billingAddress);
  }
  const reviewCase = {_id:'booking-1',status:'confirmed',lineItems:[],verificationProvider:'didit',diditSessionId:'session-1',idVerifyStatus:'processing',verificationNote:'Old note'};
  const reviewDb = {get:async()=>reviewCase,patch:async(_id,value)=>Object.assign(reviewCase,value),insert:async()=> 'review-email-id',
    query:()=>({withIndex:()=>({first:async()=>null,collect:async()=>[],take:async()=>[],order:()=>({take:async()=>[]})})})};
  await setDiditResult.handler({db:reviewDb,scheduler:{runAfter:async()=>{}}}, mappedProviderReview);
  assert.equal(reviewCase.verificationNote, mappedProviderReview.note, 'the specific provider review reason is persisted for the admin and renter status views');
  assert.equal(reviewNotices.at(-1)?.kind, 'verification_failure');
  assert.match(reviewNotices.at(-1)?.body, /Proof of address requires review/);
  assert(rentalEmailCalls.some(([, bookingId, kind, detail]) => bookingId === 'booking-1' && kind === 'verification' && detail.verificationStatus === 'manual_review'),
    'the website sends the single canonical manual-review update');
  const rejectedPaidBooking={_id:'booking-declined',status:'pending_verification',lineItems:[],verificationProvider:'didit',diditSessionId:'declined-session-1',idVerifyStatus:'manual_review',guestEmail:'renter@example.invalid',checkoutPaidAt:now*1000,checkoutPaymentAmountPence:10000,checkoutPaymentCurrency:'GBP',checkoutPaymentStatus:'paid',checkoutExpectedAmountPence:10000,stripeCheckoutSessionId:'cs_declined-1',stripePaymentIntentId:'pi_declined-1',currency:'GBP'};
  const rejectionJobs=[];
  const declinedHold={_id:'reservation-declined',status:'hold'};let declinedReservationReads=0;
  const queryChain={first:async()=>null,collect:async()=>[],take:async()=>[],unique:async()=>null,order:()=>queryChain};
  const omarBooking={_id:'booking-omar',status:'pending_verification',lineItems:[],verificationProvider:'didit',diditSessionId:'omar-session',idVerifyStatus:'manual_review',guestEmail:'omar@example.invalid',checkoutPaidAt:now*1000};
  const omarJobs=[];
  const omarDb={get:async id=>id===omarBooking._id?omarBooking:null,patch:async(_id,value)=>Object.assign(omarBooking,value),insert:async()=> 'omar-notice',query:()=>({withIndex:()=>queryChain,first:async()=>null})};
  await setDiditResult.handler({db:omarDb,scheduler:{runAfter:async(delay,reference,args)=>omarJobs.push({delay,reference,args})}},
    {bookingId:omarBooking._id,sessionId:omarBooking.diditSessionId,eventId:'omar-final-approved',eventAt:now*1000,decisionAt:now*1000,
      status:'verified',providerStatus:'Approved',checks:{identity:'approved',selfie:'approved',address:'approved'},poaPostcodes:[]});
  assert.equal(omarBooking.idVerifyStatus,'verified','a final Didit approval clears the website review state without a second human approval');
  assert(omarJobs.some(job=>job.reference==='checkout:confirmAfterVerification'),'the paid rental proceeds into the normal confirmation gates after Didit approves');
  const approvedConfirmedBooking={_id:'booking-approved-confirmed',status:'confirmed',lineItems:[],verificationProvider:'didit',diditSessionId:'approved-session',idVerifyStatus:'manual_review',guestEmail:'renter@example.invalid',checkoutPaidAt:now*1000};
  const approvedConfirmedDb={get:async()=>approvedConfirmedBooking,patch:async(_id,value)=>Object.assign(approvedConfirmedBooking,value),insert:async()=> 'identity-check-job',query:()=>({withIndex:()=>({first:async()=>null,unique:async()=>null,collect:async()=>[],take:async()=>[],order:()=>({take:async()=>[]})})})};
  rentalEmailCalls.length=0;
  await setDiditResult.handler({db:approvedConfirmedDb,scheduler:{runAfter:async()=>{}}},
    {bookingId:approvedConfirmedBooking._id,sessionId:approvedConfirmedBooking.diditSessionId,eventId:'approved-confirmed-event',eventAt:now*1000,decisionAt:now*1000,
      status:'verified',providerStatus:'Approved',personKey:'a'.repeat(64),checks:{identity:'approved',selfie:'approved',address:'waiting'},poaPostcodes:[]});
  assert.deepEqual(approvedConfirmedBooking.verificationChecks,{identity:'approved',selfie:'approved',address:'approved'},'top-level Didit approval normalizes stale feature progress at the authoritative transition');
  assert(rentalEmailCalls.some(([, bookingId, kind, detail]) => bookingId === approvedConfirmedBooking._id && kind === 'verification' && detail.verificationStatus === 'verified'),
    'an already-confirmed rental gets the canonical site approval email with its invoice and pickup details');
  const rejectionDb={get:async()=>rejectedPaidBooking,patch:async(_id,value)=>Object.assign(rejectedPaidBooking,value),insert:async()=> 'synthetic-id',query:(table)=>({withIndex:()=>({...queryChain,collect:async()=>{if(table==='reservations'){declinedReservationReads++;return [declinedHold]}return []}}),first:async()=>null})};
  await setDiditResult.handler({db:rejectionDb,scheduler:{runAfter:async(delay,reference,args)=>rejectionJobs.push({delay,reference,args})}},
    {bookingId:'booking-declined',sessionId:'declined-session-1',eventId:'declined-event-1',eventAt:now*1000,status:'rejected',providerStatus:'Declined',note:'Didit declined this verification.',poaPostcodes:[]});
  assert.equal(rejectionJobs.some(job=>job.reference==='checkout:cancelRejectedDiditAfterResult'),false,
    'a final paid Didit rejection remains pending for a team decision instead of starting settlement');
  assert.equal(rejectedPaidBooking.status,'pending_verification','Didit rejection does not confirm or cancel the paid booking');
  assert.equal(rejectedPaidBooking.idVerifyStatus,'rejected','the provider result remains visible for resolution');
  assert.equal(declinedHold.status,'hold','a Didit rejection preserves the paid rental allocation until a decision');
  assert.equal(declinedReservationReads,0,'a Didit rejection does not delete local stock holds');
  assert(rentalEmailCalls.some(([, bookingId, kind, detail]) => bookingId === 'booking-declined' && kind === 'verification' && detail.verificationStatus === 'rejected'),
    'a Didit decline uses the canonical website email rather than a provider email');
  const resubmittedBooking={...rejectedPaidBooking,_id:'booking-resubmitted',diditSessionId:'resubmission-session',diditEventId:undefined,diditEventAt:undefined,idVerifyStatus:'manual_review',
    verificationChecks:{identity:'approved',selfie:'approved',address:'review'}};
  const resubmittedDb={...rejectionDb,get:async()=>resubmittedBooking,patch:async(_id,value)=>Object.assign(resubmittedBooking,value)};
  rentalEmailCalls.length=0;
  await setDiditResult.handler({db:resubmittedDb,scheduler:{runAfter:async()=>{}}},
    {bookingId:resubmittedBooking._id,sessionId:resubmittedBooking.diditSessionId,eventId:'resubmission-event',eventAt:now*1000,
      status:'requires_input',providerStatus:'Resubmitted',note:'Please replace the address document.',poaPostcodes:[],resubmissionFeatures:['address']});
  assert.deepEqual(resubmittedBooking.verificationChecks,{identity:'approved',selfie:'approved',address:'requires_input'},
    'a provider resubmission flags only the selected document and preserves completed checks');
  assert(rentalEmailCalls.some(([, bookingId, kind, detail]) => bookingId === 'booking-resubmitted' && kind === 'verification' && detail.verificationStatus === 'requires_input'),
    'a Didit resubmission uses the canonical website email with a link back to verification');
  const noReceiptJobs=[];
  const noReceiptBooking={...rejectedPaidBooking,_id:'booking-no-receipt',diditSessionId:'unpaid-session',checkoutPaymentStatus:undefined};
  const noReceiptDb={...rejectionDb,get:async()=>noReceiptBooking,patch:async(_id,value)=>Object.assign(noReceiptBooking,value)};
  await setDiditResult.handler({db:noReceiptDb,scheduler:{runAfter:async(delay,reference,args)=>noReceiptJobs.push({delay,reference,args})}},
    {bookingId:'booking-no-receipt',sessionId:'unpaid-session',eventId:'unpaid-declined-event',eventAt:now*1000,status:'rejected',providerStatus:'Declined',note:'Didit declined this verification.',poaPostcodes:[]});
  assert.equal(noReceiptJobs.some(job=>job.reference==='checkout:cancelRejectedDiditAfterResult'),false,'a booking without a verified paid checkout receipt never starts settlement');
  const manuallyApproved = {status:'confirmed',verificationProvider:'didit',diditSessionId:'session-1',
    billingAddress:'10 Downing Street SW1A 1AA',idVerifyStatus:'verified',idVerificationSource:'manual'};
  let manualPatch;
  const manualCtx = {db:{get:async()=>manuallyApproved,patch:async(_id,value)=>{manualPatch=value;}}};
  assert.equal(await setDiditResult.handler(manualCtx,{
    bookingId:'booking-1',sessionId:'session-1',eventId:'event-late',eventAt:now*1000,
    status:'manual_review',providerStatus:'Approved',poaPostcodes:[],
  }),true);
  assert.equal(manualPatch.idVerifyStatus,undefined,'a feature-level review cannot undo explicit admin approval');
  await assert.rejects(adminSetIdStatus.handler({db:{get:async()=>({status:'confirmed',verificationProvider:'didit',idVerifyStatus:'required'})}},
    {token:'admin',bookingId:'booking-1',status:'verified',note:'Reviewed evidence'}),/Didit review action/);
  const sessionUrl = 'https://verify.didit.me/session/session-1';
  const report = {session_id:'session-1',session_kind:'user',workflow_id:'workflow-1',
    vendor_data:'dbc-booking-booking-1',contact_details:{email:'renter@example.invalid'},
    session_url:sessionUrl,status:'In Review',
    id_verifications:[{status:'Declined',node_id:'feature_ocr',full_name:'Test Rental Customer',date_of_birth:'1990-01-01'}],
    liveness_checks:[{status:'Approved',node_id:'feature_liveness'}],
    face_matches:[{status:'Approved',node_id:'feature_face'}],
    poa_verifications:[{status:'Approved',node_id:'feature_poa'}]};
  const reviewBooking = {status:'confirmed',verificationProvider:'didit',idVerifyStatus:'manual_review',
    diditSessionId:'session-1',guestEmail:'renter@example.invalid',lineItems:[{start:Date.UTC(2026,11,6),end:Date.UTC(2026,11,7),pickupTime:'16:00'}],pickupTime:'16:00'};
  const lockedBooking = {...reviewBooking};
  const lockCtx = {db:{get:async()=>lockedBooking,patch:async(_id,fields)=>Object.assign(lockedBooking,fields)}};
  await reviewClaims.claim.handler(lockCtx,{bookingId:'booking-1',sessionId:'session-1',decision:'approve',requestId:'review-request-claim-0001'});
  await assert.rejects(reviewClaims.claim.handler(lockCtx,{bookingId:'booking-1',sessionId:'session-1',decision:'decline',requestId:'review-request-claim-0002'}),/already being sent/,'a competing decision is rejected while the original reviewer lease is active');
  await assert.rejects(reviewClaims.claim.handler(lockCtx,{bookingId:'booking-1',sessionId:'session-1',decision:'decline',requestId:'review-request-claim-0001'}),/another decision/,'the same request ID cannot switch decisions');
  await reviewClaims.markUnknown.handler(lockCtx,{bookingId:'booking-1',sessionId:'session-1',requestId:'review-request-claim-0001',expectedAccountId:null,expectedEmail:'renter@example.invalid',auditMarker:'a'.repeat(32)});
  await reviewClaims.release.handler(lockCtx,{bookingId:'booking-1',sessionId:'session-1',requestId:'review-request-claim-0001'});
  lockedBooking.diditReviewClaim.startedAt = Date.now() - 300000;
  await assert.rejects(reviewClaims.claim.handler(lockCtx,{bookingId:'booking-1',sessionId:'session-1',decision:'decline',requestId:'review-request-claim-0002'}),/previous Didit decision may have been received/i,'an unknown outcome blocks a fresh decision even after the lease expires');
  assert.equal(await reviewClaims.reconcileConfirmed.handler(lockCtx,{bookingId:'booking-1',sessionId:'session-1',providerStatus:'In Review',expectedMarker:'a'.repeat(32)}),false,'an in-review read cannot rule out a delayed write');
  lockedBooking.idVerifyStatus='verified';
  assert.equal(await reviewClaims.reconcileConfirmed.handler(lockCtx,{bookingId:'booking-1',sessionId:'session-1',providerStatus:'Declined',expectedMarker:'a'.repeat(32)}),false,'a mismatched provider outcome does not release the claim');
  assert.equal(await reviewClaims.reconcileConfirmed.handler(lockCtx,{bookingId:'booking-1',sessionId:'session-1',providerStatus:'Approved',expectedMarker:'b'.repeat(32)}),false,'a stale audit result cannot release a different operation');
  assert.equal(await reviewClaims.reconcileConfirmed.handler(lockCtx,{bookingId:'booking-1',sessionId:'session-1',providerStatus:'Approved',expectedMarker:'a'.repeat(32)}),true,'after direct acknowledgement, matching provider and website results release the claim');
  assert.equal(lockedBooking.diditReviewClaim,undefined);
  const tiedEventAt = now * 1000;
  const tiedBooking = {_id:'booking-tied-events',status:'confirmed',verificationProvider:'didit',
    idVerifyStatus:'verified',diditSessionId:'session-tie-1234',diditEventId:'approved-event',
    diditEventAt:tiedEventAt,diditManualDecisionAt:null,guestEmail:'tie@example.invalid'};
  const ambiguousJobs=[];let tiedPatch=false;
  assert.equal(await setDiditResult.handler({db:{get:async()=>tiedBooking,patch:async()=>{tiedPatch=true;}},
    scheduler:{runAfter:async(delay,reference,args)=>ambiguousJobs.push({delay,reference,args})}},
    {bookingId:tiedBooking._id,sessionId:tiedBooking.diditSessionId,eventId:'same-second-decline',eventAt:tiedEventAt,
      status:'rejected',providerStatus:'Declined',poaPostcodes:[]}),true,
    'a tied webhook is acknowledged while its authoritative provider state is queued');
  assert.equal(tiedPatch,false,'arrival order cannot let a same-second decline overwrite approval');
  assert.equal(ambiguousJobs.length,1);
  assert.equal(ambiguousJobs[0].reference,'didit:reconcileAmbiguousWebhook');
  const ambiguousArgs=ambiguousJobs[0].args;
  const tiedFetch=global.fetch;let ambiguousGets=0;let snapshotMutation;
  try {
    global.fetch=async url=>{ambiguousGets++;assert.match(String(url),/session-tie-1234\/decision/);
      return new Response(JSON.stringify({...report,session_id:tiedBooking.diditSessionId,
        vendor_data:`dbc-booking-${tiedBooking._id}`,contact_details:{email:tiedBooking.guestEmail},status:'Approved'}),{status:200});};
    const reconciled=await reconcileAmbiguousWebhook.handler({
      runQuery:async(ref)=>{assert.equal(ref,'bookings:verificationAccess');return tiedBooking;},
      runMutation:async(ref,args)=>{assert.equal(ref,'bookings:setDiditResult');snapshotMutation=args;return true;},
    },ambiguousArgs);
    assert.equal(reconciled.status,'reconciled');
    assert.equal(snapshotMutation.status,'verified','the provider’s current Approved snapshot wins the ambiguous timestamp');
    assert.equal(snapshotMutation.providerStatus,'Approved');
    assert.equal(snapshotMutation.reconciliation,true);
    assert.equal(snapshotMutation.expectedEventId,'approved-event','the snapshot is compare-and-set against the event that queued it');
    assert.equal(ambiguousGets,1);
    tiedBooking.diditEventId=snapshotMutation.eventId;
    const staleRetry=await reconcileAmbiguousWebhook.handler({
      runQuery:async()=>tiedBooking,
      runMutation:async()=>{throw Error('a stale queued snapshot cannot mutate');},
    },ambiguousArgs);
    assert.equal(staleRetry.status,'stale','duplicate queued work is fenced after the first reconciliation');
    assert.equal(ambiguousGets,1,'stale duplicate work does not make another provider request');
  } finally {global.fetch=tiedFetch;}
  const originalFetch = global.fetch;
  const calls = [];
  let providerStatus = 'In Review', providerFetches = 0;
  const providerReport = () => ({session_id:'session-1',session_kind:'user',workflow_id:'workflow-1',vendor_data:'dbc-booking-booking-1',contact_details:{email:'renter@example.invalid'},status:providerStatus,decision_trace:{decided_at:'2026-11-19T08:00:00.000Z'},id_verifications:[{status:'Approved',full_name:'Test Rental Customer',date_of_birth:'1990-01-01'}],liveness_checks:[{status:'Approved'}],face_matches:[{status:'Approved'}],poa_verifications:[{status:'Approved'}]});
  for (const variant of ['matching','other-marker','other-actor','other-status','old','unavailable','legacy']) {
    const marker='a'.repeat(32), startedAt=Date.now()-1000;
    const auditBooking={...reviewBooking,idVerifyStatus:'verified',verificationChecks:{identity:'approved',selfie:'approved',address:'approved'},diditReviewClaim:{requestId:'review-request-audit-0001',sessionId:'session-1',decision:'approve',startedAt,outcomeUnknown:true,...(variant==='legacy'?{}:{auditMarker:marker})}};
    const auditDb={get:async()=>auditBooking,patch:async(_id,fields)=>Object.assign(auditBooking,fields)};
    const auditCtx={runQuery:async()=>({...auditBooking}),runMutation:async(ref,args)=>{
      if(ref==='adminAuth:assertAdminInternal'||ref==='bookings:claimDiditProgressRefresh')return true;
      if(ref==='bookings:setDiditResult'){auditBooking.idVerifyStatus=args.status;auditBooking.verificationChecks=args.checks;return true;}
      if(ref==='diditReviewClaims:reconcileConfirmed')return reviewClaims.reconcileConfirmed.handler({db:auditDb},args);
      if(ref==='bookings:flagDiditProcessingFailure')return true;
      throw Error(`Unexpected audit recovery call: ${ref}`);
    }};
    global.fetch=async url=>{
      if(String(url).includes('/reviews/')) {
        if(variant==='unavailable')return new Response('unavailable',{status:503});
        const event={activity_type:'STATUS_UPDATED',actor_type:variant==='other-actor'?'CONSOLE_USER':'API_KEY',new_status:variant==='other-status'?'Declined':'Approved',comment:`Reviewed\n[DBC review ${variant==='other-marker'?'b'.repeat(32):marker}]`,created_at:new Date(variant==='old'?startedAt-120000:startedAt+500).toISOString()};
        return new Response(JSON.stringify({results:[event],next:null}),{status:200});
      }
      return new Response(JSON.stringify({...providerReport(),status:'Approved'}),{status:200});
    };
    const result=await refreshProgress.handler(auditCtx,{bookingId:'booking-1',accountToken:'admin-token',admin:true});
    if(variant==='matching') {
      assert.notEqual(result.status,'decision_uncertain','the exact provider audit marker recovers the completed decision');
      assert.equal(auditBooking.diditReviewClaim,undefined);
    } else {
      assert.equal(result.status,'decision_uncertain',`${variant} is not operation-level proof`);
      assert.equal(auditBooking.diditReviewClaim.outcomeUnknown,true);
    }
  }
  global.fetch = async (url, options={}) => {
    providerFetches++;
    if (options.method === 'PATCH') { providerStatus = JSON.parse(options.body).new_status; return new Response(JSON.stringify({session_id:'session-1'}),{status:200}); }
    return new Response(JSON.stringify(providerReport()),{status:200});
  };
  const reviewCtx = {
    runQuery: async ref => { assert.equal(ref,'bookings:verificationAccess'); return reviewBooking; },
    runMutation: async (ref, args) => {
      calls.push({ref,args});
      if (ref === 'bookings:setDiditResult') return true;
      return true;
    },
  };
  try {
    providerFetches = 0; calls.length = 0;
    global.fetch=async (_url,options={})=>{
      providerFetches++;
      if(options.method==='PATCH')return new Response('temporary failure',{status:503});
      return new Response(JSON.stringify(providerReport()),{status:200});
    };
    await assert.rejects(adminReview.handler(reviewCtx,{token:'admin',bookingId:'booking-1',decision:'approve',note:'Reviewed identity evidence',requestId:'review-request-approve-0001'}),/temporarily unavailable/);
    assert.equal(providerFetches,3,'an ambiguous provider write is followed by one source-of-truth readback');
    assert.equal(calls.some(item=>item.ref==='bookings:setDiditResult'),false,'a failed provider update never changes the rental');
    assert(calls.some(item=>item.ref==='diditReviewClaims:claim')&&calls.some(item=>item.ref==='diditReviewClaims:release'),'the per-case operation claim is released after a provider failure');
    let unknownPatchCount=0;
    calls.length=0;
    global.fetch=async (_url,options={})=>{
      if(options.method==='PATCH'){unknownPatchCount++;throw Error('connection timed out');}
      if(unknownPatchCount)throw Error('readback unavailable');
      return new Response(JSON.stringify(providerReport()),{status:200});
    };
    await assert.rejects(adminReview.handler(reviewCtx,{token:'admin',bookingId:'booking-1',decision:'approve',note:'Reviewed identity evidence',requestId:'review-request-timeout-0001'}),/may have received|could not be confirmed/i);
    assert.equal(unknownPatchCount,1,'an unknown timeout never blindly repeats the provider update');
    assert.equal(calls.some(item=>item.ref==='bookings:setDiditResult'),false,'unconfirmed provider outcome never approves the website');
    const durableBooking={...reviewBooking};
    const durableDb={get:async()=>durableBooking,patch:async(_id,fields)=>Object.assign(durableBooking,fields)};
    const durableCtx={runQuery:async()=>({...durableBooking}),runMutation:async(ref,args)=>{
      if(String(ref).startsWith('diditReviewClaims:')) return reviewClaims[String(ref).split(':')[1]].handler({db:durableDb},args);
      if(ref==='bookings:setDiditResult') throw Error('unknown result must not approve the rental');
      return true;
    }};
    unknownPatchCount=0;
    await assert.rejects(adminReview.handler(durableCtx,{token:'admin',bookingId:'booking-1',decision:'approve',note:'Reviewed identity evidence',requestId:'review-request-timeout-0002'}),/may have received|could not be confirmed/i);
    assert.equal(durableBooking.diditReviewClaim.outcomeUnknown,true,'a timeout survives action cleanup as an unresolved claim');
    await assert.rejects(adminReview.handler(durableCtx,{token:'admin',bookingId:'booking-1',decision:'decline',note:'Reviewed identity evidence',requestId:'review-request-other-0002'}),/previous Didit decision may have been received/i);
    assert.equal(unknownPatchCount,1,'a competing fresh decision cannot reach Didit after an unknown timeout');
    for (const responseStatus of [400,401,403,408,409,429,500]) {
      const statusBooking={...reviewBooking};
      const statusDb={get:async()=>statusBooking,patch:async(_id,fields)=>Object.assign(statusBooking,fields)};
      const statusCtx={runQuery:async()=>({...statusBooking}),runMutation:async(ref,args)=>{
        if(String(ref).startsWith('diditReviewClaims:')) return reviewClaims[String(ref).split(':')[1]].handler({db:statusDb},args);
        if(ref==='bookings:setDiditResult') throw Error('unconfirmed response must not approve');
        return true;
      }};
      global.fetch=async (_url,options={})=>options.method==='PATCH'
        ? new Response('unconfirmed provider response',{status:responseStatus})
        : new Response(JSON.stringify(providerReport()),{status:200});
      await assert.rejects(adminReview.handler(statusCtx,{token:'admin',bookingId:'booking-1',decision:'approve',note:'Reviewed identity evidence',requestId:`review-http-${responseStatus}-0000000001`}));
      assert.equal(statusBooking.diditReviewClaim?.outcomeUnknown,true,`HTTP ${responseStatus} is not proof that a delayed provider write cannot land`);
    }
  } finally { global.fetch = originalFetch; }
  try {
    const approvalRequestId='review-request-approve-0002';
    let adminProviderStatus='In Review', adminPatchBody, adminPatchHeaders, appliedDecision;
    const adminCalls=[];
    global.fetch=async (url,options={})=>{
      const method=options.method ?? 'GET';
      adminCalls.push({url:String(url),method});
      if (method==='PATCH') {
        adminPatchBody=JSON.parse(options.body);
        adminPatchHeaders=options.headers;
        adminProviderStatus=adminPatchBody.new_status;
        return new Response(JSON.stringify({session_id:'session-1'}),{status:200});
      }
      return new Response(JSON.stringify({...providerReport(),status:adminProviderStatus}),{status:200});
    };
    const successfulReviewCtx={
      runQuery:async ref=>{assert.equal(ref,'bookings:verificationAccess');return reviewBooking;},
      runMutation:async(ref,args)=>{
        calls.push({ref,args});
        if(ref==='bookings:setDiditResult'){appliedDecision=args;return true;}
        return true;
      },
    };
    calls.length=0;
    const approval=await adminReview.handler(successfulReviewCtx,{token:'admin',bookingId:'booking-1',decision:'approve',note:'Reviewed identity evidence',requestId:approvalRequestId});
    assert.deepEqual(approval,{status:'verified',providerStatus:'Approved'});
    assert.equal(adminCalls.length,3,'the action reads Didit, updates without provider email, then confirms the result');
    assert.equal(adminPatchBody.new_status,'Approved');
    assert.equal(adminPatchBody.send_email,false,'renter notices use the website email path, which includes the invoice and pickup details');
    assert.equal(adminPatchBody.email_address,undefined);
    assert.equal(adminPatchBody.email_preview_token,undefined);
    assert.equal(adminPatchHeaders['Idempotency-Key'],approvalRequestId,'the provider write is idempotent for this review operation');
    assert.equal(appliedDecision.status,'verified','the website applies only Didit’s confirmed approval');
    assert.equal(appliedDecision.providerStatus,'Approved');
    assert.deepEqual(appliedDecision.checks,{identity:'approved',selfie:'approved',address:'approved'});
    assert.equal(appliedDecision.decisionAt,Date.parse('2026-11-19T08:00:00.000Z'),'the 90-day approval clock uses Didit’s decision timestamp, not the later refresh time');
    assert(calls.some(item=>item.ref==='diditReviewClaims:release'));

    const updatesBeforeStaleReview=adminCalls.filter(item=>item.method==='PATCH').length;
    await assert.rejects(adminReview.handler(successfulReviewCtx,{token:'admin',bookingId:'booking-1',decision:'decline',note:'Reviewed identity evidence',requestId:'review-request-decline-0001'}),/already changed/);
    assert.equal(adminCalls.filter(item=>item.method==='PATCH').length,updatesBeforeStaleReview,'a final Approved session cannot be overwritten from a stale review card');

    let ambiguousStatus='In Review', ambiguousPatchCount=0;
    global.fetch=async (_url,options={})=>{
      if(options.method==='PATCH') { ambiguousStatus='Approved'; ambiguousPatchCount++; return new Response('connection lost after update',{status:503}); }
      return new Response(JSON.stringify({...providerReport(),status:ambiguousStatus}),{status:200});
    };
    await assert.rejects(adminReview.handler(successfulReviewCtx,{token:'admin',bookingId:'booking-1',decision:'approve',note:'Reviewed identity evidence',requestId:'review-request-approve-lost-0001'}),/request itself is unconfirmed/i,'matching current status alone cannot prove this timed-out request completed');
    assert.equal(ambiguousPatchCount,1,'the admin action does not blindly repeat an ambiguous provider write');

    for (const decision of ['approve','decline','resubmit']) for (const changed of [
      {status:'cancelled'}, {status:'returned'}, {verificationProvider:'stripe'},
      {accountId:'another-account'}, {guestEmail:'other@example.invalid'},
    ]) {
      let reads=0, writes=0;
      const racingCtx={
        runQuery:async()=> ++reads===1 ? reviewBooking : {...reviewBooking,...changed},
        runMutation:async()=>true,
      };
      global.fetch=async (url,options={})=>{
        if(options.method==='PATCH'){writes++;throw Error('unexpected provider update');}
        if(String(url).includes('/resubmission-preview/')) {
          const body=JSON.parse(options.body);
          return new Response(JSON.stringify({recipient:'renter@example.invalid',requires_user_action:true,nodes_to_resubmit:body.nodes_to_resubmit}),{status:200});
        }
        return new Response(JSON.stringify({...providerReport(),status:'In Review',id_verifications:[{node_id:'feature_ocr',status:'In Review'}]}),{status:200});
      };
      await assert.rejects(adminReview.handler(racingCtx,{token:'admin',bookingId:'booking-1',decision,note:'Reviewed identity evidence',requestId:'review-race-request-00001'}),/rental or its verification window changed/i);
      assert.equal(writes,0,`${decision} cannot update Didit after a rental, owner or provider change`);
    }

    let resubmitProviderStatus='In Review', resubmitBody, resubmitPreviewBody;
    const resubmitCalls=[];
    global.fetch=async (url,options={})=>{
      resubmitCalls.push({url:String(url),method:options.method ?? 'GET'});
      if(String(url).includes('/resubmission-preview/')) {
        resubmitPreviewBody=JSON.parse(options.body);
        return new Response(JSON.stringify({recipient:'renter@example.invalid',requires_user_action:true,nodes_to_resubmit:resubmitPreviewBody.nodes_to_resubmit}),{status:200});
      }
      if(options.method==='PATCH'){
        resubmitBody=JSON.parse(options.body);
        resubmitProviderStatus=resubmitBody.new_status;
        return new Response(JSON.stringify({session_id:'session-1'}),{status:200});
      }
      return new Response(JSON.stringify({...providerReport(),status:resubmitProviderStatus,
        id_verifications:[{node_id:'feature_ocr',status:'In Review'}],
        liveness_checks:[{node_id:'feature_liveness',status:'Declined'}],
        face_matches:[{node_id:'feature_face',status:'Expired'}],
        poa_verifications:[{node_id:'feature_poa',status:resubmitProviderStatus==='In Review'?'In Review':'Not Finished'}],
        phone_verifications:[{node_id:'feature_phone',status:'Not Finished'}],
        email_verifications:[{node_id:'feature_email',status:'Declined'}],
        questionnaire_responses:[{node_id:'feature_questionnaire',status:'Expired'}],
        aml_screenings:[{node_id:'feature_aml',status:'In Review'}],
        database_validations:[{node_id:'feature_database',status:'Declined'}]}),{status:200});
    };
    const resubmission=await adminReview.handler(successfulReviewCtx,{token:'admin',bookingId:'booking-1',decision:'resubmit',note:'Please replace the address document',requestId:'review-request-resubmit-0001'});
    assert.deepEqual(resubmission,{status:'requires_input',providerStatus:'Resubmitted'});
    assert.equal(resubmitPreviewBody.new_status,undefined,'preview uses Didit’s documented request shape');
    assert.deepEqual(resubmitPreviewBody.nodes_to_resubmit,[
      {node_id:'feature_ocr',feature:'OCR'},
      {node_id:'feature_liveness',feature:'LIVENESS'},
      {node_id:'feature_face',feature:'FACE_MATCH'},
      {node_id:'feature_poa',feature:'POA'},
      {node_id:'feature_phone',feature:'PHONE'},
      {node_id:'feature_email',feature:'EMAIL'},
      {node_id:'feature_questionnaire',feature:'QUESTIONNAIRE'},
    ],'preview includes failed renter-actionable steps but excludes backend-only AML and database checks');
    assert.deepEqual(resubmitBody.nodes_to_resubmit,resubmitPreviewBody.nodes_to_resubmit,'the provider update uses the exact selected and previewed renter steps');
    assert.equal(resubmitBody.send_email,false,'the website email path supplies the renter-facing resubmission message');
    assert.equal(resubmitBody.email_address,undefined);

    for (const [preview, featureStatus] of [
      [{recipient:'renter@example.invalid',requires_user_action:true},'In Review'],
      [{recipient:'renter@example.invalid',requires_user_action:true,nodes_to_resubmit:[{node_id:'missing-step',feature:'UNKNOWN'}]},'In Review'],
      [{recipient:'renter@example.invalid',requires_user_action:false,nodes_to_resubmit:[{node_id:'feature_poa',feature:'POA'}]},'In Review'],
      [{recipient:'renter@example.invalid',requires_user_action:true,nodes_to_resubmit:[{node_id:'feature_poa',feature:'POA'}]},'Approved'],
      [{recipient:'someone-else@example.invalid',requires_user_action:true,nodes_to_resubmit:[{node_id:'feature_poa',feature:'POA'}]},'In Review'],
    ]) {
      let rejectedPatchCount=0;
      global.fetch=async (url,options={})=>{
        if(String(url).includes('/resubmission-preview/')) return new Response(JSON.stringify(preview),{status:200});
        if(options.method==='PATCH') { rejectedPatchCount++; return new Response(JSON.stringify({session_id:'session-1'}),{status:200}); }
        return new Response(JSON.stringify({...providerReport(),status:'In Review',poa_verifications:[{node_id:'feature_poa',status:featureStatus}]}),{status:200});
      };
      await assert.rejects(adminReview.handler(successfulReviewCtx,{token:'admin',bookingId:'booking-1',decision:'resubmit',note:'Please replace the address document',requestId:`review-request-invalid-${String(rejectedPatchCount).padStart(4,'0')}-01`}),/resubmission|valid|case|renter-actionable/i);
      assert.equal(rejectedPatchCount,0,'invalid or unneeded Didit steps never reach the provider update endpoint');
    }

    calls.length=0;
    global.fetch=async (url,options={})=>{
      if(String(url).includes('/resubmission-preview/'))
        return new Response(JSON.stringify({recipient:'renter@example.invalid',requires_user_action:true,nodes_to_resubmit:[{node_id:'feature_poa',feature:'POA'}]}),{status:200});
      if(options.method==='PATCH') return new Response('provider unavailable',{status:503});
      return new Response(JSON.stringify({...providerReport(),status:'In Review',poa_verifications:[{node_id:'feature_poa',status:'In Review'}]}),{status:200});
    };
    await assert.rejects(adminReview.handler(successfulReviewCtx,{token:'admin',bookingId:'booking-1',decision:'resubmit',note:'Please replace the address document',requestId:'review-request-resubmit-failure-0001'}),/temporarily unavailable/);
    assert.equal(calls.some(item=>item.ref==='bookings:setDiditResult'),false,'a failed Didit resubmission never changes booking state');
    assert(calls.some(item=>item.ref==='diditReviewClaims:release'),'failed resubmissions release the review claim for a safe retry');
  } finally { global.fetch = originalFetch; }
  try {
    let sentBody;
    global.fetch = async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return new Response(JSON.stringify({session_id:'new-session', workflow_id:'workflow-1',url:'https://verify.didit.me/session/new-session'}),{status:200});
    };
    const createCtx = {runAction:async()=>{},runQuery:async ref=>ref==='accounts:_byToken'
      ? {email:'renter@example.invalid'} : {status:'confirmed',accountAccessRequired:false,verificationProvider:'didit',idVerifyStatus:'required',guestEmail:'renter@example.invalid',renterName:'Test Rental Customer',billingAddress:'25 Whitcomb Street, London WC2H 7ER',lineItems:[{start:Date.UTC(2026,11,6),end:Date.UTC(2026,11,7),pickupTime:'16:00'}],pickupTime:'16:00'},
      runMutation:async ref=>String(ref)==='bookings:claimDiditSessionSlot'?{kind:'owner'}:true};
    let pendingProviderCall=false,pendingMutation=false;
    const pendingCtx={...createCtx,runAction:async()=>{pendingProviderCall=true;},runMutation:async()=>{pendingMutation=true;},runQuery:async ref=>
      ref==='bookings:reuseVerificationPotential'?true:ref==='bookings:reuseVerificationCandidate'?null:createCtx.runQuery(ref)};
    await assert.rejects(bookingSession.handler(pendingCtx,{bookingId:'booking-1',accountToken:'account-token'}),/saved verification is being checked/);
    assert.equal(pendingProviderCall,false,'pending rollout or archive proof never starts a provider session');
    assert.equal(pendingMutation,false,'expected rollout waits do not create false owner failure alerts');
    let unpaidProviderCall=false;
    const unpaidCtx={...createCtx,runQuery:async ref=>ref==='accounts:_byToken'
      ? {email:'renter@example.invalid'} : {status:'pending_verification',verificationProvider:'didit',idVerifyStatus:'required',guestEmail:'renter@example.invalid',depositHoldAmount:0}};
    await assert.rejects(bookingSession.handler({...unpaidCtx,runMutation:async()=>{unpaidProviderCall=true;}},
      {bookingId:'booking-1',accountToken:'account-token'}),/Complete the rental payment before opening verification/);
    assert.equal(unpaidProviderCall,false,'an unpaid pending rental cannot create or bind a Didit session');
    let reused=false;
    const savedApiKey=process.env.DIDIT_API_KEY;
    try {
      delete process.env.DIDIT_API_KEY;
      const reuseCtx={...createCtx,runAction:async()=>{reused=true;},runQuery:async ref=>ref==='accounts:_byToken'
        ? {email:'renter@example.invalid'} : ref==='bookings:reuseVerificationPotential'?true:ref==='bookings:reuseVerificationCandidate'?{source:{}}:{status:'confirmed',accountAccessRequired:false,verificationProvider:'didit',idVerifyStatus:reused?'verified':'required',guestEmail:'renter@example.invalid',lineItems:[{start:Date.UTC(2026,11,6),end:Date.UTC(2026,11,7),pickupTime:'16:00'}],pickupTime:'16:00'}};
      assert.deepEqual(await bookingSession.handler(reuseCtx,{bookingId:'booking-1',accountToken:'account-token'}),{url:null,reused:true},'retained eligible verification does not require a live Didit API key');
    } finally { process.env.DIDIT_API_KEY=savedApiKey; }
    await bookingSession.handler(createCtx,{bookingId:'booking-1',accountToken:'account-token'});
    assert.deepEqual(sentBody.expected_details,{first_name:'Test',last_name:'Rental Customer',address:'25 Whitcomb Street, London WC2H 7ER',poa_country:'GBR'});
    assert.equal(sentBody.expected_details.id_country,undefined,'a UK address must not restrict the issuing country of the ID');
    const priorSessionFetch=global.fetch;let waitingProviderCalls=0;
    global.fetch=async()=>{waitingProviderCalls++;throw new Error('A linked rental must not create another Didit session');};
    const waitingBooking={status:'pending_verification',accountAccessRequired:false,verificationProvider:'didit',idVerifyStatus:'required',guestEmail:'renter@example.invalid',checkoutPaidAt:Date.now(),depositHoldAmount:0,lineItems:[{start:Date.UTC(2026,11,6),end:Date.UTC(2026,11,7),pickupTime:'16:00'}],pickupTime:'16:00'};
    const waitingCtx={...createCtx,runQuery:async ref=>ref==='accounts:_byToken'?{email:'renter@example.invalid'}:ref==='bookings:verificationAccess'?waitingBooking:ref==='bookings:reuseVerificationPotential'?false:ref==='bookings:reuseVerificationCandidate'?null:null,
      runMutation:async ref=>String(ref)==='bookings:claimDiditSessionSlot'?{kind:'waiting',sourceBookingId:'source-booking'}:true};
    assert.deepEqual(await bookingSession.handler(waitingCtx,{bookingId:'booking-1',accountToken:'account-token'}),{url:null,waitingForBookingId:'source-booking'},'the renter is directed to the exact in-progress source rental');
    assert.equal(waitingProviderCalls,0,'a dependent paid booking never starts a parallel provider session');
    global.fetch=priorSessionFetch;
    const failures=[];
    global.fetch=async()=>{throw new Error('provider unavailable');};
    await assert.rejects(bookingSession.handler({...createCtx,runMutation:async(ref,args)=>{if(String(ref)==='bookings:claimDiditSessionSlot')return {kind:'owner'};if(String(ref)==='bookings:releaseDiditSessionClaim')return false;failures.push({ref,args});}},
      {bookingId:'booking-1',accountToken:'account-token'}),/provider unavailable/);
    assert.deepEqual(failures,[{ref:'bookings:flagDiditOpeningFailure',args:{bookingId:'booking-1',sessionId:undefined}}],
      'an authenticated initial provider failure alerts without exposing its details');
  } finally { global.fetch = originalFetch; }
  try {
    global.fetch = async (url, options = {}) => {
      calls.push({url,options});
      assert.notEqual(options.method, 'PATCH', 'verification recovery must never change a Didit decision');
      return new Response(JSON.stringify(report),{status:200});
    };
    report.vendor_data = 'dbc-booking-booking-1';
    report.status = 'Resubmitted';
    await assert.rejects(bookingSession.handler({runQuery:async()=>({...reviewBooking,idVerifyStatus:'requires_input'})},
      {bookingId:'booking-1',accountToken:'account-token'}),/sign in/);
    assert.deepEqual(await bookingSession.handler({runQuery:async ref=>ref==='accounts:_byToken'
      ? {email:'renter@example.invalid'} : {...reviewBooking,idVerifyStatus:'requires_input'}},
      {bookingId:'booking-1',accountToken:'account-token'}),{url:sessionUrl},'resubmission resumes the same case URL');
    assert.equal(calls.some(x=>x.url==='https://verification.didit.me/v3/session/' && x.options?.method==='POST'),false);
    calls.length = 0;
    const savedSessionUrl = report.session_url;
    report.status = 'In Progress';
    report.session_url = null;
    let boundNewSession = false;
    global.fetch = async (url, options = {}) => {
      calls.push({url,options});
      if (options.method === 'POST') return new Response(JSON.stringify({session_id:'session-1',workflow_id:'workflow-1',url:sessionUrl,status:'In Progress'}),{status:201});
      return new Response(JSON.stringify(report),{status:200});
    };
    const reopenCtx = {
      runQuery:async ref=>ref==='accounts:_byToken' ? {email:'renter@example.invalid'} : {...reviewBooking,idVerifyStatus:'processing'},
      runMutation:async()=>{boundNewSession = true; return true;},
    };
    assert.deepEqual(await bookingSession.handler(reopenCtx,{bookingId:'booking-1',accountToken:'account-token'}),
      {url:sessionUrl},'an active case with no retrieved URL reopens the same session');
    assert.equal(calls.filter(x=>x.options?.method==='POST').length,1);
    assert.equal(boundNewSession,false,'reopening an active case preserves its recorded progress');
    report.status = 'Approved';
    report.poa_verifications[0].poa_parsed_address = {postal_code:'SW1A 1AA'};
    const recovered = [];
    const completedCtx = {
      runQuery:async ref=>ref==='accounts:_byToken' ? {email:'renter@example.invalid'} : {...reviewBooking,idVerifyStatus:'processing'},
      runMutation:async(ref,args)=>{recovered.push({ref,args});return true;},
    };
    await assert.rejects(bookingSession.handler({...completedCtx,runQuery:async ref=>ref==='accounts:_byToken'
      ? {email:'foreign@example.invalid'} : {...reviewBooking,idVerifyStatus:'processing'}},
      {bookingId:'booking-1',accountToken:'foreign'}),/sign in/);
    assert.equal(recovered.length,0,'unauthorized callers cannot generate owner alerts');
    calls.length = 0;
    assert.deepEqual(await bookingSession.handler(completedCtx,{bookingId:'booking-1',accountToken:'account-token'}),
      {url:null,updated:true},'a completed provider case reconciles instead of failing to open');
    assert.equal(recovered[0].ref,'bookings:setDiditResult');
    assert.equal(recovered[0].args.status,'verified');
    assert.equal(recovered[0].args.reconciliation,true);
    assert.deepEqual(recovered[0].args.poaPostcodes,['SW1A 1AA']);
    assert.equal(calls.some(x=>x.options?.method==='POST'),false,'an existing decision never creates another session');
    let staleOpenSave;
    const staleOpenBooking={...reviewBooking,idVerifyStatus:'processing',diditEventId:'event-before-open',diditEventAt:now*1000};
    const staleOpenCtx={
      runQuery:async ref=>ref==='accounts:_byToken'?{email:'renter@example.invalid'}:staleOpenBooking,
      runMutation:async(ref,args)=>{if(ref==='bookings:setDiditResult'){staleOpenSave=args;staleOpenBooking.diditEventId='newer-review-event';return false;}return true;},
    };
    await assert.rejects(bookingSession.handler(staleOpenCtx,{bookingId:'booking-1',accountToken:'account-token'}),/session changed/,
      'opening a completed provider session cannot claim a stale refresh was applied');
    assert.equal(staleOpenSave.requireApplied,true,'opening-session reconciliation uses the authoritative event compare-and-set');
    assert.equal(staleOpenBooking.diditEventId,'newer-review-event','a concurrently applied provider event remains authoritative');
    recovered.length = 0;
    await assert.rejects(bookingSession.handler({...completedCtx,runQuery:async ref=>ref==='accounts:_byToken'
      ? {email:'renter@example.invalid'} : {...reviewBooking,idVerifyStatus:'requires_input',idVerificationSource:'manual'}},
      {bookingId:'booking-1',accountToken:'account-token'}),/replacement request/);
    assert.equal(recovered.some(call=>call.ref==='bookings:setDiditResult'),false,'an outstanding manual resubmission cannot be overwritten by an old decision');
    assert.equal(recovered.some(call=>call.ref==='bookings:flagDiditOpeningFailure'),true,'a blocked replacement request alerts the team');
    report.poa_verifications = [];
    recovered.length = 0;
    await bookingSession.handler(completedCtx,{bookingId:'booking-1',accountToken:'account-token'});
    assert.equal(recovered[0].args.status,'verified','a final Didit approval auto-approves when feature details are omitted');
    assert.deepEqual(recovered[0].args.checks,{identity:'approved',selfie:'approved',address:'approved'});
    report.vendor_data = 'dbc-booking-another';
    recovered.length = 0;
    await assert.rejects(bookingSession.handler(completedCtx,{bookingId:'booking-1',accountToken:'account-token'}),/does not match/);
    assert.equal(recovered.some(call=>call.ref==='bookings:setDiditResult'),false,'a foreign decision is never reconciled');
    assert.equal(recovered.some(call=>call.ref==='bookings:flagDiditOpeningFailure'),true,'a provider mismatch alerts the team');
    report.vendor_data = 'dbc-booking-booking-1';
    report.poa_verifications = [{status:'Approved',node_id:'feature_poa'}];
    report.status = 'Resubmitted';
    report.session_url = savedSessionUrl;
    calls.length = 0;
  } finally { global.fetch = originalFetch; }
  // Expired approval renews only for the bound, paid renter. Old documents remain archived.
  const expiredBooking = {...reviewBooking,status:'pending_verification',checkoutPaidAt:Date.now(),idVerifyStatus:'verified',verificationExpiresAt:Date.now()-1};
  let renewPatch, posts=0;
  const renewCtx = {runQuery:async ref=>ref==='accounts:_byToken'?{email:'renter@example.invalid'}:expiredBooking,
    runMutation:async(ref,args)=>{if(String(ref)==='bookings:claimDiditSessionSlot')return {kind:'owner'};renewPatch=args;return true;}};
  const beforeRenewFetch = global.fetch;
  try {
    global.fetch=async(url,options={})=>{if(options.method==='POST'){posts++;return new Response(JSON.stringify({session_id:'new-renew-session',workflow_id:'workflow-1',url:'https://verify.didit.me/session/new-renew-session'}));}return new Response(JSON.stringify({...report,status:'Approved'}));};
    await assert.rejects(bookingSession.handler({...renewCtx,runQuery:async ref=>ref==='accounts:_byToken'?{email:'renter@example.invalid'}:{...expiredBooking,status:'confirmed'}},{bookingId:'booking-1',accountToken:'account-token'}),/not ready/);
    assert.equal(posts,0,'an expired account pass cannot reopen a rental that already passed verification and was confirmed');
    assert.equal((await bookingSession.handler(renewCtx,{bookingId:'booking-1',accountToken:'account-token'})).url,'https://verify.didit.me/session/new-renew-session');
    assert.equal(posts,1);assert.equal(renewPatch.previousSessionId,'session-1');
    await assert.rejects(bookingSession.handler({...renewCtx,runQuery:async ref=>ref==='accounts:_byToken'?{email:'foreign@example.invalid'}:expiredBooking},{bookingId:'booking-1',accountToken:'foreign'}),/sign in/);
    assert.equal(posts,1,'foreign accounts cannot initiate paid provider workflows');
    await assert.rejects(bookingSession.handler({...renewCtx,runQuery:async()=>({...expiredBooking,verificationExpiresAt:Date.now()+60000})},{bookingId:'booking-1',accountToken:'account-token'}),/not ready/);
    assert.equal(posts,1,'a valid approval cannot be unnecessarily replaced');
    await assert.rejects(bookingSession.handler({...renewCtx,runQuery:async()=>({...expiredBooking,cancellationDecision:{}})},{bookingId:'booking-1',accountToken:'account-token'}),/required card hold/);
  } finally {global.fetch=beforeRenewFetch;}
  let reset;
  const expiredDb = {db:{get:async()=>({...expiredBooking,verificationReusedFrom:'source-booking',idVerificationSource:'manual',diditSessionApprovalSeen:true,diditSessionApprovedAt:Date.now()-91*86400000}),patch:async(_,value)=>{reset=value;},query:()=>({withIndex:()=>({first:async()=>null,collect:async()=>[]})})},scheduler:{runAfter:async()=>{}}};
  assert.equal(await setDiditSession.handler(expiredDb,{bookingId:'booking-1',sessionId:'new-renew-session',previousSessionId:'session-1'}),true);
  assert.equal(reset.idVerifyStatus,'processing');assert.equal(reset.verificationExpiresAt,undefined);assert.equal(reset.documentExpiresAt,undefined);assert.equal(reset.verificationReusedFrom,undefined);assert.equal(reset.idVerifiedAt,undefined);assert.equal(reset.idVerificationSource,undefined);
  assert.equal(reset.diditSessionApprovalSeen,undefined);assert.equal(reset.diditSessionApprovedAt,undefined,'a genuinely new session starts with no previous session approval');
  assert.equal(await setDiditSession.handler(expiredDb,{bookingId:'booking-1',sessionId:'stale-session',previousSessionId:'not-current'}),false,'renewal uses compare-and-set against the exact previous case');
  for(const decision of ['approve','resubmit','decline'])assert.equal(await setDiditManualReview.handler({},{bookingId:'booking-1',sessionId:'session-1',decision,note:'Reviewed'}),false,'A stale internal manual decision cannot alter provider status');
  let rejectedPatch=false;assert.equal(await setDiditManualReview.handler({db:{get:async()=>({...reviewBooking,idVerifyStatus:'rejected'}),patch:async()=>{rejectedPatch=true}}},{bookingId:'booking-1',sessionId:'session-1',decision:'approve',note:'Reviewed'}),false);assert.equal(rejectedPatch,false,'a later provider rejection cannot be overridden by a stale review');
  let racedPatch=false;assert.equal(await setDiditManualReview.handler({db:{get:async()=>({...reviewBooking,diditEventId:'new-signed-event',diditEventAt:100}),patch:async()=>{racedPatch=true}}},{bookingId:'booking-1',sessionId:'session-1',decision:'approve',note:'Reviewed',expectedEventId:null,expectedEventAt:null,expectedManualDecisionAt:null}),false);assert.equal(racedPatch,false,'Any newer signed provider event fences a stale manual review even when status is unchanged');
  assert.equal(await setDiditResult.handler({db:{get:async()=>({...reviewBooking,diditEventId:'new-signed-event',diditEventAt:100})}},{bookingId:'booking-1',sessionId:'session-1',eventId:'stale-reconcile',eventAt:101,status:'verified',providerStatus:'Approved',poaPostcodes:[],reconciliation:true,requireApplied:true,expectedEventId:null,expectedEventAt:null,expectedManualDecisionAt:null}),false,'A newer signed event prevents stale provider reconciliation from claiming success');
  let stalePatch = false;
  await setDiditResult.handler({db:{get:async()=>({...reviewBooking,diditManualDecisionAt:now*1000+1000}),patch:async()=>{stalePatch=true;}}},
    {bookingId:'booking-1',sessionId:'session-1',eventId:'stale',eventAt:now*1000,
      status:'rejected',poaPostcodes:[]});
  assert.equal(stalePatch,false,'an older webhook cannot undo a newer human decision');
  const reconciled = [];
  const savedFetch = global.fetch;
  try {
    report.status = 'Approved';
    report.id_verifications[0].status = 'Approved';
    report.poa_verifications[0].poa_parsed_address = {postal_code:'SW1A 1AA'};
    global.fetch = async () => new Response(JSON.stringify(report),{status:200});
    await reconcileOpenSessions.handler({
      runQuery: async ref => ref === 'diditSweep:batch'
        ? [{bookingId:'booking-1',sessionId:'session-1',email:'renter@example.invalid'}] : [],
      runMutation: async (ref,args) => { reconciled.push({ref,args}); return true; },
    },{generation:1});
    const recovered = reconciled.find(x=>x.ref==='bookings:setDiditResult');
    assert.equal(recovered.args.reconciliation,true,'periodic reads are distinguished from document-change events');
    assert.equal(recovered.args.status,'verified','missed webhooks are recovered from the provider decision');
    assert.deepEqual(recovered.args.poaPostcodes,['SW1A 1AA']);
    assert.ok(reconciled.some(x=>x.ref==='bookings:markDiditReconciled'));
    assert.ok(reconciled.some(x=>x.ref==='diditSweep:finish'),'successful dispatch releases the sweep');
    reconciled.length=0;
    await reconcileOpenSessions.handler({
      runQuery:async()=>[{bookingId:'booking-1',sessionId:'session-1',email:'renter@example.invalid',expectedEventId:'webhook-won',expectedEventAt:now*1000,expectedManualDecisionAt:null}],
      runMutation:async(ref,args)=>{reconciled.push({ref,args});if(ref==='bookings:setDiditResult'){assert.equal(args.requireApplied,true,'the hourly reconciliation uses the same compare-and-set fence');return false;}return true;},
    },{generation:1});
    assert(!reconciled.some(x=>x.ref==='bookings:markDiditReconciled'),'a stale provider snapshot is not recorded as applied or as a completed reconciliation');
    assert(!reconciled.some(x=>x.ref==='bookings:flagDiditProcessingFailure'),'a webhook race is not mislabeled as a provider failure');
    assert(reconciled.some(x=>x.ref==='diditSweep:finish'),'stale work still releases the bounded sweep lease');
    reconciled.length=0;global.fetch=async()=>new Response('',{status:503});
    await assert.rejects(()=>reconcileOpenSessions.handler({runQuery:async()=>[{bookingId:'booking-1',sessionId:'session-1',email:'renter@example.invalid'}],runMutation:async(ref,args)=>{reconciled.push({ref,args});return true;}},{generation:1}),/could not be reconciled/);
    assert(reconciled.some(x=>x.ref==='bookings:flagDiditProcessingFailure'),'a failed reconciliation creates an owner alert');assert(reconciled.some(x=>x.ref==='bookings:markDiditReconciled'),'failed cases still rotate fairly');
    assert.ok(reconciled.some(x=>x.ref==='diditSweep:finish'),'failed dispatch releases the sweep');
    reconciled.length=0;
    await assert.rejects(()=>reconcileOpenSessions.handler({runQuery:async()=>[{bookingId:'booking-1',sessionId:'session-1',email:'renter@example.invalid'}],runMutation:async(ref,args)=>{reconciled.push({ref,args});if(ref==='bookings:flagDiditProcessingFailure')throw Error('alert unavailable');return true;}},{generation:1}),/could not be reconciled/);
    assert(!reconciled.some(x=>x.ref==='bookings:markDiditReconciled'),'an unrecorded failure remains eligible for retry');
    const apiKey=process.env.DIDIT_API_KEY;delete process.env.DIDIT_API_KEY;reconciled.length=0;
    try {await assert.rejects(()=>reconcileOpenSessions.handler({runQuery:async()=>[],runMutation:async(ref,args)=>{reconciled.push({ref,args});return true;}},{generation:1}),/temporarily unavailable/);}
    finally {process.env.DIDIT_API_KEY=apiKey;}
    assert.ok(reconciled.some(x=>x.ref==='diditSweep:configurationFailure'),'missing configuration creates a durable owner incident even without candidates');
  } finally { global.fetch = savedFetch; }
  const workflow = { workflow_id: 'workflow-1', status: 'published', version: 1,
    features: 'OCR + LIVENESS + FACE_MATCH + PROOF_OF_ADDRESS', max_price: 0.5 };
  const provider = (balance, override = {}) => async url => new Response(JSON.stringify(
    url.includes('/workflows/') ? { results: [{ ...workflow, ...override }] } : { balance },
  ), { status: 200 });
  await assertDiditCheckoutCapacity('key', 'workflow-1', 'live', '0.50', provider('1.0000'));
  await assert.rejects(
    assertDiditCheckoutCapacity('key', 'workflow-1', 'live', '0.50', provider('0.0000')),
    error=>error.data?.code==='VERIFICATION_UNAVAILABLE'&&error.data?.message.includes('Identity verification is temporarily unavailable'),
  );
  await assert.rejects(
    assertDiditCheckoutCapacity('key', 'workflow-1', 'live', '0.50', provider('1.0000', { max_price: 0.75 })),
    error=>error.data?.code==='VERIFICATION_UNAVAILABLE'&&error.data?.message.includes('Identity verification is temporarily unavailable'),
  );
  await assert.rejects(
    assertDiditCheckoutCapacity('key', 'workflow-1', 'live', '0.50', provider('1.0000', { features: 'OCR + LIVENESS + FACE_MATCH' })),
    error=>error.data?.code==='VERIFICATION_UNAVAILABLE'&&error.data?.message.includes('Identity verification is temporarily unavailable'),
  );
  await assertDiditCheckoutCapacity('key', 'workflow-1', 'sandbox', undefined, () => { throw new Error('Sandbox must not check live credits'); });
  process.stdout.write('Didit webhook and address gates passed\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
