const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const http = require('node:http');
const { promisify } = require('node:util');
const esbuild = require('esbuild');
const { ConvexHttpClient } = require('convex/browser');
const { makeFunctionReference } = require('convex/server');

const websiteSource = path.resolve(__dirname, '..');
const managerSource = '/root/worktrees/dbc-shared-stock-authority-20261108';
if (path.resolve(process.env.SYNTHETIC_MANAGER_REPO || managerSource) !== managerSource) {
  throw Error(`This harness is pinned to the audited Manager worktree: ${managerSource}`);
}
if (!fs.existsSync(path.join(managerSource, 'convex/sharedStockCoordinator.ts')) || !fs.existsSync(path.join(managerSource, 'convex/http.ts'))) {
  throw Error(`Missing audited Manager source at ${managerSource}`);
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-shared-stock-protocol-'));
const isolatedHome = path.join(workspace, 'home');
fs.mkdirSync(isolatedHome, { recursive: true, mode: 0o700 });
const children = [];
let dashboardStub;
const run = promisify(execFile);
const secret = crypto.randomBytes(32).toString('hex');
const authSecret = crypto.randomBytes(32).toString('hex');
const localEnv = {
  PATH: process.env.PATH,
  HOME: isolatedHome,
  CONVEX_AGENT_MODE: 'anonymous',
  XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let cleaned = false;

function exposeCachedBackendBinaries() {
  // Convex may otherwise download its local backend during `dev`. Expose only
  // already-cached executable versions under the disposable HOME; never share
  // the real home/config where credentials can reside.
  const cacheSource = '/root/.cache/convex/binaries';
  const cacheTarget = path.join(isolatedHome, '.cache', 'convex', 'binaries');
  if (!fs.existsSync(cacheSource)) throw Error('No cached local Convex backend binaries are available; refusing an external download.');
  const versions = fs.readdirSync(cacheSource).filter(name => /^precompiled-[\w.-]+$/.test(name));
  if (!versions.length) throw Error('No cached local Convex backend binaries are available; refusing an external download.');
  fs.mkdirSync(cacheTarget, { recursive: true });
  for (const version of versions) {
    const binary = path.join(cacheSource, version, 'convex-local-backend');
    if (!fs.existsSync(binary)) continue;
    fs.symlinkSync(path.join(cacheSource, version), path.join(cacheTarget, version), 'dir');
  }
}

async function skipUnavailableBundledDashboard() {
  // The local backend itself is cached. Convex anonymous mode also asks for a
  // separate dashboard zip, which is optional for API tests and absent here.
  // Its CLI only needs this loopback deployment-list response to skip starting
  // the UI. No request is served outside this temporary local process.
  dashboardStub = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ deployments: [] }));
  });
  await new Promise((resolve, reject) => {
    dashboardStub.once('error', reject);
    dashboardStub.listen(0, '127.0.0.1', resolve);
  });
  const apiPort = dashboardStub.address().port;
  const dashboardDir = path.join(isolatedHome, '.cache', 'convex', 'dashboard');
  fs.mkdirSync(dashboardDir, { recursive: true });
  fs.writeFileSync(path.join(dashboardDir, 'config.json'), JSON.stringify({ port: apiPort, apiPort, version: 'synthetic-local-only' }), { mode: 0o600 });
}

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const child of children) if (child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  for (let attempt = 0; attempt < 60 && children.some(child => child.exitCode === null && child.signalCode === null); attempt++) await sleep(100);
  for (const child of children) if (child.pid && child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  if (dashboardStub) await new Promise(resolve => dashboardStub.close(resolve));
  fs.rmSync(workspace, { recursive: true, force: true });
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => { cleanup().finally(() => process.exit(code)); });

function copyIsolatedProject(name, source, fixture, readinessName) {
  const dir = path.join(workspace, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of ['convex', 'src', 'shared']) {
    if (fs.existsSync(path.join(source, entry))) fs.cpSync(path.join(source, entry), path.join(dir, entry), { recursive: true });
  }
  for (const entry of ['package.json', 'tsconfig.json', 'convex.json']) {
    if (fs.existsSync(path.join(source, entry))) fs.copyFileSync(path.join(source, entry), path.join(dir, entry));
  }
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.copyFileSync(path.join(__dirname, 'fixtures', fixture), path.join(dir, 'convex', 'shared_stock_protocol_fixture.ts'));
  fs.rmSync(path.join(dir, 'convex', 'crons.ts'), { force: true });
  if (readinessName) patchTemporaryReadinessGate(path.join(dir, 'convex/http.ts'), readinessName);
  return dir;
}

function patchTemporaryReadinessGate(httpPath, envName) {
  const source = fs.readFileSync(httpPath, 'utf8');
  const hardCoded = 'const SHARED_STOCK_WRITERS_READY = false;';
  if (source.includes(hardCoded)) {
    fs.writeFileSync(httpPath, source.replace(hardCoded, `const SHARED_STOCK_WRITERS_READY = process.env.${envName} === "enabled";`));
    return;
  }
  const match = source.match(/const SHARED_STOCK_WRITERS_READY = process\.env\.([A-Z0-9_]+) === "enabled";/);
  if (match) {
    fs.writeFileSync(httpPath, source.replace(match[0], `const SHARED_STOCK_WRITERS_READY = process.env.${envName} === "enabled";`));
    return;
  }
  throw Error('Could not identify the current shared-stock route readiness gate in the temporary Manager copy.');
}

function loadWebsiteTransport() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(websiteSource, 'convex/lib/sharedStockTransport.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const output = path.join(workspace, 'website-shared-stock-transport.cjs');
  fs.writeFileSync(output, result.outputFiles[0].text, { mode: 0o600 });
  return require(output);
}

async function launch(name, dir, env = {}) {
  const cli = path.join(dir, 'node_modules/.bin/convex');
  const child = spawn(cli, ['dev', '--typecheck', 'disable', '--codegen', 'disable', '--tail-logs', 'always'], {
    cwd: dir,
    env: { ...localEnv, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  for (let attempt = 0; attempt < 180 && !output.includes('Convex functions ready!') && !output.includes('✘ [ERROR]') && child.exitCode === null && child.signalCode === null; attempt++) await sleep(1000);
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  const localConfig = path.join(dir, '.convex', 'local', 'default', 'config.json');
  if (!output.includes('Convex functions ready!') || !(output.includes('[Local]') || output.includes('Configured a local deployment')) || !fs.existsSync(localConfig) || !match) {
    throw Error(`${name} isolated backend failed: ${output.slice(-1800)}`);
  }
  const backendPort = Number(match[1]);
  return {
    dir,
    cli,
    client: new ConvexHttpClient(`http://127.0.0.1:${backendPort}`),
    route: `http://127.0.0.1:${backendPort + 1}/dbcinema/shared-stock`,
    getOutput: () => output,
  };
}

async function setEnv(backend, values) {
  for (const [key, value] of Object.entries(values)) await run(backend.cli, ['env', 'set', key, value], { cwd: backend.dir, env: localEnv });
}

async function main() {
  exposeCachedBackendBinaries();
  await skipUnavailableBundledDashboard();
  const managerRouteSource = fs.readFileSync(path.join(managerSource, 'convex/http.ts'), 'utf8');
  assert.match(managerRouteSource, /path:\s*["']\/dbcinema\/shared-stock["']/);
  assert.match(managerRouteSource, /sharedStockCoordinator\.dispatch/);
  assert.doesNotMatch(managerRouteSource, /shared_stock_authority/);
  const coordinatorSource = fs.readFileSync(path.join(managerSource, 'convex/sharedStockCoordinator.ts'), 'utf8');
  assert.match(coordinatorSource, /export const dispatch\s*=\s*internalMutation/);

  const offManagerDir = copyIsolatedProject('manager-off', managerSource, 'shared-stock-coordinator-manager.ts.fixture', 'SYNTHETIC_SHARED_STOCK_WRITERS_READY');
  const readyManagerDir = copyIsolatedProject('manager-ready', managerSource, 'shared-stock-coordinator-manager.ts.fixture', 'SYNTHETIC_SHARED_STOCK_WRITERS_READY');

  const offManager = await launch('Manager route-off', offManagerDir, { SYNTHETIC_SHARED_STOCK_WRITERS_READY: 'disabled' });
  await setEnv(offManager, { DBCINEMA_SHARED_STOCK_TOKEN: secret, BETTER_AUTH_SECRET: authSecret, SYNTHETIC_SHARED_STOCK_WRITERS_READY: 'disabled' });
  const readyManager = await launch('Manager coordinator', readyManagerDir, { SYNTHETIC_SHARED_STOCK_WRITERS_READY: 'enabled' });
  await setEnv(readyManager, { DBCINEMA_SHARED_STOCK_TOKEN: secret, BETTER_AUTH_SECRET: authSecret, SYNTHETIC_SHARED_STOCK_WRITERS_READY: 'enabled' });
  const { sendSharedStockRequest } = loadWebsiteTransport();

  const managerUrl = 'https://synthetic-manager.convex.site/dbcinema/booking-sync';
  const seedItem = makeFunctionReference('shared_stock_protocol_fixture:seedItem');
  const seedSiteBooking = makeFunctionReference('shared_stock_protocol_fixture:seedSiteBooking');
  const seedUnpaidCheckoutMarker = makeFunctionReference('shared_stock_protocol_fixture:seedUnpaidCheckoutMarker');
  const insertExternal = makeFunctionReference('shared_stock_protocol_fixture:insertSyntheticExternalReservation');
  const syncSiteBooking = makeFunctionReference('shared_stock_protocol_fixture:syncSyntheticSiteBooking');
  const inspect = makeFunctionReference('shared_stock_protocol_fixture:inspect');
  const sendRequest = (request, backend = readyManager) => sendSharedStockRequest(request, {
    enabled: true,
    managerUrl,
    secret,
    fetcher: async (_url, init) => {
      const target = new URL(backend.route);
      if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/dbcinema/shared-stock' || target.search || target.hash) {
        throw Error('The synthetic adapter only permits an isolated loopback Manager route.');
      }
      return fetch(target, init);
    },
  });
  const start = Date.UTC(2031, 0, 1, 10);
  const returnAt = Date.UTC(2031, 0, 1, 18);
  const makeSiteBooking = ({ id, revision = 1, status, itemId, diditStatus = 'processing', paidConfirmedAt, checkoutPaidAt, includePhysicalReservations = true }) => {
    const verified = diditStatus === 'verified';
    const checkStatus = verified ? 'approved' : diditStatus === 'manual_review' ? 'review' : diditStatus;
    return {
      id,
      revision,
      status,
      verification: {
        version: 1,
        provider: 'didit',
        status: diditStatus,
        checks: { identity: checkStatus, selfie: checkStatus, address: checkStatus },
        accountId: verified ? `synthetic-account-${id}` : null,
        sessionId: `synthetic-${id}`,
        updatedAt: Date.now(),
        securityReady: true,
        archiveReady: true,
        requiresDroneLicence: false,
        droneLicenceStatus: 'not_required',
        approved: verified,
        documentsApproved: verified,
        identityApproved: verified,
        bookingConfirmed: status === 'confirmed',
      },
      customerName: 'Synthetic Protocol Renter',
      customerEmail: 'synthetic-protocol@example.invalid',
      fulfilment: 'pickup',
      pickupTime: null,
      returnTime: null,
      start,
      end: returnAt,
      subtotal: 50,
      discount: 0,
      deliveryFee: 0,
      depositAmount: 0,
      total: 50,
      currency: 'GBP',
      createdAt: Date.now(),
      ...(Number.isFinite(paidConfirmedAt) ? { paidConfirmedAt } : {}),
      ...(Number.isFinite(checkoutPaidAt) ? { checkoutPaidAt } : {}),
      lineItems: [{ title: 'Synthetic shared stock camera', qty: 1, start, end: returnAt, units: [] }],
      ...(includePhysicalReservations ? { physicalReservations: [{
        rmv2ItemId: itemId,
        qty: 1,
        start,
        end: returnAt + 3600000,
        status: 'pending_verification',
        endExclusive: true,
        stockWindowVersion: 2,
        turnaroundBufferMinutes: 60,
      }] } : {}),
    };
  };
  const syncBooking = booking => readyManager.client.action(syncSiteBooking, { booking });

  const offResponse = await fetch(offManager.route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shared-stock-token': secret },
    body: JSON.stringify({ version: 1, operation: 'acquire', args: { requestId: 'synthetic_route_off', items: [] } }),
  });
  const offStatus = offResponse.status;
  const offBodyText = await offResponse.text();
  assert.equal(offStatus, 503, `Expected the route readiness 503, got ${offStatus}: ${offBodyText}\n${offManager.getOutput().slice(-2500)}`);
  assert.deepEqual(JSON.parse(offBodyText), { version: 1, operation: 'acquire', error: 'shared_stock_writers_not_ready' });
  const offTransport = await sendRequest({ operation: 'acquire', args: { requestId: 'synthetic_route_off_transport', items: [{ itemId: 'synthetic-item', start, returnAt, quantity: 1 }] } }, offManager);
  assert.deepEqual(offTransport, { status: 'unknown' });
  console.log('PASS route readiness off: local HTTP 503, website transport fails closed as unknown.');

  const itemId = await readyManager.client.mutation(seedItem, { quantity: 1 });
  await readyManager.client.mutation(seedUnpaidCheckoutMarker, { itemId, start, returnAt });
  const unpaidCheckout = await syncBooking(makeSiteBooking({
    id: 'synthetic_unpaid_checkout_0001',
    status: 'pending_payment',
    itemId,
    diditStatus: 'processing',
  }));
  assert.equal(unpaidCheckout.skipped, 1);
  const unpaidVerification = await syncBooking(makeSiteBooking({
    id: 'synthetic_unpaid_pending_verification_0001',
    status: 'pending_verification',
    itemId,
    diditStatus: 'processing',
  }));
  assert.equal(unpaidVerification.skipped, 1);
  const unpaidState = await readyManager.client.query(inspect, {});
  assert.ok(!unpaidState.reservations.some(row => row.hygglo_order_id === 'synthetic_unpaid_checkout_0001' || row.hygglo_order_id === 'synthetic_unpaid_pending_verification_0001'));
  const acquire = { operation: 'acquire', args: { requestId: 'synthetic_acquire_replay_0001', items: [{ itemId, start, returnAt, quantity: 1 }] } };
  const acquired = await sendRequest(acquire);
  assert.equal(acquired.status, 'confirmed');
  assert.deepEqual(acquired.result, { state: 'prepared', replayed: false, requestId: acquire.args.requestId, fingerprint: acquired.result.fingerprint });
  const replay = await sendRequest(acquire);
  assert.equal(replay.status, 'confirmed');
  assert.equal(replay.result.state, 'prepared');
  assert.equal(replay.result.replayed, true);
  assert.equal(replay.result.fingerprint, acquired.result.fingerprint);
  const conflict = await sendRequest({ operation: 'acquire', args: { ...acquire.args, requestId: 'synthetic_capacity_conflict_0001' } });
  assert.deepEqual(conflict, { status: 'capacity_conflict' });
  console.log('PASS unpaid cart marker, pending_payment, and unattested pending_verification do not reserve stock; acquire/replay and claim capacity conflict are correct.');

  const external = await readyManager.client.mutation(insertExternal, {
    itemId, start, returnAt, bookingId: 'synthetic_external_booking_0001',
  });
  assert.ok(external.id);
  assert.equal(external.persisted.hygglo_order_id, 'synthetic_external_booking_0001');
  const afterExternal = await readyManager.client.query(inspect, {});
  assert.ok(afterExternal.reservations.some(row => row.hygglo_order_id === 'synthetic_external_booking_0001' && row.status === 'confirmed'));
  assert.equal(afterExternal.claims.find(row => row.request_id === acquire.args.requestId).state, 'conflicted');
  const execution = await sendRequest({ operation: 'beginExecution', args: { id: acquired.result.requestId, fingerprint: acquired.result.fingerprint, executionKey: 'synthetic_external_conflict_exec' } });
  assert.deepEqual(execution, { status: 'capacity_conflict' });
  console.log('PASS confirmed external reservation persisted and fenced the overlapping claim.');

  for (const diditStatus of ['processing', 'manual_review', 'verified', 'requires_input']) {
    const pendingItem = await readyManager.client.mutation(seedItem, { quantity: 1 });
    const bookingId = `synthetic_paid_didit_${diditStatus}_0001`;
    const checkoutPaidAt = Date.now();
    const synced = await syncBooking(makeSiteBooking({ id: bookingId, status: 'pending_verification', itemId: pendingItem, diditStatus, checkoutPaidAt }));
    assert.equal(synced.upserted, 1);
    assert.equal(synced.receipts[0].outcome, 'applied');
    const pendingState = await readyManager.client.query(inspect, {});
    const pending = pendingState.reservations.find(row => row.hygglo_order_id === bookingId);
    assert.ok(pending, 'the website paid/Didit booking should reach Manager');
    assert.equal(pending.status, 'pending_review');
    assert.equal(pending.booking_status, 'pending_verification');
    assert.ok(['VERIFIED', 'BOOKED_AFTER_VERIFIED'].includes(pending.order_step));
    assert.equal(pending.site_checkout_paid_at, checkoutPaidAt);
    assert.equal(pending.site_paid_confirmed_at, undefined, 'pending verification must not get the confirmed-payment timestamp');
    assert.equal(pending.site_verification.provider, 'didit');
    assert.equal(pending.site_verification.status, diditStatus);
    assert.ok(Number.isSafeInteger(pending.site_checkout_paid_at) && pending.site_checkout_paid_at > 0);
    const blocked = await sendRequest({ operation: 'acquire', args: {
      requestId: `synthetic_paid_didit_blocks_${diditStatus}_0001`,
      items: [{ itemId: pendingItem, start, returnAt, quantity: 1 }],
    } });
    assert.deepEqual(blocked, { status: 'capacity_conflict' }, `Paid Didit ${diditStatus} reservation must retain stock.`);
    console.log(`PASS payment-attested pending-verification row with Didit ${diditStatus} blocks a second renter.`);

    if (diditStatus === 'requires_input') {
      const rejected = await syncBooking(makeSiteBooking({ id: bookingId, revision: 2, status: 'pending_verification', itemId: pendingItem, diditStatus: 'rejected', checkoutPaidAt, includePhysicalReservations: false }));
      assert.equal(rejected.upserted, 1);
      const terminal = (await readyManager.client.query(inspect, {})).reservations.find(row => row.hygglo_order_id === bookingId);
      assert.equal(terminal.status, 'cancelled');
      assert.equal(terminal.is_obsolete, true);
      assert.equal(terminal.obsolete_reason, 'verification_failed');
      const released = await sendRequest({ operation: 'acquire', args: {
        requestId: 'synthetic_didit_rejection_releases_0001',
        items: [{ itemId: pendingItem, start, returnAt, quantity: 1 }],
      } });
      assert.equal(released.status, 'confirmed', `Didit rejection should release stock: ${JSON.stringify(released)}`);
      console.log('PASS terminal Didit rejection releases pending paid stock.');
    }
  }

  for (const bookingStatus of ['cancelled']) {
    const pendingItem = await readyManager.client.mutation(seedItem, { quantity: 1 });
    const bookingId = `synthetic_paid_didit_cancel_${bookingStatus}_0001`;
    const checkoutPaidAt = Date.now();
    await syncBooking(makeSiteBooking({ id: bookingId, status: 'pending_verification', itemId: pendingItem, diditStatus: 'processing', checkoutPaidAt }));
    assert.deepEqual(await sendRequest({ operation: 'acquire', args: {
      requestId: `synthetic_pending_blocks_before_${bookingStatus}_0001`,
      items: [{ itemId: pendingItem, start, returnAt, quantity: 1 }],
    } }), { status: 'capacity_conflict' });
    const terminal = await syncBooking(makeSiteBooking({ id: bookingId, revision: 2, status: bookingStatus, itemId: pendingItem, diditStatus: 'processing', checkoutPaidAt, includePhysicalReservations: false }));
    assert.equal(terminal.upserted, 1);
    const terminalRow = (await readyManager.client.query(inspect, {})).reservations.find(row => row.hygglo_order_id === bookingId);
    assert.equal(terminalRow.status, 'cancelled');
    assert.equal(terminalRow.is_obsolete, true);
    assert.equal(terminalRow.booking_status, 'cancelled');
    const released = await sendRequest({ operation: 'acquire', args: {
      requestId: `synthetic_didit_${bookingStatus}_releases_0001`,
      items: [{ itemId: pendingItem, start, returnAt, quantity: 1 }],
    } });
    assert.equal(released.status, 'confirmed', `Booking ${bookingStatus} should release stock: ${JSON.stringify(released)}`);
    console.log(`PASS terminal booking ${bookingStatus} releases pending paid stock.`);
  }

  const bookedItem = await readyManager.client.mutation(seedItem, { quantity: 1 });
  const confirmedPaidAt = Date.now();
  const booked = await syncBooking(makeSiteBooking({ id: 'synthetic_confirmed_booking_0001', status: 'confirmed', itemId: bookedItem, diditStatus: 'verified', paidConfirmedAt: confirmedPaidAt, checkoutPaidAt: confirmedPaidAt }));
  assert.equal(booked.upserted, 1);
  const bookedRow = (await readyManager.client.query(inspect, {})).reservations.find(row => row.hygglo_order_id === 'synthetic_confirmed_booking_0001');
  assert.equal(bookedRow.status, 'confirmed');
  assert.equal(bookedRow.booking_status, 'confirmed');
  assert.equal(bookedRow.site_checkout_paid_at, confirmedPaidAt);
  const bookedConflict = await sendRequest({ operation: 'acquire', args: { requestId: 'synthetic_confirmed_booking_blocks_0001', items: [{ itemId: bookedItem, start, returnAt, quantity: 1 }] } });
  assert.deepEqual(bookedConflict, { status: 'capacity_conflict' });
  console.log('PASS an authoritative confirmed booking blocks the next renter.');

  const conversionItem = await readyManager.client.mutation(seedItem, { quantity: 2 });
  const conversionStart = Date.UTC(2031, 0, 3, 10);
  const conversionReturn = Date.UTC(2031, 0, 3, 18);
  const bookingId = 'synthetic_conversion_booking_0001';
  await readyManager.client.mutation(seedSiteBooking, { itemId: conversionItem, bookingId, start: conversionStart, returnAt: conversionReturn });
  const line = { itemId: conversionItem, start: conversionStart, returnAt: conversionReturn, quantity: 1 };
  const zeroRequest = { operation: 'acquireZero', args: { requestId: 'synthetic_conversion_0001', bookingId, oldItems: [line], newItems: [line] } };
  const zero = await sendRequest(zeroRequest);
  assert.equal(zero.status, 'confirmed');
  assert.equal(zero.result.state, 'prepared');
  const executionKey = 'synthetic_conversion_exec_0001';
  const begun = await sendRequest({ operation: 'beginExecution', args: { id: zero.result.requestId, fingerprint: zero.result.fingerprint, executionKey } });
  assert.equal(begun.status, 'confirmed');
  assert.equal(begun.result.state, 'execution_started');
  const receipt = {
    swapId: 'synthetic_swap_0001', bookingId, bookingRevision: 1,
    managerRequestId: zero.result.requestId, fingerprint: zero.result.fingerprint, executionKey,
    appliedAt: Date.now(),
    windows: [{ reservationId: 'synthetic_physical_reservation_0001', inventoryUnitId: 'synthetic_inventory_unit_0001', managerItemId: conversionItem,
      start: conversionStart, end: conversionReturn + 3600000, quantity: 1, endExclusive: true, turnaroundBufferMinutes: 60 }],
  };
  const converted = await sendRequest({ operation: 'checkConversion', args: { id: zero.result.requestId, fingerprint: zero.result.fingerprint, executionKey, receipt } });
  assert.deepEqual(converted, { status: 'confirmed', result: { state: 'converted', replayed: false, stockRisk: false } });
  const convertedReplay = await sendRequest({ operation: 'checkConversion', args: { id: zero.result.requestId, fingerprint: zero.result.fingerprint, executionKey, receipt } });
  assert.deepEqual(convertedReplay, { status: 'confirmed', result: { state: 'converted', replayed: true, stockRisk: false } });
  const acquisitionReplay = await sendRequest(zeroRequest);
  assert.equal(acquisitionReplay.status, 'confirmed', `Identical acquireZero replay was not confirmed: ${JSON.stringify(acquisitionReplay)}`);
  assert.equal(acquisitionReplay.result.replayed, true);
  assert.equal(acquisitionReplay.result.requestId, zero.result.requestId);
  assert.equal(acquisitionReplay.result.fingerprint, zero.result.fingerprint);
  const alteredZeroRequest = {
    ...zeroRequest,
    args: { ...zeroRequest.args, newItems: [{ ...line, quantity: 2 }] },
  };
  const alteredResponse = await fetch(readyManager.route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shared-stock-token': secret },
    body: JSON.stringify({ version: 1, ...alteredZeroRequest }),
  });
  assert.equal(alteredResponse.status, 409);
  assert.deepEqual(await alteredResponse.json(), { version: 1, operation: 'acquireZero', error: 'request_conflict' });
  console.log('PASS acquireZero execution/conversion, identical post-conversion replay, and altered-payload request conflict.');

  const evidence = {
    swapId: receipt.swapId, bookingId, bookingRevision: 1,
    paymentIntentId: 'pi_synthetic_evidence_only', refundId: 're_synthetic_evidence_only', refundStatus: 'succeeded',
    amountPence: 100, refundAttemptedAt: Date.now(),
    windows: [{ itemId: conversionItem, start: conversionStart, end: conversionReturn + 3600000, quantity: 1 }],
  };
  const compensated = await sendRequest({ operation: 'releaseCompensated', args: { id: zero.result.requestId, fingerprint: zero.result.fingerprint, executionKey, evidence } });
  assert.deepEqual(compensated, { status: 'confirmed', result: { state: 'compensated_released', replayed: false } });
  const compensationReplay = await sendRequest({ operation: 'checkCompensatedRelease', args: { id: zero.result.requestId, fingerprint: zero.result.fingerprint, executionKey, evidence } });
  assert.deepEqual(compensationReplay, { status: 'confirmed', result: { state: 'compensated_released', replayed: true } });
  console.log('PASS synthetic compensation evidence release and idempotent verification (no payment provider calls).');
  console.log('PASS synthetic shared-stock coordinator protocol E2E complete.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => cleanup().catch(error => { console.error('Local cleanup failed:', error); process.exitCode = 1; }));
