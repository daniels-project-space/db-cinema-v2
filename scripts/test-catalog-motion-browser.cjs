const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const postcss = require('postcss');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(root + '/scripts/test-membership-browser.cjs', 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-catalog-motion-'));
  await require('esbuild').build({ entryPoints: [root + '/scripts/fixtures/catalog-motion.tsx'], outfile: dir + '/fixture.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' } });
  const css = await postcss([require('@tailwindcss/postcss')({ base: root })])
    .process(fs.readFileSync(root + '/src/app/globals.css', 'utf8'), { from: root + '/src/app/globals.css' });
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(dir + '/fixture.js')); }
    if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css.css); }
    if (/^\/(gear-loop|gear-loop-mobile|checkout-loop)\.(mp4|jpg)$/.test(req.url)) {
      const file = root + '/public' + req.url, size = fs.statSync(file).size, match = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      res.setHeader('Content-Type', req.url.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'); res.setHeader('Accept-Ranges', 'bytes');
      if (match) { const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : size - 1, size - 1); res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 }); return fs.createReadStream(file, { start, end }).pipe(res); }
      res.setHeader('Content-Length', size); return fs.createReadStream(file).pipe(res);
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}.ci-host svg{width:48px;height:48px}</style></head><body><main id="root"></main><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await connect('about:blank'); await browser.cmd('Page.enable'); await browser.cmd('Runtime.enable'); await browser.cmd('Page.bringToFront');
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
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
    for (const width of [320,390,430]) {
      await browser.cmd('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); await wait(300);
      assert(await browser.evaluate(`[...document.querySelectorAll('video')].every(v=>!v.paused)`), `Visible banner videos keep playing at ${width}px`);
      assert(await browser.evaluate(`document.querySelectorAll('video')[0].autoplay`), `The mobile gear film advertises native autoplay at ${width}px`);
      assert(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth`), `The gear and checkout banners fit ${width}px without horizontal overflow`);
      assert(await browser.evaluate(`document.querySelectorAll('video')[0].currentSrc.endsWith('/gear-loop-mobile.mp4')`), `The phone-sized gear source is selected at ${width}px`);
      if(width===390){const mobile = await browser.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/dbc-catalog-motion-mobile.png', Buffer.from(mobile.data, 'base64'));}
    }
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await wait(100);
    await browser.evaluate(`(() => {
      const row = document.createElement('div'); row.className = 'hygglo-review-marquee'; row.style.width = '280px';
      const track = document.createElement('div'); track.className = 'hygglo-review-track'; track.style.setProperty('--review-speed', '64s');
      for (let groupIndex = 0; groupIndex < 2; groupIndex++) {
        const group = document.createElement('div'); group.className = 'hygglo-review-group';
        if (groupIndex) group.setAttribute('aria-hidden', 'true');
        for (let card = 0; card < 8; card++) { const item = document.createElement('figure'); item.style.cssText = 'width:160px;height:100px;flex:none'; item.textContent = 'Review'; group.append(item); }
        track.append(group);
      }
      row.append(track); document.body.append(row);
    })()`);
    const normalTickerBefore = await browser.evaluate(`(() => { const t=document.querySelector('.hygglo-review-track');return {name:getComputedStyle(t).animationName,state:getComputedStyle(t).animationPlayState,x:new DOMMatrix(getComputedStyle(t).transform).m41}; })()`);
    await wait(900);
    const normalTickerAfter = await browser.evaluate(`new DOMMatrix(getComputedStyle(document.querySelector('.hygglo-review-track')).transform).m41`);
    assert.equal(normalTickerBefore.name, 'hygglo-marquee-x', 'The review rail animation is installed without reduced motion');
    assert.equal(normalTickerBefore.state, 'running', 'The review rail runs without hover');
    assert(normalTickerAfter < normalTickerBefore.x, 'The review rail moves on mobile without reduced motion');
    await browser.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await wait(300);
    assert(await browser.evaluate(`document.querySelectorAll('video')[0].currentTime>.15 && !document.querySelectorAll('video')[0].paused`), 'The requested gear film continues playing on mobile');
    assert(await browser.evaluate(`document.querySelectorAll('video')[1].paused`), 'Checkout film respects reduced motion unless explicitly requested');
    assert(await browser.evaluate(`document.querySelectorAll('video')[0].currentSrc.endsWith('/gear-loop-mobile.mp4')`), 'The mobile gear video source is selected');
    const tickerBefore = await browser.evaluate(`(() => { const t=document.querySelector('.hygglo-review-track');return {name:getComputedStyle(t).animationName,state:getComputedStyle(t).animationPlayState,duration:getComputedStyle(t).animationDuration,x:new DOMMatrix(getComputedStyle(t).transform).m41}; })()`);
    await wait(900);
    const tickerAfter = await browser.evaluate(`(() => { const t=document.querySelector('.hygglo-review-track');return {name:getComputedStyle(t).animationName,state:getComputedStyle(t).animationPlayState,duration:getComputedStyle(t).animationDuration,x:new DOMMatrix(getComputedStyle(t).transform).m41}; })()`);
    assert.equal(tickerBefore.name, 'hygglo-marquee-x', 'Reduced-motion mobile keeps the review marquee animation');
    assert.equal(tickerBefore.state, 'running', 'The review marquee starts moving');
    assert.equal(tickerBefore.duration, '64s', 'A synthetic short mobile review rail keeps a calm, visible pace');
    assert(tickerAfter.x < tickerBefore.x, 'The lower review carousel visibly moves on mobile');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.ci-spin')).animationName`), 'none', 'Reduced motion stops category animations');
    console.log('PASS real banner playback, mobile gear source, reduced-motion behavior, and unhovered category animations.');
  } finally {
    if (browser) { browser.close(); await fetch((process.env.DBC_CDP_URL || 'http://localhost:9224') + '/json/close/' + browser.tabId).catch(() => {}); }
    await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
