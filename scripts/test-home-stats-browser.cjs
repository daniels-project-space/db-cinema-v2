const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const membershipSource = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', membershipSource.slice(0, membershipSource.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-home-stats-'));
  const pageSource = fs.readFileSync(path.join(root, 'src/app/page.tsx'), 'utf8');
  const heroSource = fs.readFileSync(path.join(root, 'src/components/HeroCinematic.tsx'), 'utf8');
  const reviewsSection = pageSource.indexOf('id="reviews"');
  const reviewCarousel = pageSource.indexOf('<ReviewCarousel');
  const statsComponent = pageSource.indexOf('<HomeStats');
  assert(reviewsSection >= 0 && reviewCarousel > reviewsSection && statsComponent > reviewCarousel,
    'Review stats remain below the carousel inside the reviews section');
  assert(!heroSource.includes('1,300+') && !/renter reviews/i.test(heroSource),
    'The hero no longer duplicates the review figure');

  await require('esbuild').build({
    entryPoints: [path.join(__dirname, 'fixtures/home-stats.tsx')],
    outfile: path.join(dir, 'fixture.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    tsconfig: path.join(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root })])
    .process(fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'), { from: path.join(root, 'src/app/globals.css') });
  fs.writeFileSync(path.join(dir, 'fixture.css'), css.css);

  const server = http.createServer((request, response) => {
    if (request.url === '/fixture.js') {
      response.setHeader('Content-Type', 'application/javascript');
      return response.end(fs.readFileSync(path.join(dir, 'fixture.js')));
    }
    if (request.url === '/fixture.css') {
      response.setHeader('Content-Type', 'text/css');
      return response.end(fs.readFileSync(path.join(dir, 'fixture.css')));
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#08080a}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  let browser;
  try {
    browser = await connect('about:blank');
    await browser.cmd('Page.enable');
    await browser.cmd('Runtime.enable');
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await browser.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await browser.cmd('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
    for (let attempt = 0; attempt < 80 && !(await browser.evaluate("!!document.querySelector('[aria-label=\"Rental and review figures\"]')")); attempt++) await delay(100);
    const selector = '[aria-label="Rental and review figures"]';
    assert(await browser.evaluate(`!!document.querySelector('${selector}')`), 'Stats render');
    assert.equal(await browser.evaluate(`document.querySelectorAll('${selector} [aria-hidden="true"]').length`), 3, 'All three figures render');
    await browser.evaluate(`document.documentElement.style.scrollBehavior='auto';document.querySelector('${selector}').scrollIntoView({block:'center',behavior:'instant'})`);

    const samples = [];
    for (let index = 0; index < 18; index++) {
      samples.push(await browser.evaluate(`Array.from(document.querySelectorAll('${selector} [aria-hidden="true"]')).map(item=>item.textContent)`));
      await delay(110);
    }
    assert(new Set(samples.map(sample => sample[1])).size > 2, 'Review count visibly counts upward');
    assert.deepEqual(samples.at(-1), ['4.73', '1,300+', '175'], 'Final values match the approved site figures');
    assert(await browser.evaluate(`Array.from(document.querySelectorAll('${selector} .sr-only')).map(item=>item.textContent).join('|') === '4.73|1,300+|175'`), 'Accessible final values are present without visual duplication');
    const screenshot = await browser.cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync('/tmp/dbc-home-stats-390.png', Buffer.from(screenshot.data, 'base64'));
    console.log('PASS: review figures stay below the carousel, the hero has no duplicate, and the 4.73 / 1,300+ / 175 count-up renders accessibly.');
  } finally {
    if (browser) {
      browser.close();
      await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${browser.tabId}`).catch(() => {});
    }
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
