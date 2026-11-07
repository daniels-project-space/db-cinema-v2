const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const esbuild = require('esbuild');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AvatarUpload} from './src/components/account/AvatarUpload';createRoot(document.getElementById('root')).render(<AvatarUpload/>);`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', plugins: [{ name: 'mocks', setup(build) {
    build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|@\/components\/account\/AccountProvider)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'js', contents: args.path === 'convex/react' ? `export const useMutation=()=>async()=>{window.calls++;await new Promise(r=>setTimeout(r,100));if(window.fail)throw Error('failed')}` : args.path === '@cvx/_generated/api' ? `export const api={accounts:{setAvatar:'setAvatar'}}` : `export const useAccount=()=>({token:'synthetic',me:{name:'Test Renter',email:'test@example.invalid',avatarUrl:'https://example.invalid/photo'}})` }));
  } }] });
  const server = http.createServer((request, response) => request.url === '/bundle.js' ? response.end(bundle.outputFiles[0].text) : response.end('<div id="root"></div><script>window.fail=true;window.calls=0</script><script src="/bundle.js"></script>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-avatar-'));
  const chrome = spawn('/opt/google/chrome/chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { stdio: 'ignore' });
  let client;
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, 'utf8').split('\n')[0]; break; } catch { await wait(100); } } assert(port);
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; client = await connect(); await client.cmd('Runtime.enable'); await client.cmd('Page.enable'); await client.cmd('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Remove')`); attempt++) await wait(100);
    await client.evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Remove').click()`); await wait(30);
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Change profile photo"]').disabled`), true, 'photo changes are disabled during removal');
    await wait(150); assert.equal(await client.evaluate(`document.querySelector('[role="alert"]').textContent`), 'Could not remove your photo. Please try again.');
    const screenshot = await client.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/dbc-avatar-removal-error.png', Buffer.from(screenshot.data, 'base64'));
    await client.evaluate(`window.fail=false;Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Remove').click()`); await wait(150);
    assert.equal(await client.evaluate(`window.calls`), 2); assert.equal(await client.evaluate(`document.querySelector('[role="alert"]')`), null, 'a successful retry clears the error');
    console.log('PASS avatar removal error, retry, and in-flight controls in a synthetic browser.');
  } finally {
    if (client) client.close(); if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await done; } server.close(); await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
