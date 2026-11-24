const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const esbuild = require('esbuild');
const source = fs.readFileSync('scripts/test-membership-browser.cjs', 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + '\nreturn connect;')(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const bundle = await esbuild.build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {useVerificationRefresh} from './src/components/rentals/useVerificationRefresh';function App(){const [id,setId]=useState('first');window.selectRental=setId;const error=useVerificationRefresh(id,'token',null,true,true,true);return <output>{id}:{String(error)}</output>}createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, plugins: [{ name: 'fixture', setup(build) {
    build.onResolve({ filter: /^convex\/react$|_generated\/api$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'convex/react' ? `const refresh=args=>{window.calls.push(args);return new Promise((resolve,reject)=>{window.pending[args.bookingId]={resolve,reject}})};export const useAction=()=>refresh;` : `export const api={didit:{refreshProgress:'refresh'}};` }));
  } }] });
  const server = http.createServer((request, response) => { if (request.url === '/bundle.js') { response.setHeader('content-type', 'text/javascript'); return response.end(bundle.outputFiles[0].text); } response.end('<div id="root"></div><script>window.calls=[];window.pending={}</script><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-refresh-scope-'));
  const chrome = spawn('/opt/google/chrome/chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${temporary}`], { stdio: 'ignore' });
  let client;
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${temporary}/DevToolsActivePort`, 'utf8').split('\n')[0]; break; } catch { await wait(100); } }
    assert(port); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; client = await connect(); await client.cmd('Page.enable');
    await client.cmd('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt=0; attempt<100 && !await client.evaluate('window.calls?.length===1'); attempt++) await wait(50);
    await client.evaluate(`window.selectRental('second')`);
    for (let attempt=0; attempt<100 && !await client.evaluate('window.calls.length===2'); attempt++) await wait(50);
    assert.deepEqual(await client.evaluate('window.calls.map(call=>call.bookingId)'), ['first','second'], 'a slow old rental never delays the selected rental');
    await client.evaluate(`window.selectRental('first')`); await wait(50);
    assert.equal(await client.evaluate('window.calls.length'), 2, 'returning to the same rental reuses the existing request');
    await client.evaluate(`window.selectRental('second')`); await wait(50);
    await client.evaluate(`window.pending.first.reject(new Error('stale'))`); await wait(30);
    assert.equal(await client.evaluate('document.querySelector("output").textContent'), 'second:false', 'an old completion does not change the selected rental');
    await client.evaluate(`window.pending.second.resolve({status:'updated'})`); await wait(50);
    assert.equal(await client.evaluate('window.calls.length'), 2, 'a shared pending request is not duplicated');
    console.log('PASS verification refresh: selected-rental scope, in-flight reuse, stale result isolation. Synthetic browser only.');
  } finally { if (client) client.close(); if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill(); await new Promise(resolve => chrome.once('exit', resolve)); } server.close(); fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
