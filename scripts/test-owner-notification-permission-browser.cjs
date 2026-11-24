const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-owner-notification-permission-'));
const helper = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', helper.slice(0, helper.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, chrome, browser;

async function main() {
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{OwnerNotificationBell}from'./src/components/admin/OwnerNotificationBell';createRoot(document.getElementById('root')).render(<main><h1>Admin workspace</h1><OwnerNotificationBell token="synthetic-admin"/></main>);`;
  const apiMock = `export const api={adminNotifications:{device:'device',subscribe:'subscribe',disable:'disable'}};`;
  const convexMock = `export const useQuery=(key,args)=>args==='skip'?undefined:{configured:true,enabled:!!window.__deviceEnabled,publicKey:'AQ'};export const useMutation=key=>async args=>{window.__calls.push({key,args});if(key==='subscribe')window.__deviceEnabled=true;if(key==='disable')window.__deviceEnabled=false;};`;
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false,
    outdir: path.join(directory, 'out'), platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'notification-fixture', setup(build) {
      build.onResolve({ filter: /^convex\/react$/ }, () => ({ path: 'convex/react', namespace: 'fixture' }));
      build.onResolve({ filter: /^@cvx\/_generated\/api$/ }, () => ({ path: '@cvx/_generated/api', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'convex/react' ? convexMock : apiMock }));
    } }]
  });
  server = http.createServer((request, response) => {
    if (request.url === '/bundle.js' || request.url === '/style.css') {
      const css = request.url === '/style.css';
      response.setHeader('content-type', css ? 'text/css' : 'text/javascript');
      response.end(bundle.outputFiles.find(file => file.path.endsWith(css ? '.css' : '.js')).text);
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end('<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#111;color:#eee;font-family:Arial,sans-serif}#root{width:100%;padding:12px}main{max-width:440px;margin:auto}h1{font-size:20px}button[aria-label*=alerts]{min-height:44px;padding:9px 12px;border:1px solid #e5c29a66;border-radius:11px;background:linear-gradient(135deg,#d5a574,#a57750);color:#21170e;font-size:12px;font-weight:600}button svg{width:16px;height:16px} [role=alert]{max-width:360px;color:#ffe0a8;font-size:12px}</style><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(directory, 'chrome');
  chrome = spawn('/opt/google/chrome/chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { stdio: 'ignore' });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; }
    catch { await sleep(100); }
  }
  assert(port, 'Headless Chrome starts for the isolated notification fixture');
  process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
  browser = await connect();
  await browser.cmd('Page.enable');
  await browser.cmd('Runtime.enable');
  await browser.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__deviceEnabled=false;window.__calls=[];window.__events=[];window.__browserSubscription=null;
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>({active:{state:'activated'},pushManager:{
      getSubscription:async()=>window.__browserSubscription,
      subscribe:async()=>{window.__events.push('subscribe');window.__browserSubscription={options:{applicationServerKey:new Uint8Array([1]).buffer},toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',keys:{p256dh:'synthetic-key',auth:'synthetic-auth'}}),unsubscribe:async()=>{window.__browserSubscription=null;return true}};return window.__browserSubscription}
    }})}});
    window.PushManager=function(){};window.Notification=function(){};
    window.__permission=new URLSearchParams(location.search).has('granted')?'granted':'default';
    Object.defineProperty(window.Notification,'permission',{configurable:true,get:()=>window.__permission});
    window.Notification.requestPermission=async()=>{window.__events.push('permission');window.__permission=location.search.includes('denied')?'denied':'granted';return window.__permission};
  ` });

  async function open(width, query = '') {
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.cmd('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/${query}` });
    for (let attempt = 0; attempt < 100 && !await browser.evaluate('!!document.querySelector("button[aria-label*=alerts]")'); attempt++) await sleep(50);
    for (let attempt = 0; attempt < 100 && !await browser.evaluate('document.querySelector("button[aria-label*=alerts]")?.disabled === false'); attempt++) await sleep(50);
    const layout = await browser.evaluate(`(()=>{const button=document.querySelector('button[aria-label*=alerts]');return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttonHeight:button?.getBoundingClientRect().height,disabled:button?.disabled,label:button?.innerText}})()`);
    assert(layout.width === width && layout.scrollWidth <= width, `Alert control fits ${width}px phone width: ${JSON.stringify(layout)}`);
    assert(layout.buttonHeight >= 44 && !layout.disabled, `Alert action is ready and touch-sized at ${width}px: ${JSON.stringify(layout)}`);
    return layout;
  }

  await open(320);
  await browser.evaluate('document.querySelector("button[aria-label*=alerts]").click()');
  for (let attempt = 0; attempt < 100 && !await browser.evaluate("window.__calls.some(call=>call.key==='subscribe')"); attempt++) await sleep(50);
  assert.deepEqual(await browser.evaluate('window.__events'), ['permission', 'subscribe'], 'A first tap requests browser permission before creating the push subscription');
  assert.equal(await browser.evaluate('window.Notification.permission'), 'granted');
  assert.equal(await browser.evaluate("window.__calls.at(-1).key"), 'subscribe', 'The confirmed subscription is saved after permission succeeds');
  assert.equal(await browser.evaluate('!!window.__browserSubscription'), true, 'A browser subscription is created only after permission is granted');
  for (let attempt = 0; attempt < 40 && !await browser.evaluate('document.querySelector("button[aria-label*=alerts]")?.innerText.includes("Phone alerts on")'); attempt++) await sleep(50);
  assert.equal(await browser.evaluate('document.querySelector("button[aria-label*=alerts]")?.innerText'), 'Phone alerts on');
  assert.equal(await browser.evaluate('!!document.querySelector("[role=alert]")'), false, 'A valid VAPID subscription does not leave a stale error in the phone control');
  fs.writeFileSync('/tmp/dbc-owner-notification-permission-320.png', Buffer.from((await browser.cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await open(390, '?denied=1');
  await browser.evaluate('document.querySelector("button[aria-label*=alerts]").click()');
  for (let attempt = 0; attempt < 100 && !await browser.evaluate('!!document.querySelector("[role=alert]")'); attempt++) await sleep(50);
  assert.deepEqual(await browser.evaluate('window.__events'), ['permission'], 'A denied browser prompt never creates a subscription');
  assert.match(await browser.evaluate('document.querySelector("[role=alert]")?.innerText'), /Allow phone alerts/);
  assert.equal(await browser.evaluate("window.__calls.some(call=>call.key==='subscribe')"), false);
  fs.writeFileSync('/tmp/dbc-owner-notification-denied-390.png', Buffer.from((await browser.cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await open(390, '?granted=1');
  await browser.evaluate('document.querySelector("button[aria-label*=alerts]").click()');
  for (let attempt = 0; attempt < 100 && !await browser.evaluate("window.__calls.some(call=>call.key==='subscribe')"); attempt++) await sleep(50);
  assert.deepEqual(await browser.evaluate('window.__events'), ['subscribe'], 'An already-granted browser permission is reused without another prompt');
  console.log('PASS admin phone-alert browser flow: 320/390px layout, permission prompt precedes subscription, denial is safe, and granted permission is reused. Synthetic browser only.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) { try { await Promise.race([browser.cmd('Browser.close'), sleep(1000)]); } catch {} try { browser.close(); } catch {} }
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) { const done = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await Promise.race([done, sleep(2000)]); }
  if (server) { server.closeAllConnections(); await Promise.race([new Promise(resolve => server.close(resolve)), sleep(1000)]); }
  try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
  process.exit(process.exitCode ?? 0);
});
