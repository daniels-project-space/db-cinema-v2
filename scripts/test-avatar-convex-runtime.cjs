const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ConvexHttpClient } = require('convex/browser'), { makeFunctionReference } = require('convex/server');
const root = path.resolve(__dirname, '..'), workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-avatar-runtime-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) await sleep(100);
    if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  fs.rmSync(workspace, { recursive: true, force: true });
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => cleanup().finally(() => process.exit(code)));
async function main() {
  for (const name of ['convex', 'shared', 'src/lib']) fs.cpSync(path.join(root, name), path.join(workspace, name), { recursive: true });
  for (const name of ['package.json', 'tsconfig.json']) fs.copyFileSync(path.join(root, name), path.join(workspace, name));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(workspace, 'node_modules'), 'dir');
  fs.rmSync(path.join(workspace, 'convex/crons.ts'), { force: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures/avatar-runtime.ts.fixture'), path.join(workspace, 'convex/avatar_qualify.ts'));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CONVEX_AGENT_MODE: 'anonymous', XDG_CONFIG_HOME: path.join(workspace, 'config') };
  child = spawn(path.join(root, 'node_modules/.bin/convex'), ['dev', '--typecheck', 'disable', '--codegen', 'disable', '--tail-logs', 'disable'], { cwd: workspace, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
  for (let attempt = 0; attempt < 180 && !output.includes('Convex functions ready!') && child.exitCode === null && child.signalCode === null; attempt++) await sleep(1000);
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  if (!match || !output.includes('[Local]') || !output.includes('Convex functions ready!')) throw Error(`Isolated backend did not start: ${output.slice(-1200)}`);
  const client = new ConvexHttpClient(match[0]), ref = name => makeFunctionReference(`avatar_qualify:${name}`);
  const accountId = await client.mutation(ref('seed'), {}), reserved = await client.mutation(ref('reserve'), {});
  const png = await require('sharp')({ create: { width: 2, height: 2, channels: 3, background: '#abcdef' } }).png().toBuffer();
  const digest = crypto.createHash('sha256').update(png).digest('hex'), chunks = [png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)];
  const before = await client.query(ref('inspect'), { accountId });
  await assert.rejects(() => client.mutation(ref('commitThenFail'), { ...reserved, digest, chunks }), /Synthetic failure/);
  const rolledBack = await client.query(ref('inspect'), { accountId });
  assert.equal(rolledBack.storage.length, before.storage.length, 'Failed transaction cannot leave a stored file');
  assert.equal(rolledBack.account.avatarStorageId, undefined, 'Failed transaction cannot bind a photo');
  const endpoint = `http://127.0.0.1:${Number(match[1]) + 1}/renter-avatar`;
  const response = await fetch(endpoint, { method: 'POST', headers: { origin: 'https://dbcinemarentals.com', authorization: 'Bearer avatar-fixture-token', 'content-type': 'image/png' }, body: png });
  assert.equal(response.status, 200);
  const saved = await client.query(ref('inspect'), { accountId });
  assert.equal(saved.storage.length, before.storage.length + 1);
  assert.equal(saved.account.avatarStorageId, saved.account.avatarOwnedStorageId);
  assert.equal(saved.storage[0]._id, saved.account.avatarStorageId);
  console.log('PASS isolated Convex avatar rollback and real HTTP upload; synthetic data only.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(cleanup);
