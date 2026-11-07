const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { ConvexHttpClient } = require('convex/browser'), { makeFunctionReference } = require('convex/server');
const root = path.resolve(__dirname, '..'), workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-swap-legacy-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
async function cleanup() {
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) await sleep(100);
    if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  fs.rmSync(workspace, { recursive: true, force: true });
}
async function main() {
  for (const name of ['convex', 'shared', 'src/lib']) fs.cpSync(path.join(root, name), path.join(workspace, name), { recursive: true });
  for (const name of ['package.json', 'tsconfig.json']) fs.copyFileSync(path.join(root, name), path.join(workspace, name));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'dir');
  fs.rmSync(path.join(workspace, 'convex/crons.ts'), { force: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures/swap-legacy-runtime.ts.fixture'), path.join(workspace, 'convex/swap_legacy_qualify.ts'));
  const authority = path.join(workspace, 'convex/lib/rentalSwapAuthority.ts'), original = fs.readFileSync(authority, 'utf8');
  assert.match(original, /return false;/); fs.writeFileSync(authority, original.replace('return false;', 'return true;'));
  const schema = path.join(workspace, 'convex/schema.ts'), schemaText = fs.readFileSync(schema, 'utf8');
  assert.match(schemaText, /\}\);\s*$/); fs.writeFileSync(schema, schemaText.replace(/\}\);\s*$/, '}, { schemaValidation: false });\n'));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CONVEX_AGENT_MODE: 'anonymous', XDG_CONFIG_HOME: path.join(workspace, 'config') }, cli = path.join(root, 'node_modules/.bin/convex');
  child = spawn(cli, ['dev', '--typecheck', 'disable', '--codegen', 'disable', '--tail-logs', 'disable'], { cwd: workspace, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
  for (let attempt = 0; attempt < 180 && !output.includes('Convex functions ready!') && child.exitCode === null && child.signalCode === null; attempt++) await sleep(1000);
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  if (!match || !output.includes('[Local]') || !output.includes('Convex functions ready!')) throw Error(`Isolated backend did not start: ${output.slice(-1200)}`);
  for (const [key, value] of [['ADMIN_TOKEN', 'synthetic-admin'], ['SHARED_STOCK_BRIDGE_EXPERIMENTAL', 'true'], ['RMV2_OUTBOUND_ENABLED', 'false']]) execFileSync(cli, ['env', 'set', key, value], { cwd: workspace, env, stdio: 'ignore' });
  const client = new ConvexHttpClient(match[0]), ref = name => makeFunctionReference(name), fixture = await client.mutation(ref('swap_legacy_qualify:seed'), {});
  const args = { token: 'synthetic-admin', bookingId: fixture.booking, id: fixture.receipt, confirmed: true };
  const result = await Promise.allSettled([client.mutation(ref('swapStockAudit:retryLegacyDelivery'), args), client.mutation(ref('swapStockAudit:retryLegacyDelivery'), args)]);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(result.filter(item => item.status === 'rejected').length, 1);
  const state = await client.query(ref('swap_legacy_qualify:state'), { booking: fixture.booking, receipt: fixture.receipt });
  assert.equal(state.receipt.deliveryState, 'pending'); assert.equal(state.booking.activeItemSwapId, fixture.swap); assert.equal(state.booking.rmv2Revision, 3);
  console.log('PASS isolated Convex simultaneous legacy receipt retries: one queue, one revision, fence preserved; outbound disabled.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(cleanup);
