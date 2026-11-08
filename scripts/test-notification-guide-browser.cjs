const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path'), esbuild = require('esbuild');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-notification-guide-'));
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, chrome, browser;
async function main() {
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{RenterNotificationBell}from'./src/components/account/RenterNotificationBell';createRoot(document.getElementById('root')).render(<RenterNotificationBell token="synthetic" chatOpen/>);`;
  const mocks = { 'convex/react': `export const useQuery=()=>location.search.includes('active=1')?{configured:true,enabled:true,publicKey:'AQ',messagesEnabled:!location.search.includes('messages=off'),bookingEnabled:true}:{configured:false};export const useMutation=()=>async()=>{};`, '@cvx/_generated/api': `export const api=new Proxy({},{get:()=>new Proxy({},{get:()=>''})});` };
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, outdir: path.join(directory, 'out'), platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'fixtures', setup(build) { build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined); build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: mocks[args.path] })); } }] });
  server = http.createServer((request, response) => { if (request.url === '/bundle.js' || request.url === '/style.css') { const css = request.url === '/style.css'; response.setHeader('content-type', css ? 'text/css' : 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith(css ? '.css' : '.js')).text); return; } response.setHeader('content-type', 'text/html'); response.end('<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#111;color:#eee;font-family:Arial,sans-serif}button{font:inherit;cursor:pointer}#root{position:absolute;right:24px;top:20px}</style><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(directory, 'chrome');
  chrome = spawn('/opt/google/chrome/chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { stdio: 'ignore' });
  let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { await sleep(100); } }
  assert(port); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; browser = await connect(); await browser.cmd('Page.enable'); await browser.cmd('Runtime.enable'); await browser.cmd('Network.enable');
  await browser.cmd('Page.addScriptToEvaluateOnNewDocument', {source:"if(location.search.includes('active=1')){Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>({active:{state:'activated'},pushManager:{getSubscription:async()=>({options:{applicationServerKey:new Uint8Array([1]).buffer}})}})}});window.PushManager=function(){};window.Notification=function(){};Object.defineProperty(window.Notification,'permission',{value:'granted'});}"});
  async function inspect(userAgent) {
    await browser.cmd('Network.setUserAgentOverride', { userAgent }); await browser.cmd('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await browser.evaluate('!!document.querySelector("button")'); attempt++) await sleep(50);
    await sleep(150); assert.equal(await browser.evaluate('!!document.querySelector("section")'),false,'Opening chat does not prematurely open settings');
    assert.equal(await browser.evaluate(`(()=>{let status;const receive=event=>status=event.detail;window.addEventListener('dbc:renter-notification-status',receive);window.dispatchEvent(new Event('dbc:request-renter-notification-status'));window.removeEventListener('dbc:renter-notification-status',receive);return status})()`),'inactive','The actual notification controller reports an unconfigured device as inactive');
    await browser.evaluate('window.dispatchEvent(new Event("dbc:open-renter-notifications"))'); await sleep(150);
    return browser.evaluate('document.querySelector("section")?.textContent || ""');
  }
  await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  const desktop = await inspect('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36');
  assert(!desktop.includes('Home Screen'), 'Desktop alerts do not require Home Screen installation');
  assert.equal(await browser.evaluate(`(()=>{const rect=document.querySelector('section').getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight})()`), true);
  fs.writeFileSync('/tmp/dbc-notification-popup-desktop.png', Buffer.from((await browser.cmd('Page.captureScreenshot', {format:'png'})).data,'base64'));
  const android = await inspect('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36');
  assert.match(android, /Optional: add to Home Screen/); assert.match(android, /Alerts work in your browser/);
  await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const iphone = await inspect('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1');
  assert.match(iphone, /Safari/); assert.match(iphone, /Add to Home Screen/); assert.match(iphone, /Allow/);
  assert.equal(await browser.evaluate(`(()=>{const rect=document.querySelector('section').getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight})()`), true, 'Mobile guide fits within the viewport and can scroll');
  fs.writeFileSync('/tmp/dbc-notification-popup-iphone.png', Buffer.from((await browser.cmd('Page.captureScreenshot', {format:'png'})).data,'base64'));
  await browser.cmd('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36' });
  await browser.cmd('Page.navigate', {url:'http://127.0.0.1:' + server.address().port + '/?active=1'});
  let activeStatus;
  for(let attempt=0;attempt<100;attempt++){activeStatus=await browser.evaluate("(()=>{let status;const receive=event=>status=event.detail;window.addEventListener('dbc:renter-notification-status',receive);window.dispatchEvent(new Event('dbc:request-renter-notification-status'));window.removeEventListener('dbc:renter-notification-status',receive);return status})()");if(activeStatus==='active')break;await sleep(50);}
  assert.equal(activeStatus,'active','A connected, permitted subscription is accurately reported as active');
  await browser.cmd('Page.navigate', {url:'http://127.0.0.1:' + server.address().port + '/?active=1&messages=off'});
  let chatStatus;
  for(let attempt=0;attempt<100;attempt++){chatStatus=await browser.evaluate("(()=>{let status;const receive=event=>status=event.detail;window.addEventListener('dbc:renter-notification-status',receive);window.dispatchEvent(new Event('dbc:request-renter-notification-status'));window.removeEventListener('dbc:renter-notification-status',receive);return status})()");if(chatStatus==='inactive')break;await sleep(50);}
  assert.equal(chatStatus,'inactive','A device with chat messages disabled still needs the chat invitation');
  await browser.evaluate("sessionStorage.setItem('dbc_open_chat_notification_settings','1')");
  await browser.cmd('Page.navigate', {url:'http://127.0.0.1:' + server.address().port + '/'});
  for(let attempt=0;attempt<100&&!await browser.evaluate('!!document.querySelector("section")');attempt++)await sleep(50);
  assert.equal(await browser.evaluate('!!document.querySelector("section")'),true,'A storefront invitation opens the real account notification setup');
  assert.equal(await browser.evaluate("sessionStorage.getItem('dbc_open_chat_notification_settings')"),null,'The handoff is consumed once');
  console.log('PASS notification guide: desktop, Android and iPhone instructions use the real component; synthetic browser only.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) browser.close(); if (chrome && chrome.exitCode === null) { const done = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await done; } if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
