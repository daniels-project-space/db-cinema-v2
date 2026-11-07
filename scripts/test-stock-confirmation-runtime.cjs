const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ConvexHttpClient } = require('convex/browser');
const { makeFunctionReference } = require('convex/server');

const root = path.resolve(__dirname, '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-stock-runtime-'));
let child;
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
let cleaned = false;

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (let attempts = 0; attempts < 50 && child.exitCode === null && child.signalCode === null; attempts++) await sleep(100);
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  fs.rmSync(workspace, { recursive: true, force: true });
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => { cleanup().finally(() => process.exit(code)); });

async function main() {
  for (const name of ['convex', 'shared', 'src/lib']) fs.cpSync(path.join(root, name), path.join(workspace, name), { recursive: true });
  for (const name of ['package.json', 'tsconfig.json']) fs.copyFileSync(path.join(root, name), path.join(workspace, name));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'dir');
  fs.copyFileSync(path.join(__dirname, 'fixtures/stock-confirmation-runtime.ts.fixture'), path.join(workspace, 'convex/stock_qualify.ts'));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CONVEX_AGENT_MODE: 'anonymous', XDG_CONFIG_HOME: path.join(workspace, 'config') };
  child = spawn(path.join(root, 'node_modules/.bin/convex'), ['dev', '--typecheck', 'disable', '--codegen', 'disable', '--tail-logs', 'disable'], { cwd: workspace, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', exited = false;
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.on('exit', () => { exited = true; });
  for (let attempts = 0; attempts < 180 && !output.includes('Convex functions ready!') && !exited; attempts++) await sleep(1000);
  if (!output.includes('Convex functions ready!')) throw Error(`Isolated backend did not start: ${output.slice(-1200)}`);
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  if (!match || !output.includes('[Local]')) throw Error('The test requires a new loopback-only local deployment.');
  const client = new ConvexHttpClient(match[0]);
  const seed = makeFunctionReference('stock_qualify:seed'), approve = makeFunctionReference('stock_qualify:approve'), inspect = makeFunctionReference('stock_qualify:inspect');
  for (let attempt = 0; attempt < 5; attempt++) {
    const bookingIds = await client.mutation(seed, {});
    const results = await Promise.all(bookingIds.map((bookingId, index) => client.action(approve, { bookingId, paymentIntentId: `pi_synthetic_${index}` })));
    const state = await client.query(inspect, { bookingIds });
    assert.equal(state.bookings.filter(booking => booking.status === 'confirmed').length, 1);
    const losing = state.bookings.find(booking => booking.status === 'pending_verification');
    assert.ok(losing);
    assert.equal(losing.verificationConfirmationIssue, 'inventory_unavailable');
    const losingIndex = bookingIds.indexOf(losing._id);
    assert.equal(losing.stripePaymentIntentId, `pi_synthetic_${losingIndex}`);
    const duplicate = await client.action(approve, { bookingId: losing._id, paymentIntentId: 'pi_synthetic_duplicate' });
    assert.equal(duplicate.duplicatePayment, true);
    const afterDuplicate = await client.query(inspect, { bookingIds });
    assert.equal(afterDuplicate.bookings[losingIndex].stripePaymentIntentId, `pi_synthetic_${losingIndex}`);
    assert.ok(state.notifications.some(notification => notification.bookingId === losing._id && notification.title === 'Paid booking needs stock review'));
    assert.equal(results.filter(result => result.awaitingInventoryReview).length, 1);
  }
  console.log('PASS isolated local Convex: five competing confirmation races; one confirmed and one alerted for review each time.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(cleanup);
