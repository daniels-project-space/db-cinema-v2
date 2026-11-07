const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { ConvexHttpClient } = require('convex/browser'), { makeFunctionReference } = require('convex/server');
const root = path.resolve(__dirname, '..'), workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-conversation-ack-'));
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
  fs.copyFileSync(path.join(__dirname, 'fixtures/conversation-ack-runtime.ts.fixture'), path.join(workspace, 'convex/conversation_ack_qualify.ts'));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CONVEX_AGENT_MODE: 'anonymous', XDG_CONFIG_HOME: path.join(workspace, 'config') };
  child = spawn(path.join(root, 'node_modules/.bin/convex'), ['dev', '--typecheck', 'disable', '--codegen', 'disable', '--tail-logs', 'disable'], { cwd: workspace, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
  for (let attempt = 0; attempt < 180 && !output.includes('Convex functions ready!') && child.exitCode === null && child.signalCode === null; attempt++) await sleep(1000);
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  if (!match || !output.includes('[Local]') || !output.includes('Convex functions ready!')) throw Error(`Isolated backend did not start: ${output.slice(-1200)}`);
  const client = new ConvexHttpClient(match[0]), ref = name => makeFunctionReference(`conversation_ack_qualify:${name}`);
  await client.mutation(ref('seed'), {});
  await client.mutation(ref('acknowledge'), {});
  let rows;
  for (let attempt = 0; attempt < 60; attempt++) {
    rows = await client.query(ref('inspect'), {});
    if (rows.filter(row => row.eventKey.startsWith('message-') && row.read).length === 125) break;
    await sleep(250);
  }
  assert.equal(rows.filter(row => row.eventKey.startsWith('message-') && row.read).length, 125);
  for (const key of ['human_request', 'gaffer_resumed']) assert.equal(rows.find(row => row.eventKey === key).read, true);
  for (const key of ['verification_failure', 'identity_match', 'booking_paid', 'future', 'general']) assert.equal(rows.find(row => row.eventKey === key).read, false);
  console.log('PASS isolated Convex notification acknowledgement: indexed batching, scheduled continuation, and preservation of unrelated, future and general alerts.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(cleanup);
