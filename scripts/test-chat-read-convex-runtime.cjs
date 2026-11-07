const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { ConvexHttpClient } = require('convex/browser'), { makeFunctionReference } = require('convex/server');
const root = path.resolve(__dirname, '..'), workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-chat-read-'));
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
  fs.copyFileSync(path.join(__dirname, 'fixtures/chat-read-runtime.ts.fixture'), path.join(workspace, 'convex/chat_read_qualify.ts'));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CONVEX_AGENT_MODE: 'anonymous', XDG_CONFIG_HOME: path.join(workspace, 'config') }, cli = path.join(root, 'node_modules/.bin/convex');
  child = spawn(cli, ['dev', '--typecheck', 'disable', '--codegen', 'disable', '--tail-logs', 'disable'], { cwd: workspace, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
  for (let attempt = 0; attempt < 180 && !output.includes('Convex functions ready!') && child.exitCode === null && child.signalCode === null; attempt++) await sleep(1000);
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  if (!match || !output.includes('[Local]') || !output.includes('Convex functions ready!')) throw Error(`Isolated backend did not start: ${output.slice(-1200)}`);
  execFileSync(cli, ['env', 'set', 'ADMIN_TOKEN', 'synthetic-admin'], { cwd: workspace, env, stdio: 'ignore' });
  const client = new ConvexHttpClient(match[0]), ref = name => makeFunctionReference(name), fixture = await client.mutation(ref('chat_read_qualify:seed'), {});
  async function pair(sender, at) {
    const older = await client.mutation(ref('chat_read_qualify:message'), { accountId: fixture.accountId, sender, at });
    await sleep(15);
    const newer = await client.mutation(ref('chat_read_qualify:message'), { accountId: fixture.accountId, sender, at });
    return { older, newer };
  }
  const renter = await pair('renter', 100);
  for (const through of [renter.newer, renter.older]) await client.mutation(ref('rentalChat:markRead'), { token: 'synthetic-admin', admin: true, accountId: fixture.accountId, through });
  assert.equal((await client.query(ref('chat_read_qualify:thread'), { threadId: fixture.threadId })).unreadOwner, 0);
  const owner = await pair('owner', 101);
  for (const through of [owner.newer, owner.older]) await client.mutation(ref('rentalChat:markRead'), { token: 'synthetic-chat-owner', through });
  assert.equal((await client.query(ref('chat_read_qualify:thread'), { threadId: fixture.threadId })).unreadRenter, 0);
  const logicalTime = Date.now() + 10000;
  const race = await pair('renter', logicalTime);
  await client.mutation(ref('chat_read_qualify:alerts'), { accountId: fixture.accountId, ...race });
  await client.mutation(ref('rentalChat:markRead'), { token: 'synthetic-admin', admin: true, accountId: fixture.accountId, through: race.older });
  let alerts;
  for (let attempt = 0; attempt < 80; attempt++) {
    alerts = await client.query(ref('chat_read_qualify:notifications'), {});
    if (alerts.filter(alert => alert.eventKey === `renter-message:${race.older}` && alert.read).length === 125) break;
    await sleep(250);
  }
  assert.equal(alerts.filter(alert => alert.eventKey === `renter-message:${race.older}` && alert.read).length, 125);
  assert.equal(alerts.filter(alert => alert.eventKey === `renter-message:${race.newer}` && !alert.read).length, 125);
  assert.equal(alerts.find(alert => alert.eventKey === 'historical-handoff').read, true);
  assert.equal(alerts.find(alert => alert.eventKey === 'uncertain-handoff').read, false);
  assert.equal(alerts.find(alert => alert.eventKey === 'verification-alert').read, false);
  assert.equal((await client.query(ref('chat_read_qualify:thread'), { threadId: fixture.threadId })).unreadOwner, 1);
  await client.mutation(ref('rentalChat:markRead'), { token: 'synthetic-admin', admin: true, accountId: fixture.accountId, through: race.newer });
  for (let attempt = 0; attempt < 80; attempt++) {
    alerts = await client.query(ref('chat_read_qualify:notifications'), {});
    if (alerts.filter(alert => alert.eventKey === `renter-message:${race.newer}` && alert.read).length === 125) break;
    await sleep(250);
  }
  assert.equal(alerts.filter(alert => alert.eventKey === `renter-message:${race.newer}` && alert.read).length, 125);
  for (const action of ['sendOwner', 'setHandler']) {
    const subject = await client.mutation(ref('chat_read_qualify:seed'), {}), at = Date.now() + 30000;
    const older = await client.mutation(ref('chat_read_qualify:message'), { accountId: subject.accountId, sender: 'renter', at });
    const newer = await client.mutation(ref('chat_read_qualify:message'), { accountId: subject.accountId, sender: 'renter', at: at + 100 });
    await client.mutation(ref('chat_read_qualify:alerts'), { accountId: subject.accountId, older, newer });
    await client.mutation(ref('chat_read_qualify:advanceThread'), { threadId: subject.threadId, at });
    const params = { token: 'synthetic-admin', accountId: subject.accountId };
    await client.mutation(ref(`rentalChat:${action}`), action === 'sendOwner' ? { ...params, text: 'Synthetic reply' } : { ...params, gaffer: false });
    for (let attempt = 0; attempt < 80; attempt++) {
      alerts = await client.query(ref('chat_read_qualify:notifications'), {});
      if (alerts.filter(alert => alert.eventKey === `renter-message:${older}` && alert.read).length === 125) break;
      await sleep(250);
    }
    assert.equal(alerts.filter(alert => alert.eventKey === `renter-message:${older}` && alert.read).length, 125, `${action} clears earlier alerts`);
    assert.equal(alerts.filter(alert => alert.eventKey === `renter-message:${newer}` && !alert.read).length, 125, `${action} preserves later alerts`);
  }
  console.log('PASS isolated Convex chat read markers: stale same-time requests cannot restore unread counts; synthetic data only.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(cleanup);
