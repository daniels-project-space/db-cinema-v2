/** Didit webhook and booking approval boundary. No provider calls or customer data. */
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file) {
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
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
  new Function('require', 'module', 'exports', source)((name) => mock[name] ?? require(name), mod, mod.exports);
  return mod.exports;
}

Object.assign(process.env, {
  DIDIT_API_KEY: 'unused', DIDIT_WORKFLOW_ID: 'workflow-1', DIDIT_WEBHOOK_SECRET: 'webhook-test-secret',
  DIDIT_APPLICATION_ID: 'application-1', DIDIT_ENVIRONMENT: 'sandbox',
});

const { webhook } = load('convex/didit.ts');
const { setDiditResult } = load('convex/bookings.ts');

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
  process.stdout.write('Didit webhook and address gates passed\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
