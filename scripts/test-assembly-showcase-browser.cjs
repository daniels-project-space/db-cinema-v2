const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(root + '/scripts/test-membership-browser.cjs', 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-assembly-showcase-'));
  await require('esbuild').build({ entryPoints: [root + '/scripts/fixtures/assembly-showcase.tsx'], outfile: dir + '/fixture.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, plugins: [{ name: 'link', setup(build) {
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `import React from 'react';export default React.forwardRef(function Link({href,children,...props},ref){return <a href={href} ref={ref} {...props}>{children}</a>})`, loader: 'tsx', resolveDir: root }));
  } }] });
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js' || req.url === '/fixture.css') { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'application/javascript'); res.end(fs.readFileSync(dir + req.url)); return; }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>:root{--font-display:Arial;--font-mono:monospace}body{margin:0;background:#101114;color:white;font-family:Arial,sans-serif}#root{width:min(900px,95vw);margin:40px auto}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await connect('about:blank'); await browser.cmd('Page.enable'); await browser.cmd('Runtime.enable'); await browser.cmd('Page.bringToFront');
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
    await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    for (let count = 0; count < 120 && !(await browser.evaluate(`document.querySelector('[data-stage="2"]') !== null`)); count++) await wait(100);
    assert(await browser.evaluate(`document.querySelector('[data-stage="2"]') !== null`), 'Budget scene appears');
    const snapshot = `(()=>{const root=document.querySelector('[data-stage="2"]'), dial=root.querySelector('[role="img"]');return {label:dial?.getAttribute('aria-label'),total:dial?.innerText,needle:getComputedStyle(dial.querySelector('i')).transform,copy:root.innerText,hasSlider:!!root.querySelector('[role="slider"],input[type="range"]'),hasFakeTrack:!!root.querySelector('[style*="--budget-position"]')};})()`;
    const first = await browser.evaluate(snapshot); await wait(1850); const second = await browser.evaluate(snapshot);
    assert.equal(first.label, 'Example kit £55 per day', 'Starting example uses the actual lower daily rate');
    assert.equal(second.label, 'Example kit £180 per day', 'Higher-budget example uses the actual higher daily rate');
    assert.equal(second.total, '£180\nPER DAY', 'Displayed amount settles on the actual higher daily rate');
    assert.match(first.copy, /Example daily rates from the live catalogue/);
    assert.doesNotMatch(first.copy, /LEAN|MORE OPTIONS/);
    assert.equal(first.hasSlider, false, 'Showcase does not imply an interactive budget control');
    assert.equal(first.hasFakeTrack, false, 'Showcase has no decorative fake slider');
    assert.notEqual(first.needle, second.needle, 'Gauge needle moves');
    const screenshot = await browser.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/dbc-assembly-showcase.png', Buffer.from(screenshot.data, 'base64'));
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await wait(400); const mobile = await browser.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/dbc-assembly-showcase-mobile.png', Buffer.from(mobile.data, 'base64'));
    const dimensions = await browser.evaluate(`({body:document.body.scrollWidth,viewport:document.documentElement.clientWidth})`);
    assert(dimensions.body <= dimensions.viewport, 'Showcase does not overflow the mobile viewport');
    console.log('PASS showcase reflects live catalogue rates without a fake budget slider:', first, second, 'desktop and mobile screenshots in /tmp');
  } finally {
    if (browser) { browser.close(); await fetch((process.env.DBC_CDP_URL || 'http://localhost:9224') + '/json/close/' + browser.tabId).catch(() => {}); }
    await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
