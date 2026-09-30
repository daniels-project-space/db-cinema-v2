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
  DIDIT_APPLICATION_ID: 'application-1', DIDIT_ENVIRONMENT: 'sandbox',
});

const { webhook, bookingSession, adminReview } = load('convex/didit.ts');
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
      status: 'Approved', id_verifications: [{status: 'Approved'}],
      liveness_checks: [{status: 'Approved'}], face_matches: [{status: 'Approved'}],
      poa_verifications: [{status: 'Approved', poa_parsed_address: {postal_code: 'SW1A 1AA'}}],
    },
  };
  let result;
  const ctx = { runMutation: async (ref, args) => { assert.equal(ref, 'bookings:setDiditResult'); result = args; return true; } };
  assert.equal(await webhook.handler(ctx, signed(event)), true);
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.poaPostcodes, ['SW1A 1AA']);
  assert.equal(await webhook.handler(ctx, signed({...event, event_id: 'event-2', decision: {...event.decision, poa_verifications: []}})), true);
  assert.equal(result.status, 'manual_review', 'top-level approval cannot bypass PoA');
  result = null;
  assert.equal(await webhook.handler(ctx, {...signed(event), signature: '0'.repeat(64)}), false);
  assert.equal(result, null, 'forged callback must not change booking');
  assert.equal(await webhook.handler(ctx, signed({...event, environment: 'live'})), false);
  assert.equal(await webhook.handler(ctx, signed({...event, timestamp: now - 3600})), false);
  assert.equal(await webhook.handler(ctx, signed({...event, event_id: 'event-expired', status: 'Expired'})), true);
  assert.equal(result.status, 'requires_input');
  assert.match(result.note, /link expired/);

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
    const booking = { verificationProvider: 'didit', diditSessionId: 'session-1', billingAddress, idVerifyStatus: 'processing', guestEmail: 'renter@example.invalid' };
    let patch;
    const db = {
      get: async () => booking,
      patch: async (_, value) => { patch = value; },
      query: () => ({ withIndex: () => ({ first: async () => null }) }),
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
    id_verifications:[{status:'Declined',node_id:'feature_ocr'}],
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
    report.status = 'Declined';
    global.fetch = async (url, options = {}) => {
      calls.push({url,options});
      return new Response(JSON.stringify(options.method === 'PATCH' ? {detail:'denied'} : report),
        {status:options.method === 'PATCH' ? 403 : 200});
    };
    await assert.rejects(adminReview.handler(reviewCtx,{token:'admin',bookingId:'booking-1',decision:'approve',note:'Reviewed identity evidence'}),/did not accept/);
    assert.equal(calls.some(x=>x.ref === 'bookings:setDiditManualReview'),false,'failed provider writes must not approve the rental');
  } finally { global.fetch = originalFetch; }
  let reviewPatch;
  assert.equal(await setDiditManualReview.handler({
    db:{get:async()=>reviewBooking,patch:async(_id,value)=>{reviewPatch=value;}},
    scheduler:{runAfter:async()=>{}},
  },{bookingId:'booking-1',sessionId:'session-1',decision:'resubmit',note:'Replace ID'}),true);
  assert.equal(reviewPatch.idVerifyStatus,'requires_input');
  assert.ok(reviewPatch.diditManualDecisionAt > 0);
  let stalePatch = false;
  await setDiditResult.handler({db:{get:async()=>({...reviewBooking,diditManualDecisionAt:now*1000+1000}),patch:async()=>{stalePatch=true;}}},
    {bookingId:'booking-1',sessionId:'session-1',eventId:'stale',eventAt:now*1000,
      status:'rejected',poaPostcodes:[]});
  assert.equal(stalePatch,false,'an older webhook cannot undo a newer human decision');
  const workflow = { workflow_id: 'workflow-1', status: 'published', version: 1,
    features: 'OCR + LIVENESS + FACE_MATCH + PROOF_OF_ADDRESS', max_price: 0.5 };
  const provider = (balance, override = {}) => async url => new Response(JSON.stringify(
    url.includes('/workflows/') ? { results: [{ ...workflow, ...override }] } : { balance },
  ), { status: 200 });
  await assertDiditCheckoutCapacity('key', 'workflow-1', 'live', '0.50', provider('1.0000'));
  await assert.rejects(
    assertDiditCheckoutCapacity('key', 'workflow-1', 'live', '0.50', provider('0.0000')),
    /Identity verification is temporarily unavailable/,
  );
  await assert.rejects(
    assertDiditCheckoutCapacity('key', 'workflow-1', 'live', '0.50', provider('1.0000', { max_price: 0.75 })),
    /Identity verification is temporarily unavailable/,
  );
  await assert.rejects(
    assertDiditCheckoutCapacity('key', 'workflow-1', 'live', '0.50', provider('1.0000', { features: 'OCR + LIVENESS + FACE_MATCH' })),
    /Identity verification is temporarily unavailable/,
  );
  await assertDiditCheckoutCapacity('key', 'workflow-1', 'sandbox', undefined, () => { throw new Error('Sandbox must not check live credits'); });
  process.stdout.write('Didit webhook and address gates passed\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
