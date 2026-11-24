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
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>:root{--font-display:Arial;--font-mono:monospace}body{margin:0;background:#101114;color:white;font-family:Arial,sans-serif}#root{width:min(1280px,95vw);margin:40px auto}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await connect('about:blank'); await browser.cmd('Page.enable'); await browser.cmd('Runtime.enable'); await browser.cmd('Page.bringToFront');
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const navigateToFreshDocument = async url => {
      const previousTimeOrigin = await browser.evaluate('performance.timeOrigin');
      await browser.cmd('Page.navigate', { url });
      for (let count = 0; count < 120; count++) {
        const state = await browser.evaluate('({timeOrigin:performance.timeOrigin,readyState:document.readyState})');
        if (state.timeOrigin !== previousTimeOrigin && state.readyState === 'complete') return;
        await wait(25);
      }
      throw new Error(`Navigation did not commit a fresh assembly fixture document: ${url}`);
    };
    await navigateToFreshDocument('http://127.0.0.1:' + server.address().port);
    for (let count = 0; count < 50 && !(await browser.evaluate(`document.querySelector('[data-stage="0"]') !== null`)); count++) await wait(100);
    const entry = await browser.evaluate(`(()=>{const card=document.querySelector('a[aria-labelledby="assembly-showcase-title"]'),heading=card?.querySelector('h3');return{scene:card?.dataset.scene,stage:card?.dataset.stage,steps:heading?.nextElementSibling?.children.length,href:card?new URL(card.href).pathname:null,copy:card?.innerText,nestedControls:card?.querySelectorAll('a,button,input,select,textarea').length}})()`);
    assert.equal(entry.scene, 'interview', 'The initial pitch starts with a concrete interview brief');
    assert.equal(entry.stage, '0', 'The first of four distinct showcase stages is active');
    assert.equal(entry.steps, 4, 'The progress indicator represents all four showcase stages');
    assert.equal(entry.href, '/assemble', 'The showcase links directly to the working kit builder');
    assert.equal(entry.nestedControls, 0, 'The full card is one accessible link without conflicting nested controls');
    assert.match(entry.copy, /Interview[\s\S]*Small crew[\s\S]*LOW LIGHT/i, 'The first pitch explains a real shoot use case');
    assert.doesNotMatch(entry.copy, /example|placeholder|demo/i, 'The visible pitch has no demo or placeholder language');
    for (let count = 0; count < 60 && !(await browser.evaluate(`document.querySelector('a[aria-labelledby="assembly-showcase-title"]')?.dataset.stage === '1'`)); count++) await wait(100);
    const needs = await browser.evaluate(`(()=>{const card=document.querySelector('a[aria-labelledby="assembly-showcase-title"]');return{stage:card?.dataset.stage,copy:card?.innerText}})()`);
    assert.equal(needs.stage, '1', 'The needs panel follows the shoot brief');
    assert.match(needs.copy, /NO LIVE MATCH\s*·\s*EXPLORE BUILDER/i, 'Unavailable needs are not falsely shown as matched');
    assert.doesNotMatch(needs.copy, /MATCHED:\s*(?:OPTICS|SOUND|LIGHT|MOVEMENT)/i);
    for (let count = 0; count < 120 && !(await browser.evaluate(`document.querySelector('[data-stage="2"]') !== null`)); count++) await wait(100);
    assert(await browser.evaluate(`document.querySelector('[data-stage="2"]') !== null`), 'Budget scene appears');
    const snapshot = `(()=>{const root=document.querySelector('[data-stage="2"]'), dial=root.querySelector('[role="img"]');return {label:dial?.getAttribute('aria-label'),total:dial?.innerText,needle:getComputedStyle(dial.querySelector('i')).transform,copy:root.innerText,hasSlider:!!root.querySelector('[role="slider"],input[type="range"]'),hasFakeTrack:!!root.querySelector('[style*="--budget-position"]')};})()`;
    const first = await browser.evaluate(snapshot); await wait(1850); const second = await browser.evaluate(snapshot);
    assert.equal(first.label, 'Kit budget: £55 per day', 'Starting build uses the actual lower daily rate');
    assert.equal(second.label, 'Kit budget: £180 per day', 'Higher-budget build uses the actual higher daily rate');
    assert.equal(second.total, '£180\nPER DAY', 'Displayed amount settles on the actual higher daily rate');
    assert.match(first.copy, /compatible items? · live daily rates/i);
    assert.doesNotMatch(first.copy, /example|placeholder/i, 'The assembly tile has no placeholder copy');
    assert.doesNotMatch(first.copy, /LEAN|MORE OPTIONS/);
    assert.equal(first.hasSlider, false, 'Showcase does not imply an interactive budget control');
    assert.equal(first.hasFakeTrack, false, 'Showcase has no decorative fake slider');
    assert.notEqual(first.needle, second.needle, 'Gauge needle moves');
    for (let count = 0; count < 50 && !(await browser.evaluate(`document.querySelector('[data-stage="3"]') !== null`)); count++) await wait(100);
    assert(await browser.evaluate(`document.querySelector('[data-stage="3"]') !== null`), 'The showcase advances into the refined kit stage');
    const refinedCopy = await browser.evaluate(`document.querySelector('[data-stage="3"]').innerText`);
    assert.match(refinedCopy, /Sony FX3 body/, 'The refined stage names a real matched catalogue listing');
    assert.match(refinedCopy, /\+£125 per day vs the balanced kit/, 'The refined stage explains the actual daily price difference');
    await wait(900);
    const screenshot = await browser.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/dbc-assembly-showcase.png', Buffer.from(screenshot.data, 'base64'));
    await browser.evaluate(`(()=>{const card=document.querySelector('a[aria-labelledby="assembly-showcase-title"]'),viewport=card.querySelector('[data-changing]');window.__assemblyFade={observed:false,opacities:[]};new MutationObserver(()=>{if(card.dataset.changing!=='true')return;window.__assemblyFade.observed=true;const sample=()=>{if(card.dataset.changing==='true')window.__assemblyFade.opacities.push(Number(getComputedStyle(viewport).opacity))};requestAnimationFrame(sample);setTimeout(sample,100);setTimeout(sample,240)}).observe(card,{attributes:true,attributeFilter:['data-changing']})})()`);
    for (let count = 0; count < 70 && (await browser.evaluate(`document.querySelector('a[aria-labelledby="assembly-showcase-title"]')?.dataset.scene`)) === entry.scene; count++) await wait(100);
    const nextBrief = await browser.evaluate(`(()=>{const card=document.querySelector('a[aria-labelledby="assembly-showcase-title"]');return{scene:card?.dataset.scene,stage:card?.dataset.stage,copy:card?.innerText}})()`);
    assert.equal(nextBrief.scene, 'commercial', 'The pitch advances to the next shoot instead of sticking on one scene');
    assert.equal(nextBrief.stage, '0', 'A new shoot starts cleanly at the brief stage');
    assert.match(nextBrief.copy, /Studio commercial[\s\S]*Large production[\s\S]*PRODUCT SHOTS/i, 'The next pitch names its crew and practical requirements');
    assert.doesNotMatch(nextBrief.copy, /example|placeholder|demo/i, 'The rotating pitch remains free of demo language');
    await wait(500);
    const fade = await browser.evaluate(`(()=>{const viewport=document.querySelector('a[aria-labelledby="assembly-showcase-title"] [data-changing]');return{observed:window.__assemblyFade.observed,minOpacity:Math.min(...window.__assemblyFade.opacities),restoredOpacity:Number(getComputedStyle(viewport).opacity)}})()`);
    assert(fade.observed && fade.minOpacity < 0.95, `Scene changes visibly fade instead of snapping: ${JSON.stringify(fade)}`);
    assert(fade.restoredOpacity > 0.95, `The incoming scene fades back to full visibility: ${JSON.stringify(fade)}`);
    for (let count = 0; count < 20 && await browser.evaluate(`document.querySelector('a[aria-labelledby="assembly-showcase-title"]')?.dataset.changing === 'true'`); count++) await wait(50);
    await wait(900);
    fs.writeFileSync('/tmp/dbc-assembly-showcase-next-brief.png', Buffer.from((await browser.cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await browser.evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))`);
    await wait(60);
    for (const [width, height] of [[320, 640], [390, 844], [768, 900], [1440, 900]]) {
      await browser.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      await wait(80);
      const layout = await browser.evaluate(`(()=>{const card=document.querySelector('a[aria-labelledby="assembly-showcase-title"]').getBoundingClientRect();return {body:document.body.scrollWidth,viewport:document.documentElement.clientWidth,card:{left:card.left,right:card.right,width:card.width,height:card.height}}})()`);
      assert(layout.body <= layout.viewport, `Showcase has no horizontal overflow at ${width}px`);
      assert(layout.card.left >= 0 && layout.card.right <= width, `Showcase card fits at ${width}px`);
      assert.equal(await browser.evaluate(`new URL(document.querySelector('a[aria-labelledby="assembly-showcase-title"]').href).pathname`), '/assemble', `Builder link remains available at ${width}px`);
      if (width <= 430) {
        assert(layout.card.height < 260, `Mobile showcase has no oversized empty area at ${width}px`);
        const typography = await browser.evaluate(`(()=>{const stage=document.querySelector('[data-stage="0"]'),details=stage.querySelector('strong').parentElement,crew=details.querySelector('strong+div'),notes=details.querySelector('p'),builder=[...document.querySelectorAll('a[aria-labelledby="assembly-showcase-title"] span')].find(node=>node.textContent.includes('Explore the builder'));return{crew:parseFloat(getComputedStyle(crew).fontSize),notes:parseFloat(getComputedStyle(notes).fontSize),builder:parseFloat(getComputedStyle(builder).fontSize),notesWidth:notes.scrollWidth,available:details.clientWidth,crewRight:crew.querySelector('span').getBoundingClientRect().right,stageRight:stage.getBoundingClientRect().right,notesBottom:notes.getBoundingClientRect().bottom,stageBottom:stage.getBoundingClientRect().bottom}})()`);
        assert(typography.crew>=11&&typography.notes>=10&&typography.builder>=10, `Mobile pitch details remain readable at ${width}px: ${JSON.stringify(typography)}`);
        assert(typography.notesWidth<=typography.available+1, `Mobile shoot notes remain inside the pitch at ${width}px: ${JSON.stringify(typography)}`);
        assert(typography.crewRight<=typography.stageRight+1&&typography.notesBottom<=typography.stageBottom+1, `Mobile brief copy remains visible at ${width}px: ${JSON.stringify(typography)}`);
      }
      const shot = await browser.cmd('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`/tmp/dbc-assembly-showcase-${width}x${height}.png`, Buffer.from(shot.data, 'base64'));
      console.log(`Showcase ${width}x${height}:`, layout);
    }
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
    await browser.evaluate(`document.querySelector('a[aria-labelledby="assembly-showcase-title"]').click()`);
    for (let count = 0; count < 100 && await browser.evaluate(`location.pathname !== '/assemble'`); count++) await wait(50);
    assert.equal(await browser.evaluate('location.pathname'), '/assemble', 'Tapping the showcase navigates to the assembly builder on a phone');
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
    await navigateToFreshDocument('http://127.0.0.1:' + server.address().port + '/?empty=1');
    for (let count = 0; count < 70 && !(await browser.evaluate(`document.querySelector('[data-stage="1"]') !== null`)); count++) await wait(100);
    assert(await browser.evaluate(`document.querySelector('[data-stage="1"]') !== null`), 'Showcase rotates even when the catalogue has no eligible gear');
    const emptyCopy = await browser.evaluate(`document.querySelector('a[aria-labelledby="assembly-showcase-title"]').innerText`);
    assert.match(emptyCopy, /NO LIVE MATCH\s*·\s*EXPLORE BUILDER/i, 'The empty state does not claim missing gear has matched');
    assert.doesNotMatch(emptyCopy, /MATCHING:/i, 'Unavailable preferences are not presented as fulfilled matches');
    assert.doesNotMatch(emptyCopy, /example|placeholder|demo/i, 'The empty catalogue fallback does not expose demo language');
    for (let count = 0; count < 20 && await browser.evaluate(`document.querySelector('a[aria-labelledby="assembly-showcase-title"]')?.dataset.changing === 'true'`); count++) await wait(50);
    await wait(900);
    fs.writeFileSync('/tmp/dbc-assembly-showcase-empty-catalog.png', Buffer.from((await browser.cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await navigateToFreshDocument('http://127.0.0.1:' + server.address().port + '/?loading=1');
    for (let count = 0; count < 50 && !(await browser.evaluate(`document.querySelector('[data-stage="0"]') !== null`)); count++) await wait(100);
    await wait(4700);
    const loadingState = await browser.evaluate(`(()=>{const card=document.querySelector('a[aria-labelledby="assembly-showcase-title"]');return{stage:card?.dataset.stage,scene:card?.dataset.scene,loading:card?.dataset.loading,moving:card?.dataset.moving}})()`);
    assert.deepEqual(loadingState, { stage: '0', scene: 'interview', loading: 'true', moving: 'false' }, 'A slow catalogue load does not rotate through misleading empty results');
    await browser.evaluate('window.__setAssemblyLoading(false)');
    for (let count = 0; count < 70 && !(await browser.evaluate(`document.querySelector('a[aria-labelledby="assembly-showcase-title"]').dataset.stage === '1'`)); count++) await wait(100);
    assert.equal(await browser.evaluate(`document.querySelector('a[aria-labelledby="assembly-showcase-title"]').dataset.stage`), '1', 'The showcase resumes rotating once live catalogue data is ready');
    console.log('PASS showcase keeps four truthful stages, reflects catalogue rates, fades across use cases, and fits 320/390/768/1440px');
  } finally {
    if (browser) { browser.close(); await fetch((process.env.DBC_CDP_URL || 'http://localhost:9224') + '/json/close/' + browser.tabId).catch(() => {}); }
    await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
