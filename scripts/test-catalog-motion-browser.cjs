const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(root + '/scripts/test-membership-browser.cjs', 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-catalog-motion-'));
  await require('esbuild').build({ entryPoints: [root + '/scripts/fixtures/catalog-motion.tsx'], outfile: dir + '/fixture.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' } });
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(dir + '/fixture.js')); }
    if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end(fs.readFileSync(root + '/src/app/globals.css')); }
    if (/^\/(gear-loop|checkout-loop)\.(mp4|jpg)$/.test(req.url)) {
      const file = root + '/public' + req.url, size = fs.statSync(file).size, match = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      res.setHeader('Content-Type', req.url.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'); res.setHeader('Accept-Ranges', 'bytes');
      if (match) { const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : size - 1, size - 1); res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 }); return fs.createReadStream(file, { start, end }).pipe(res); }
      res.setHeader('Content-Length', size); return fs.createReadStream(file).pipe(res);
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}section{height:300px;position:relative;overflow:hidden}video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.ci-host svg{width:48px;height:48px}</style></head><body><main id="root"></main><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await connect('about:blank'); await browser.cmd('Page.enable'); await browser.cmd('Runtime.enable'); await browser.cmd('Page.bringToFront');
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    for (let count = 0; count < 100 && !(await browser.evaluate(`document.querySelectorAll('video').length===2 && [...document.querySelectorAll('video')].every(v=>v.currentTime>.15 && !v.paused)`)); count++) await wait(100);
    assert(await browser.evaluate(`document.querySelectorAll('video').length===2 && [...document.querySelectorAll('video')].every(v=>v.currentTime>.15 && !v.paused)`), 'Both real banner videos play when visible');
    for (const selector of ['.ci-spin', '.ci-lid', '.ci-pop', '.ci-leg-l']) assert.notEqual(await browser.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).animationName`), 'none', `${selector} loops without hover`);
    const screenshot = await browser.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/dbc-catalog-motion.png', Buffer.from(screenshot.data, 'base64'));
    await browser.evaluate(`document.body.insertAdjacentHTML('beforeend','<div style="height:2000px"></div>');window.scrollTo(0,document.body.scrollHeight)`); await wait(300);
    assert(await browser.evaluate(`[...document.querySelectorAll('video')].every(v=>v.paused)`), 'Offscreen banner videos pause');
    await browser.evaluate('window.scrollTo(0,0)'); await wait(300);
    assert(await browser.evaluate(`[...document.querySelectorAll('video')].every(v=>!v.paused)`), 'Visible banner videos resume');
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await wait(300);
    assert(await browser.evaluate(`[...document.querySelectorAll('video')].every(v=>!v.paused)`), 'Visible banner videos keep playing on mobile');
    const mobile = await browser.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/dbc-catalog-motion-mobile.png', Buffer.from(mobile.data, 'base64'));
    await browser.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await wait(200);
    assert(await browser.evaluate(`[...document.querySelectorAll('video')].every(v=>v.paused)`), 'Reduced motion pauses both videos');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.ci-spin')).animationName`), 'none', 'Reduced motion stops category animations');
    console.log('PASS real gear and checkout video playback, unhovered category animations and reduced-motion video pause.');
  } finally {
    if (browser) { browser.close(); await fetch((process.env.DBC_CDP_URL || 'http://localhost:9224') + '/json/close/' + browser.tabId).catch(() => {}); }
    await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
