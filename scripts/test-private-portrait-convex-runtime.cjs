const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), esbuild = require('esbuild'), postcss = require('postcss');
const { spawn, execFileSync } = require('node:child_process');
const { ConvexHttpClient } = require('convex/browser'), { makeFunctionReference } = require('convex/server');
const root = path.resolve(__dirname, '..'), workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-portrait-runtime-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, chrome, browser, server, cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  if (browser) browser.close();
  if (chrome && chrome.exitCode === null) { const done = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await done; }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
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
  fs.copyFileSync(path.join(__dirname, 'fixtures/portrait-runtime.ts.fixture'), path.join(workspace, 'convex/portrait_qualify.ts'));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CONVEX_AGENT_MODE: 'anonymous', XDG_CONFIG_HOME: path.join(workspace, 'config') }, cli = path.join(root, 'node_modules/.bin/convex');
  child = spawn(cli, ['dev', '--typecheck', 'disable', '--codegen', 'disable', '--tail-logs', 'disable'], { cwd: workspace, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
  for (let attempt = 0; attempt < 180 && !output.includes('Convex functions ready!') && child.exitCode === null && child.signalCode === null; attempt++) await sleep(1000);
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  if (!match || !output.includes('[Local]') || !output.includes('Convex functions ready!')) throw Error(`Isolated backend did not start: ${output.slice(-1200)}`);
  for (const [key, value] of [['ADMIN_TOKEN', 'synthetic-admin'], ['PRIVATE_VERIFICATION_PHOTO_ENABLED', 'true'], ['PRIVATE_VERIFICATION_PHOTO_NOTICE_ENABLED', 'true']]) execFileSync(cli, ['env', 'set', key, value], { cwd: workspace, env, stdio: 'ignore' });
  const client = new ConvexHttpClient(match[0]), ref = name => makeFunctionReference(name), fixture = await client.mutation(ref('portrait_qualify:seed'), {});
  assert.equal(await client.query(ref('privateVerificationPortrait:availability'), { token: 'synthetic-admin' }), true);
  assert.equal(await client.query(ref('privateVerificationPortrait:availability'), { token: 'synthetic-portrait-owner' }), false, 'A renter cannot enable private directory portraits');
  const endpoint = `http://127.0.0.1:${Number(match[1]) + 1}/admin-private-portrait`;
  const request = (token = 'synthetic-admin') => fetch(endpoint, { method: 'POST', headers: { origin: 'https://dbcinemarentals.com', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ accountId: fixture.accountId, documentId: fixture.selfieId }) });
  assert.equal((await request('wrong')).status, 403);
  assert.equal(await client.query(ref('privateVerificationPortrait:selected'), { token: 'synthetic-portrait-other', accountId: fixture.accountId, refresh: 0 }), null, 'A renter session cannot read admin portrait selection');
  const ownProfile = await client.query(ref('accounts:me'), { token: 'synthetic-portrait-owner' });
  assert.equal(ownProfile.avatarUrl, null, 'A verification selfie must not become a public account avatar');
  assert(!JSON.stringify(ownProfile).includes(fixture.selfieId), 'The renter profile must not disclose the private document ID');
  const response = await request(); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')); assert.match(response.headers.get('cache-control'), /no-store/);
  await client.mutation(ref('portrait_qualify:setAccount'), { accountId: fixture.accountId, tooNew: true, hasPhoto: false });
  assert.equal((await request()).status, 403, 'A new account must wait 24 hours');
  await client.mutation(ref('portrait_qualify:setAccount'), { accountId: fixture.accountId, tooNew: false, hasPhoto: true });
  assert.equal((await request()).status, 403, 'A profile photo takes precedence');
  await client.mutation(ref('portrait_qualify:setAccount'), { accountId: fixture.accountId, tooNew: false, hasPhoto: false });
  await client.mutation(ref('privateVerificationPortrait:setPreference'), { token: 'synthetic-portrait-owner', allowed: false, noticeVersion: '2026-11-06', expectedRevision: 0 });
  assert.equal((await request()).status, 403, 'Withdrawal prevents a new download');
  await client.mutation(ref('privateVerificationPortrait:setPreference'), { token: 'synthetic-portrait-owner', allowed: true, noticeVersion: '2026-11-06', expectedRevision: 1 });
  assert.equal((await request()).status, 200);
  await client.mutation(ref('portrait_qualify:expire'), { bookingId: fixture.bookingId });
  assert.equal((await request()).status, 403, 'Expired archive cannot supply a portrait');
  await client.mutation(ref('portrait_qualify:openCase'), { bookingId: fixture.bookingId });
  assert.equal((await request()).status, 200, 'An open case protects the archive from expiry');
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{ConvexProvider,ConvexReactClient}from'convex/react';import{PrivatePortraitPreference}from'./src/components/account/PrivatePortraitPreference';import{PrivatePortraitOnboarding}from'./src/components/account/PrivatePortraitOnboarding';import{PrivateVerificationPortrait}from'./src/components/admin/PrivateVerificationPortrait';const client=new ConvexReactClient(${JSON.stringify(match[0])},{unsavedChangesWarning:false});const root=createRoot(document.getElementById('root'));window.renderFixture=(token,id)=>root.render(<ConvexProvider client={client}><div id="account"><PrivatePortraitPreference token={token}/></div><div id="prompt"><PrivatePortraitOnboarding key={token} token={token}/></div><div id="admin"><PrivateVerificationPortrait token="synthetic-admin" accountId={id}/></div></ConvexProvider>);window.renderFixture('synthetic-portrait-owner',${JSON.stringify(fixture.accountId)});`;
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_CONVEX_SITE_URL': '"."' }, plugins: [{ name: 'link-fixture', setup(build) { build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' })); build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'jsx', resolveDir: root, contents: `import React from 'react';export default function Link({href,children}){return <a href={href}>{children}</a>}` })); } }] });
  const cssPath = path.join(root, 'src/app/globals.css');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync(cssPath, 'utf8'), { from: cssPath });
  server = http.createServer(async (incoming, outgoing) => {
    try {
      if (incoming.url === '/fixture.js') { outgoing.setHeader('content-type', 'text/javascript'); outgoing.end(bundle.outputFiles[0].text); return; }
      if (incoming.url === '/fixture.css') { outgoing.setHeader('content-type', 'text/css'); outgoing.end(css.css); return; }
      if (incoming.url === '/admin-private-portrait') {
        const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
        const upstream = await fetch(endpoint, { method: 'POST', headers: { origin: 'https://dbcinemarentals.com', authorization: incoming.headers.authorization || '', 'content-type': 'application/json' }, body: Buffer.concat(chunks) });
        outgoing.writeHead(upstream.status, Object.fromEntries(upstream.headers)); outgoing.end(Buffer.from(await upstream.arrayBuffer())); return;
      }
      outgoing.setHeader('content-type', 'text/html'); outgoing.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
  const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
  const profile = path.join(workspace, 'browser-profile');
  chrome = spawn('/opt/google/chrome/chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { stdio: 'ignore' });
  let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { await sleep(100); } }
  assert(port); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; browser = await connect();
  await browser.cmd('Page.enable'); await browser.cmd('Runtime.enable'); await browser.cmd('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  async function until(expression) { for (let attempt = 0; attempt < 160; attempt++) { if (await browser.evaluate(expression)) return; await sleep(100); } throw Error(`Browser timed out: ${expression}`); }
  await until(`document.querySelector('#account')?.textContent.includes('Current choice: Allowed') && document.querySelector('#admin img')?.naturalWidth > 0`);
  const screenshot = await browser.cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/tmp/dbc-private-portrait-runtime.png', Buffer.from(screenshot.data, 'base64'));
  await browser.evaluate(`window.renderFixture('synthetic-portrait-other',${JSON.stringify(fixture.otherId)})`);
  await until(`document.querySelector('#account')?.textContent.includes('Current choice: Not allowed') && !document.querySelector('#admin img')`);
  await browser.evaluate(`window.renderFixture('synthetic-portrait-owner',${JSON.stringify(fixture.accountId)})`);
  await until(`document.querySelector('#admin img')?.naturalWidth > 0`);
  await browser.evaluate(`[...document.querySelectorAll('#account button')].find(button => button.textContent === 'Withdraw permission').click()`);
  await until(`document.querySelector('#account')?.textContent.includes('Current choice: Not allowed') && !document.querySelector('#admin img')`);
  assert.equal((await request()).status, 403);
  await browser.evaluate(`window.renderFixture('synthetic-portrait-new',${JSON.stringify(fixture.newId)})`);
  await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
  await until(`document.querySelector('#prompt')?.textContent.includes('A private photo for our team?')`);
  assert.equal(await browser.evaluate(`document.documentElement.scrollWidth > innerWidth`), false, 'The portrait choice must fit a narrow screen');
  const promptScreenshot = await browser.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/dbc-private-portrait-onboarding-320.png', Buffer.from(promptScreenshot.data, 'base64'));
  await browser.evaluate(`[...document.querySelectorAll('#prompt button')].find(button => button.textContent === 'No, thanks').click()`);
  await until(`!document.querySelector('#prompt aside')`);
  await browser.evaluate(`window.renderFixture('synthetic-portrait-other',${JSON.stringify(fixture.otherId)})`);
  await browser.evaluate(`window.renderFixture('synthetic-portrait-new',${JSON.stringify(fixture.newId)})`);
  await sleep(500); assert.equal(await browser.evaluate(`!!document.querySelector('#prompt aside')`), false, 'Explicit decline persists across account switches');
  const freshPreference = await client.query(ref('privateVerificationPortrait:preference'), { token: 'synthetic-portrait-new' });
  assert.equal(freshPreference.allowed, false, 'Declining never grants selfie consent');
  console.log('PASS isolated Convex portrait route and real React browser: delay, photo precedence, withdrawal, expiry, case hold, onboarding decline and account switch; synthetic data only.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(cleanup);
