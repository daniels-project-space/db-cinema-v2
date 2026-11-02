const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(root + '/scripts/test-membership-browser.cjs', 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-revision-guard-'));
  await require('esbuild').build({ entryPoints: [root + '/scripts/fixtures/catalog-revision-guard.tsx'], outfile: dir + '/fixture.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, plugins: [{ name: 'fixture', setup(build) {
    build.onResolve({ filter: /^(convex\/react|next\/navigation|@cvx\/_generated\/api)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'convex/react'
      ? `import {useSyncExternalStore} from 'react';let revision='v1:0',listeners=new Set();window.fixture={refreshes:0,setRevision(value){revision=value;listeners.forEach(fn=>fn())}};export function useQuery(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>revision,()=>revision)}`
      : args.path === 'next/navigation' ? `export function useRouter(){return {refresh(){window.fixture.refreshes++}}}` : `export const api={catalog:{publicRevision:{}}}`, loader: 'tsx', resolveDir: root }));
  } }] });
  const server = http.createServer((request, response) => { if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(fs.readFileSync(dir + '/fixture.js')); } else { response.setHeader('Content-Type', 'text/html'); response.end('<div id="root"></div><script src="/fixture.js"></script>'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await connect('about:blank'); await browser.cmd('Page.enable'); await browser.cmd('Runtime.enable');
    await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    for (let attempt = 0; attempt < 100 && !(await browser.evaluate(`!!window.fixture?.finishRefresh`)); attempt++) await wait(50);
    assert(await browser.evaluate(`!!window.fixture?.finishRefresh`));
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('#root > div')).visibility`), 'visible');
    await browser.evaluate(`document.querySelector('input').value='Sony FX3';document.querySelector('#root > div > div').scrollTop=120;window.scrollTo(0,500)`);
    await browser.evaluate(`window.fixture.setRevision('v1:1')`);
    await wait(50); await browser.evaluate(`window.fixture.setRevision('v1:2')`);
    await wait(50); await browser.evaluate(`window.fixture.setRevision('v1:3')`);
    for (let attempt = 0; attempt < 100 && !(await browser.evaluate(`window.fixture.refreshes>0`)); attempt++) await wait(50);
    assert(await browser.evaluate(`window.fixture.refreshes>0`), 'Live changes request a fresh server render');
    assert.equal(await browser.evaluate(`document.querySelector('#root > div').inert`), true, 'Stale public listings cannot be interacted with');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('#root > div')).visibility`), 'hidden', 'Stale content is not visible');
    assert.equal(await browser.evaluate(`window.scrollY`), 500, 'Hiding stale content keeps the page layout and scroll position');
    await browser.evaluate(`window.fixture.rerender()`); await wait(600);
    assert.equal(await browser.evaluate(`window.fixture.refreshes`), 1, 'A burst coalesces to one refresh and unrelated rerenders cannot cause a loop');
    await browser.evaluate(`window.fixture.setRevision('v1:4')`);
    await wait(1000); assert.equal(await browser.evaluate(`window.fixture.refreshes`), 1, 'Rapid changes are throttled');
    for (let attempt = 0; attempt < 140 && (await browser.evaluate(`window.fixture.refreshes`)) < 2; attempt++) await wait(50);
    assert.equal(await browser.evaluate(`window.fixture.refreshes`), 2, 'A later revision schedules one bounded additional refresh');
    await browser.evaluate(`window.fixture.finishRefresh('v1:4')`); await wait(100);
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('#root > div')).visibility`), 'visible', 'Refreshed listings become visible again');
    assert.equal(await browser.evaluate(`document.querySelector('input').value`), 'Sony FX3', 'In-progress search input is preserved');
    assert.equal(await browser.evaluate(`document.querySelector('#root > div > div').scrollTop`), 120, 'Existing scroll position is preserved');
    console.log('PASS real React revision guard: stale content hidden until refreshed');
  } finally {
    if (browser) { browser.close(); await fetch((process.env.DBC_CDP_URL || 'http://localhost:9224') + '/json/close/' + browser.tabId, { signal: AbortSignal.timeout(3000) }).catch(() => {}); }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
