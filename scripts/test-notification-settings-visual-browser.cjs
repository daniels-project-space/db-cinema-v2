const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-admin-notification-visual-'));
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timestamp = Date.UTC(2026, 10, 21, 12, 0, 0);
const data = {
  configured: true,
  telegramConfigured: true,
  moreDevices: false,
  devices: [
    { deviceId: 'phone-1', label: 'Daniel’s iPhone', enabled: true, humanRequests: true, renterMessages: true, createdAt: timestamp },
    { deviceId: 'desktop-1', label: 'Studio admin desktop', enabled: false, humanRequests: true, renterMessages: false, createdAt: timestamp - 86400000, lastError: 'The browser permission is blocked. Allow alerts in browser settings, then reconnect this device.' }
  ],
  deliveries: [
    { _id: 'push-1', title: 'New renter message', deviceLabel: 'Daniel’s iPhone', attempts: 1, status: 'sent', updatedAt: timestamp, canRetry: false },
    { _id: 'push-2', title: 'Rental task needs attention', deviceLabel: 'Studio admin desktop', attempts: 2, status: 'retry', updatedAt: timestamp - 60000, canRetry: true, lastError: 'Temporary push service issue. You can retry this alert.' }
  ],
  telegramDeliveries: [
    { _id: 'telegram-1', title: 'Rental update', attempts: 1, status: 'sent', createdAt: timestamp, canRetry: false }
  ]
};

let server;
let chrome;
let browser;

async function main() {
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{NotificationSettings}from'./src/components/admin/NotificationSettings';createRoot(document.getElementById('root')).render(<NotificationSettings token="synthetic-admin"/>);`;
  const apiMock = `export const api={adminNotifications:{settings:'admin.settings',device:'admin.device',preferences:'admin.preferences',disable:'admin.disable',retry:'admin.retry'},ownerTelegram:{retry:'telegram.retry'}};`;
  const convexMock = `export const useQuery=(key)=>key==='admin.settings'?${JSON.stringify(data)}:key==='admin.device'?{configured:true,enabled:true,publicKey:'AQ'}:undefined;export const useMutation=()=>async()=>{};`;
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'tsx' },
    bundle: true,
    write: false,
    outdir: path.join(directory, 'out'),
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.css': 'local-css' },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'notification-fixtures',
      setup(build) {
        build.onResolve({ filter: /^convex\/react$/ }, () => ({ path: 'convex/react', namespace: 'fixture' }));
        build.onResolve({ filter: /^@cvx\/_generated\/api$/ }, () => ({ path: '@cvx/_generated/api', namespace: 'fixture' }));
        build.onResolve({ filter: /^@\// }, args => {
          const resolved = path.join(root, 'src', args.path.slice(2));
          return { path: path.extname(resolved) ? resolved : `${resolved}.tsx` };
        });
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
          if (args.path === 'convex/react') return { loader: 'js', resolveDir: root, contents: convexMock };
          if (args.path === '@cvx/_generated/api') return { loader: 'js', resolveDir: root, contents: apiMock };
        });
      }
    }]
  });

  server = http.createServer((request, response) => {
    if (request.url === '/bundle.js' || request.url === '/style.css') {
      const css = request.url === '/style.css';
      response.setHeader('content-type', css ? 'text/css' : 'text/javascript');
      response.end(bundle.outputFiles.find(file => file.path.endsWith(css ? '.css' : '.js')).text);
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end('<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#111;color:#eee;font-family:Arial,sans-serif}#root{width:100%;padding:16px}button[aria-label$="phone alerts"]{display:flex;align-items:center;gap:8px;min-height:40px;padding:8px 12px;border:1px solid #ffffff26;border-radius:8px;background:#ffffff08;color:#ead9c7;font-size:12px;cursor:pointer}button[aria-label$="phone alerts"] svg{width:16px;height:16px}</style><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(directory, 'chrome');
  chrome = spawn('/opt/google/chrome/chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { stdio: 'ignore' });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; }
    catch { await sleep(100); }
  }
  assert(port, 'Headless Chrome starts for the local UI fixture');
  process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
  browser = await connect();
  await browser.cmd('Page.enable');
  await browser.cmd('Runtime.enable');
  await browser.cmd('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>({active:{state:'activated'},pushManager:{getSubscription:async()=>null}})}});window.PushManager=function(){};window.Notification=function(){};Object.defineProperty(window.Notification,'permission',{configurable:true,get:()=> 'default'});window.Notification.requestPermission=async()=> 'default';" });

  async function render(width, height, mobile) {
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await browser.cmd('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await browser.evaluate('!!document.querySelector("section")'); attempt++) await sleep(50);
    await sleep(100);
    const metrics = await browser.evaluate(`(()=>{const root=document.querySelector('section');const rect=root.getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,left:rect.left,right:rect.right,headings:[...root.querySelectorAll('h2,h3')].map(x=>x.textContent),buttons:[...root.querySelectorAll('button')].map(x=>x.textContent.trim()),phoneControl:!!root.querySelector('button[aria-label*="alerts"]'),text:root.innerText}})()`);
    assert(metrics.scrollWidth <= width, 'Notification settings do not create horizontal page overflow');
    assert(metrics.left >= 0 && metrics.right <= width, 'Notification settings remain inside the viewport');
    assert.deepEqual(metrics.headings, ['Notifications', 'Set up this phone', 'Team devices', 'Recent delivery attempts', 'Telegram alerts']);
    assert(metrics.phoneControl, 'The owner phone-alert control renders with the settings');
    assert(metrics.buttons.some(button => button.includes('Retry delivery')), 'Retry control remains visible and actionable');
    assert.match(metrics.text, /Retry needed/, 'A retry state is shown as a clear action state');
    return metrics;
  }

  await render(1440, 1000, false);
  fs.writeFileSync('/tmp/dbc-admin-notification-settings-desktop.png', Buffer.from((await browser.cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await browser.evaluate('window.scrollTo(0,document.body.scrollHeight)');
  await sleep(50);
  assert.equal(await browser.evaluate(`(()=>{const heading=[...document.querySelectorAll('h3')].find(item=>item.textContent==='Telegram alerts');const rect=heading.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight})()`), true, 'Telegram delivery grouping remains reachable at the end of the settings page');
  fs.writeFileSync('/tmp/dbc-admin-notification-settings-desktop-bottom.png', Buffer.from((await browser.cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await render(390, 844, true);
  fs.writeFileSync('/tmp/dbc-admin-notification-settings-mobile.png', Buffer.from((await browser.cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await browser.evaluate('window.scrollTo(0,document.body.scrollHeight)');
  await sleep(50);
  assert.equal(await browser.evaluate(`(()=>{const heading=[...document.querySelectorAll('h3')].find(item=>item.textContent==='Telegram alerts');const rect=heading.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight})()`), true, 'Telegram settings remain reachable on mobile');
  fs.writeFileSync('/tmp/dbc-admin-notification-settings-mobile-bottom.png', Buffer.from((await browser.cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('PASS notification settings visual fixture: desktop and 390px mobile fit, grouped sections render, and delivery retry remains actionable. Synthetic records only. Screenshots: /tmp/dbc-admin-notification-settings-desktop.png, /tmp/dbc-admin-notification-settings-desktop-bottom.png, /tmp/dbc-admin-notification-settings-mobile.png, /tmp/dbc-admin-notification-settings-mobile-bottom.png');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) { try { await Promise.race([browser.cmd('Browser.close'), sleep(1000)]); } catch {} try { browser.close(); } catch {} }
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) { const done = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await Promise.race([done, sleep(2000)]); }
  if (server) { server.closeAllConnections(); await Promise.race([new Promise(resolve => server.close(resolve)), sleep(1000)]); }
  try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
  process.exit(process.exitCode ?? 0);
});
