/** Didit webhook and booking approval boundary. No provider calls or customer data. */
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

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
    './lib/rmv2SyncQueue': { queueRmv2Sync: async () => {} },
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
  DIDIT_APPLICATION_ID: 'application-1', DIDIT_ENVIRONMENT: 'sandbox', INVOICE_SECRET:'didit-test-identity-secret',
});

const { webhook, bookingSession, adminReview, reconcileOpenSessions } = load('convex/didit.ts');
const { setDiditResult, setDiditSession, adminSetIdStatus, setDiditManualReview } = load('convex/bookings.ts');
const { assertDiditCheckoutCapacity } = load('convex/lib/diditCapacity.ts');

function signed(event) {
  const sort = value => Array.isArray(value) ? value.map(sort) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])])) : value;
  const body = JSON.stringify(event);
  return {
    body,
    signature: createHmac('sha256', process.env.DIDIT_WEBHOOK_SECRET).update(JSON.stringify(sort(event))).digest('hex'),
    timestamp: String(event.timestamp),
  };
}

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const event = {
    event_id: 'event-1', webhook_type: 'status.updated', timestamp: now, created_at: now,
    application_id: 'application-1', environment: 'sandbox', workflow_id: 'workflow-1',
    session_id: 'session-1', vendor_data: 'dbc-booking-booking-1', status: 'Approved',
    decision: {
      status: 'Approved', id_verifications: [{status: 'Approved',full_name:'Test Rental Customer',date_of_birth:'1990-01-01'}],
      liveness_checks: [{status: 'Approved'}], face_matches: [{status: 'Approved'}],
      poa_verifications: [{status: 'Approved', poa_parsed_address: {postal_code: 'SW1A 1AA'}}],
    },
  };
  let result;const ownerAlerts=[];
  const ctx = { runMutation: async (ref, args) => { if(ref==='bookings:flagDiditWebhookRejection'){ownerAlerts.push(args);return true;}assert.equal(ref, 'bookings:setDiditResult'); result = args; return true; } };
  assert.equal(await webhook.handler(ctx, signed(event)), true);
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.poaPostcodes, ['SW1A 1AA']);
  const currentSignature = signed({...event, event_id: 'event-previous'});
  assert.equal(await webhook.handler(ctx, {...currentSignature, signature: '0'.repeat(64), previousSignature: currentSignature.signature}), true,
    'a valid V2 previous-secret signature survives Didit secret rotation');
  const rawSignature = signed({...event, event_id: 'event-raw'});
  assert.equal(await webhook.handler(ctx, {...rawSignature, signature: '0'.repeat(64), rawSignature: createHmac('sha256', process.env.DIDIT_WEBHOOK_SECRET).update(rawSignature.body).digest('hex')}), true,
    'a valid full-body raw signature is accepted when V2 is unavailable');
  assert.equal(await webhook.handler(ctx, signed({...event, event_id: 'event-2', decision: {...event.decision, poa_verifications: []}})), true);
  assert.equal(result.status, 'manual_review', 'top-level approval cannot bypass PoA');
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
    ['10 Downing Street, London SW1A 2AA', 'manual_review'],
    ['10 Downing Street, London', 'manual_review'],
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
      status: 'verified', poaPostcodes: ['SW1A 1AA'],
    }), true);
    assert.equal(patch.idVerifyStatus, expected, billingAddress);
  }
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
    diditSessionId:'session-1',guestEmail:'renter@example.invalid'};
  const calls = [];
  const reviewCtx = {
    runQuery: async () => reviewBooking,
    runMutation: async (ref, args) => { calls.push({ref,args}); return true; },
  };
  const originalFetch = global.fetch;
  try {
    let sentBody;
    global.fetch = async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return new Response(JSON.stringify({session_id:'new-session', workflow_id:'workflow-1',url:'https://verify.didit.me/session/new-session'}),{status:200});
    };
    const createCtx = {runAction:async()=>{},runQuery:async ref=>ref==='accounts:_byToken'
      ? {email:'renter@example.invalid'} : {status:'confirmed',verificationProvider:'didit',idVerifyStatus:'required',guestEmail:'renter@example.invalid',renterName:'Test Rental Customer',billingAddress:'25 Whitcomb Street, London WC2H 7ER'},
      runMutation:async()=>true};
    let pendingProviderCall=false,pendingMutation=false;
    const pendingCtx={...createCtx,runAction:async()=>{pendingProviderCall=true;},runMutation:async()=>{pendingMutation=true;},runQuery:async ref=>
      ref==='bookings:reuseVerificationPotential'?true:ref==='bookings:reuseVerificationCandidate'?null:createCtx.runQuery(ref)};
    await assert.rejects(bookingSession.handler(pendingCtx,{bookingId:'booking-1',accountToken:'account-token'}),/saved verification is being checked/);
    assert.equal(pendingProviderCall,false,'pending rollout or archive proof never starts a provider session');
    assert.equal(pendingMutation,false,'expected rollout waits do not create false owner failure alerts');
    let reused=false;
    const savedApiKey=process.env.DIDIT_API_KEY;
    try {
      delete process.env.DIDIT_API_KEY;
      const reuseCtx={...createCtx,runAction:async()=>{reused=true;},runQuery:async ref=>ref==='accounts:_byToken'
        ? {email:'renter@example.invalid'} : {status:'confirmed',verificationProvider:'didit',idVerifyStatus:reused?'verified':'required',guestEmail:'renter@example.invalid'}};
      assert.deepEqual(await bookingSession.handler(reuseCtx,{bookingId:'booking-1',accountToken:'account-token'}),{url:null,reused:true},'retained eligible verification does not require a live Didit API key');
    } finally { process.env.DIDIT_API_KEY=savedApiKey; }
    await bookingSession.handler(createCtx,{bookingId:'booking-1',accountToken:'account-token'});
    assert.deepEqual(sentBody.expected_details,{first_name:'Test',last_name:'Rental Customer',address:'25 Whitcomb Street, London WC2H 7ER',poa_country:'GBR'});
    assert.equal(sentBody.expected_details.id_country,undefined,'a UK address must not restrict the issuing country of the ID');
    const failures=[];
    global.fetch=async()=>{throw new Error('provider unavailable');};
    await assert.rejects(bookingSession.handler({...createCtx,runMutation:async(ref,args)=>{failures.push({ref,args});}},
      {bookingId:'booking-1',accountToken:'account-token'}),/provider unavailable/);
    assert.deepEqual(failures,[{ref:'bookings:flagDiditOpeningFailure',args:{bookingId:'booking-1',sessionId:undefined}}],
      'an authenticated initial provider failure alerts without exposing its details');
  } finally { global.fetch = originalFetch; }
  try {
    global.fetch = async (url, options = {}) => {
      calls.push({url,options});
      if (options.method === 'PATCH') return new Response(JSON.stringify({session_id:'session-1'}),{status:200});
      return new Response(JSON.stringify(report),{status:200});
    };
    await adminReview.handler(reviewCtx,{token:'admin',bookingId:'booking-1',decision:'resubmit',note:'Please replace the ID'});
    const patchCall = calls.find(x=>x.options?.method === 'PATCH');
    assert.deepEqual(JSON.parse(patchCall.options.body).nodes_to_resubmit,[{node_id:'feature_ocr',feature:'OCR'}]);
    assert.equal(calls.find(x=>x.ref === 'bookings:setDiditManualReview').args.decision,'resubmit');
    calls.length = 0;
    report.status = 'Approved';
    await adminReview.handler(reviewCtx,{token:'admin',bookingId:'booking-1',decision:'approve',note:'Address evidence reviewed'});
    assert.equal(calls.some(x=>x.options?.method === 'PATCH'),false,'already approved provider case must not be patched twice');
    calls.length = 0;
    await adminReview.handler(reviewCtx,{token:'admin',bookingId:'booking-1',decision:'resubmit',note:'Postcode does not match booking'});
    assert.deepEqual(JSON.parse(calls.find(x=>x.options?.method === 'PATCH').options.body).nodes_to_resubmit,
      [{node_id:'feature_ocr',feature:'OCR'}],'failed steps take priority over an address-only redo');
    report.id_verifications[0].status = 'Approved';
    calls.length = 0;
    await adminReview.handler(reviewCtx,{token:'admin',bookingId:'booking-1',decision:'resubmit',note:'Postcode does not match booking'});
    assert.deepEqual(JSON.parse(calls.find(x=>x.options?.method === 'PATCH').options.body).nodes_to_resubmit,
      [{node_id:'feature_poa',feature:'PROOF_OF_ADDRESS'}],'an address mismatch reopens PoA when all features passed');
    calls.length = 0;
    report.vendor_data = 'dbc-booking-another';
    await assert.rejects(adminReview.handler(reviewCtx,{token:'admin',bookingId:'booking-1',decision:'approve',note:'Address evidence reviewed'}),/does not match/);
    assert.equal(calls.some(x=>x.ref === 'bookings:setDiditManualReview'),false);
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
    recovered.length = 0;
    await assert.rejects(bookingSession.handler({...completedCtx,runQuery:async ref=>ref==='accounts:_byToken'
      ? {email:'renter@example.invalid'} : {...reviewBooking,idVerifyStatus:'requires_input',idVerificationSource:'manual'}},
      {bookingId:'booking-1',accountToken:'account-token'}),/replacement request/);
    assert.equal(recovered.some(call=>call.ref==='bookings:setDiditResult'),false,'an outstanding manual resubmission cannot be overwritten by an old decision');
    assert.equal(recovered.some(call=>call.ref==='bookings:flagDiditOpeningFailure'),true,'a blocked replacement request alerts the team');
    report.poa_verifications = [];
    recovered.length = 0;
    await bookingSession.handler(completedCtx,{bookingId:'booking-1',accountToken:'account-token'});
    assert.equal(recovered[0].args.status,'manual_review','top-level approval cannot bypass the address check');
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
    report.status = 'Declined';
    global.fetch = async (url, options = {}) => {
      calls.push({url,options});
      return new Response(JSON.stringify(options.method === 'PATCH' ? {detail:'denied'} : report),
        {status:options.method === 'PATCH' ? 403 : 200});
    };
    await assert.rejects(adminReview.handler(reviewCtx,{token:'admin',bookingId:'booking-1',decision:'approve',note:'Reviewed identity evidence'}),/did not accept/);
    assert.equal(calls.some(x=>x.ref === 'bookings:setDiditManualReview'),false,'failed provider writes must not approve the rental');
  } finally { global.fetch = originalFetch; }
  // Expired approval renews only for the bound, paid renter. Old documents remain archived.
  const expiredBooking = {...reviewBooking,idVerifyStatus:'verified',verificationExpiresAt:Date.now()-1};
  let renewPatch, posts=0;
  const renewCtx = {runQuery:async ref=>ref==='accounts:_byToken'?{email:'renter@example.invalid'}:expiredBooking,
    runMutation:async(ref,args)=>{renewPatch=args;return true;}};
  const beforeRenewFetch = global.fetch;
  try {
    global.fetch=async(url,options={})=>{if(options.method==='POST'){posts++;return new Response(JSON.stringify({session_id:'new-renew-session',workflow_id:'workflow-1',url:'https://verify.didit.me/session/new-renew-session'}));}return new Response(JSON.stringify({...report,status:'Approved'}));};
    assert.equal((await bookingSession.handler(renewCtx,{bookingId:'booking-1',accountToken:'account-token'})).url,'https://verify.didit.me/session/new-renew-session');
    assert.equal(posts,1);assert.equal(renewPatch.previousSessionId,'session-1');
    await assert.rejects(bookingSession.handler({...renewCtx,runQuery:async ref=>ref==='accounts:_byToken'?{email:'foreign@example.invalid'}:expiredBooking},{bookingId:'booking-1',accountToken:'foreign'}),/sign in/);
    assert.equal(posts,1,'foreign accounts cannot initiate paid provider workflows');
    await assert.rejects(bookingSession.handler({...renewCtx,runQuery:async()=>({...expiredBooking,verificationExpiresAt:Date.now()+60000})},{bookingId:'booking-1',accountToken:'account-token'}),/not ready/);
    assert.equal(posts,1,'a valid approval cannot be unnecessarily replaced');
    await assert.rejects(bookingSession.handler({...renewCtx,runQuery:async()=>({...expiredBooking,cancellationDecision:{}})},{bookingId:'booking-1',accountToken:'account-token'}),/required card hold/);
  } finally {global.fetch=beforeRenewFetch;}
  let reset;
  const expiredDb = {db:{get:async()=>({...expiredBooking,verificationReusedFrom:'source-booking',idVerificationSource:'manual'}),patch:async(_,value)=>{reset=value;},query:()=>({withIndex:()=>({first:async()=>null,collect:async()=>[]})})},scheduler:{runAfter:async()=>{}}};
  assert.equal(await setDiditSession.handler(expiredDb,{bookingId:'booking-1',sessionId:'new-renew-session',previousSessionId:'session-1'}),true);
  assert.equal(reset.idVerifyStatus,'processing');assert.equal(reset.verificationExpiresAt,undefined);assert.equal(reset.documentExpiresAt,undefined);assert.equal(reset.verificationReusedFrom,undefined);assert.equal(reset.idVerifiedAt,undefined);assert.equal(reset.idVerificationSource,undefined);
  assert.equal(await setDiditSession.handler(expiredDb,{bookingId:'booking-1',sessionId:'stale-session',previousSessionId:'not-current'}),false,'renewal uses compare-and-set against the exact previous case');
  let reviewPatch;const queuedEmails=[];
  assert.equal(await setDiditManualReview.handler({
    db:{get:async()=>reviewBooking,patch:async(_id,value)=>{reviewPatch=value;},insert:async(table,value)=>{assert.equal(table,"rental_email_deliveries");queuedEmails.push(value);return "delivery-fixture";},query:()=>({withIndex:()=>({first:async()=>null,collect:async()=>[],order:()=>({take:async()=>[]})})})},
    scheduler:{runAfter:async()=>{}},
  },{bookingId:'booking-1',sessionId:'session-1',decision:'resubmit',note:'Replace ID'}),true);
  assert.equal(reviewPatch.idVerifyStatus,'requires_input');assert.equal(queuedEmails.length,1);assert.equal(queuedEmails[0].verificationStatus,'requires_input');
  assert.ok(reviewPatch.diditManualDecisionAt > 0);
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
