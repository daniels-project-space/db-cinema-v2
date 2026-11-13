const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(root + '/scripts/test-membership-browser.cjs', 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-mobile-landing-'));
  const mockPlugin = {
    name: 'mobile-landing-fixture-mocks',
    setup(build) {
      build.onResolve({ filter: /^next\/(link|image)$/ }, args => ({ path: args.path.split('/')[1], namespace: 'mobile-fixture' }));
      build.onResolve({ filter: /@\/components\/GafferCall$/ }, () => ({ path: 'gaffer-call', namespace: 'mobile-fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'mobile-fixture' }, args => ({
        loader: 'jsx',
        resolveDir: root,
        contents: args.path === 'link'
          ? 'import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }'
          : args.path === 'image'
            ? 'import React from "react"; export default function Image(props) { return React.createElement("img", props); }'
            : 'import React from "react"; export function GafferCall({ label = "Call us", className = "" }) { return React.createElement("button", { type: "button", className }, label); }',
      }));
    },
  };
  await require('esbuild').build({
    entryPoints: [root + '/scripts/fixtures/mobile-landing.tsx'],
    outfile: dir + '/fixture.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    tsconfig: root + '/tsconfig.json',
    plugins: [mockPlugin],
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root })])
    .process(fs.readFileSync(root + '/src/app/globals.css', 'utf8'), { from: root + '/src/app/globals.css' });
  fs.writeFileSync(dir + '/fixture.css', css.css);

  const media = new Set([
    'intro.mp4', 'intro-mobile.mp4', 'intro2.mp4', 'intro2-mobile.mp4', 'loop.mp4', 'loop-mobile.mp4',
    'intro-poster.jpg', 'intro2-poster.jpg', 'loop-poster.jpg',
  ]);
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(dir + '/fixture.js')); }
    if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end(fs.readFileSync(dir + '/fixture.css')); }
    const name = decodeURIComponent((req.url || '').slice(1));
    if (media.has(name)) {
      const file = root + '/public/' + name, size = fs.statSync(file).size;
      res.setHeader('Content-Type', name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
      if (name.endsWith('.mp4')) res.setHeader('Accept-Ranges', 'bytes');
      const match = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      if (match && name.endsWith('.mp4')) {
        const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : size - 1, size - 1);
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.setHeader('Content-Length', size);
      return fs.createReadStream(file).pipe(res);
    }
    res.setHeader('Content-Type', 'text/html');
    const blockScript = new URL(req.url || '/', 'http://fixture.local').searchParams.has('block-video')
      ? `<script>window.__allowLandingVideo=false;window.__nativeLandingPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(!window.__allowLandingVideo){const error=new Error('Autoplay blocked by test');error.name='NotAllowedError';return Promise.reject(error)}return window.__nativeLandingPlay.apply(this,arguments)};const auto=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'autoplay');Object.defineProperty(HTMLMediaElement.prototype,'autoplay',{configurable:true,get(){return false},set(value){if(!value&&auto?.set)auto.set.call(this,false)}});const set=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){if(name.toLowerCase()==='autoplay'&&this instanceof HTMLMediaElement)return;return set.call(this,name,value)}</script>`
      : '';
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#08080a}</style></head><body><div id="root"></div>${blockScript}<script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await connect('about:blank');
    await browser.cmd('Page.enable'); await browser.cmd('Runtime.enable'); await browser.cmd('Page.bringToFront');
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await browser.cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
    await browser.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const layouts=[];
    for (const [width,height] of [[320,640],[390,844],[430,932],[768,900],[1024,844],[1440,844]]) {
      const mobileViewport = width < 768;
      const compactVideoSource = width <= 768;
      await browser.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobileViewport ? 3 : 1, mobile: mobileViewport }); await wait(100);
      await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port }); await wait(100);
      for (let count = 0; count < 90 && !(await browser.evaluate(`(() => {const v=document.querySelector('video');return v && v.currentTime > .35 && !v.paused})()`)); count++) await wait(100);
      for (let count = 0; count < 40 && !(await browser.evaluate(`(()=>{const e=[...document.querySelectorAll('a,button')].find(node=>node.textContent.includes('Book rental gear'));return e&&Number(getComputedStyle(e.parentElement).opacity)>=.98})()`)); count++) await wait(100);
      const layout = await browser.evaluate(`(() => {
      const box = selector => { const e=document.querySelector(selector); if(!e)return null; const r=e.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height}; };
      const hero=document.querySelector('[data-testid="mobile-landing-hero"]')?.getBoundingClientRect();
      const videos=[...document.querySelectorAll('video')];
      const reviewCard=document.querySelector('[data-testid="hygglo-review-card"]');
      const reviewCardRect=reviewCard?.getBoundingClientRect();
      const reviewTextRect=reviewCard?.querySelector('.hygglo-review-quote')?.getBoundingClientRect();
      const callouts=document.querySelector('[data-testid="hero-gear-callouts"]');
      const gearCalloutsVisible=!!callouts&&getComputedStyle(callouts).display!=='none'&&getComputedStyle(callouts).visibility!=='hidden';
      const legacyNavProbe=document.createElement('nav');legacyNavProbe.className='hero-mobile-category-nav';document.body.appendChild(legacyNavProbe);const legacyNavDisplay=getComputedStyle(legacyNavProbe).display;legacyNavProbe.remove();
      const calloutText=callouts?.textContent?.toUpperCase()??'';
      const extraCategories=!!document.querySelector('[data-testid="hero-mobile-callouts"], [data-testid="hero-mobile-category-nav"]');
      const heroReviewSummary=!!document.querySelector('[data-testid="mobile-landing-hero"] [aria-label*="renter reviews"]')||!!document.querySelector('[data-testid="mobile-landing-hero"]')?.textContent.includes('1,300+');
      const heroActions=['Book rental gear','How it works','Call us'].map(label=>{const e=[...document.querySelectorAll('a,button')].find(node=>node.textContent.includes(label));if(!e)return{label,found:false};const r=e.getBoundingClientRect();return{label,found:true,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,groupOpacity:Number(getComputedStyle(e.parentElement).opacity),insideHero:!!hero&&r.left>=hero.left&&r.right<=hero.right&&r.top>=hero.top&&r.bottom<=hero.bottom}});
      const activeVideo=videos.find(video=>Number(getComputedStyle(video).opacity)>=.98)??videos[0];
      return { width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,hero:box('[data-testid="mobile-landing-hero"]'), next:box('[data-testid="mobile-next-section"]'), gearCalloutsVisible,legacyNavDisplay,calloutText,extraCategories,heroReviewSummary, heroActions, rows:document.querySelectorAll('[data-testid="hygglo-review-row"]').length,
        reviewCard:reviewCardRect&&{left:reviewCardRect.left,right:reviewCardRect.right,width:reviewCardRect.width,center:(reviewCardRect.left+reviewCardRect.right)/2,textLeft:reviewTextRect?.left,textRight:reviewTextRect?.right},
        video:activeVideo&&{src:activeVideo.currentSrc,paused:activeVideo.paused,time:activeVideo.currentTime,readyState:activeVideo.readyState,muted:activeVideo.muted,inline:activeVideo.playsInline} };
      })()`);
      assert.equal(layout.overflow,false,`The mobile landing fits ${width}px without page overflow: ${JSON.stringify(layout)}`);
      assert(layout.hero && layout.next && layout.hero.bottom <= layout.next.top + 1, `The next section starts after the clipped hero video at ${width}px`);
      assert.equal(layout.extraCategories, false, `No extra category labels or bubble row is added at ${width}px`);
      if (width < 768) assert.equal(layout.legacyNavDisplay, 'none', `The previous mobile category overlay stays hidden at ${width}px`);
      assert.equal(layout.heroReviewSummary,false,`Review totals appear below the carousel, not in the hero at ${width}px`);
      assert.equal(layout.gearCalloutsVisible, width >= 1024, `The gear callouts stay hidden on phone/tablet widths and return on a wide desktop layout (${width}px)`);
      if(width<1024) assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid="hero-gear-callouts"]')).display`),"none",`The Cameras/Lenses/Lighting/Audio SVG overlay is not displayed below 1024px (${width}px)`);
      if(width>=1024) assert(["CAMERAS","LENSES","LIGHTING","AUDIO"].every(label=>layout.calloutText.includes(label)),`Desktop preserves all four gear callout labels at ${width}px: ${layout.calloutText}`);
      assert(layout.heroActions.every(action=>action.found), `The same three hero actions remain available at ${width}px`);
      assert(layout.heroActions.every(action=>action.width>0&&action.height>0&&action.insideHero&&action.groupOpacity>=0.98), `All hero actions finish fading in with visible boxes inside the hero at ${width}px: ${JSON.stringify(layout.heroActions)}`);
      if (width < 1024) assert(layout.heroActions.every(action=>Math.round(action.height)>=44), `Touch targets are at least 44px tall without leaving the hero at ${width}px: ${JSON.stringify(layout.heroActions)}`);
      assert.equal(layout.rows, 1, `A one-review feed still renders a moving review rail at ${width}px`);
      assert(layout.reviewCard && layout.reviewCard.left >= 0 && layout.reviewCard.right <= width, `A complete review card fits inside the ${width}px review rail: ${JSON.stringify(layout.reviewCard)}`);
      assert(layout.reviewCard.textLeft >= layout.reviewCard.left && layout.reviewCard.textRight <= layout.reviewCard.right, `Review text remains inside its full card at ${width}px: ${JSON.stringify(layout.reviewCard)}`);
      if (width <= 430) assert(Math.abs(layout.reviewCard.center - width / 2) <= 4, `The initial mobile card is centered at ${width}px: ${JSON.stringify(layout.reviewCard)}`);
      assert(layout.video && !layout.video.paused && layout.video.time > 0.35 && layout.video.muted && layout.video.inline, `The muted landing film plays inline at ${width}px`);
      assert(/\/(?:intro|intro2|loop)(?:-mobile)?\.mp4$/.test(layout.video.src), `An expected cinematic clip is active at ${width}px: ${layout.video.src}`);
      assert.equal(layout.video.src.endsWith('-mobile.mp4'), compactVideoSource, `The appropriate landing source is selected at ${width}px: ${layout.video.src}`);
      layouts.push(layout);
      const responsiveScreenshot = await browser.cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(`/tmp/dbcinema-mobile-landing-${width}x${height}.png`, Buffer.from(responsiveScreenshot.data, 'base64'));
      if (width <= 430) {
        await browser.evaluate(`document.querySelector('[data-testid="hygglo-review-row"]').scrollIntoView({block:'center'})`);
        await wait(120);
        const centeredReview = await browser.evaluate(`(() => {const r=document.querySelector('[data-testid="hygglo-review-card"]').getBoundingClientRect();return{left:r.left,right:r.right,center:(r.left+r.right)/2}})()`);
        assert(centeredReview.left >= 0 && centeredReview.right <= width, `The scrolled-to review screenshot shows a complete card while it moves at ${width}px: ${JSON.stringify(centeredReview)}`);
        const reviewScreenshot = await browser.cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(`/tmp/dbcinema-mobile-reviews-${width}x${height}.png`, Buffer.from(reviewScreenshot.data, 'base64'));
        await browser.evaluate('scrollTo(0,0)');
      }
    }
    const layout=layouts.find(item=>item.width===390);
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }); await wait(100);
    await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port }); await wait(100);
    for (let count = 0; count < 90 && !(await browser.evaluate(`(() => {const v=document.querySelector('video');return v && v.currentTime > .35 && !v.paused})()`)); count++) await wait(100);

    const trackBefore = await browser.evaluate(`(() => {const e=document.querySelector('.hygglo-review-track');return {name:getComputedStyle(e).animationName,state:getComputedStyle(e).animationPlayState,duration:getComputedStyle(e).animationDuration,x:new DOMMatrix(getComputedStyle(e).transform).m41}})()`);
    await wait(1000);
    const trackAfter = await browser.evaluate(`new DOMMatrix(getComputedStyle(document.querySelector('.hygglo-review-track')).transform).m41`);
    assert.equal(trackBefore.name, 'hygglo-marquee-x');
    assert.equal(trackBefore.state, 'running');
    assert.equal(trackBefore.duration, '64s');
    assert(trackAfter < trackBefore.x - 3, 'The actual single-review row visibly moves on mobile');

    await browser.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reducedBefore = await browser.evaluate(`(() => {const e=document.querySelector('.hygglo-review-track');return {state:getComputedStyle(e).animationPlayState,x:new DOMMatrix(getComputedStyle(e).transform).m41}})()`);
    await wait(1000);
    const reducedAfter = await browser.evaluate(`new DOMMatrix(getComputedStyle(document.querySelector('.hygglo-review-track')).transform).m41`);
    assert.equal(reducedBefore.state, 'running');
    assert(reducedAfter < reducedBefore.x - 3, 'The user-requested review rail still moves when reduced motion is enabled');

    const screenshot = await browser.cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync('/tmp/dbcinema-mobile-landing-final.png', Buffer.from(screenshot.data, 'base64'));
    await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/?many' });
    for (let count = 0; count < 80 && !(await browser.evaluate(`document.querySelectorAll('[data-testid="hygglo-review-row"]').length===3`)); count++) await wait(50);
    const fullFeed = await browser.evaluate(`(() => [...document.querySelectorAll('[data-testid="hygglo-review-row"]')].map(row=>{
      const cards=row.querySelector('.hygglo-review-group:not([aria-hidden])')?.querySelectorAll('[data-testid="hygglo-review-card"]').length;
      const visibleCard=[...row.querySelectorAll('[data-testid="hygglo-review-card"]')].map(card=>card.getBoundingClientRect()).find(rect=>rect.left>=0&&rect.right<=innerWidth);
      return{cards,duration:getComputedStyle(row.querySelector('.hygglo-review-track')).animationDuration,card:visibleCard&&{left:visibleCard.left,right:visibleCard.right,center:(visibleCard.left+visibleCard.right)/2}};
    }))()`);
    assert.equal(fullFeed.length, 3, 'The full 100-review synthetic feed renders three populated rails');
    assert.deepEqual(fullFeed.map(row => row.cards), [34, 33, 33], 'All 100 entries are distributed across the review rows');
    assert.deepEqual(fullFeed.map(row => row.duration), ['116s', '112s', '112s'], 'Long review rails slow proportionally so cards remain readable');
    assert(fullFeed.every(row => row.card && row.card.left >= 0 && row.card.right <= 390), `Each row has a complete visible phone card, including the reverse-moving middle row: ${JSON.stringify(fullFeed)}`);
    assert(fullFeed.every(row => Math.abs(row.card.center - 195) <= 5), `A complete review card stays centered in every mobile rail: ${JSON.stringify(fullFeed)}`);
    const allReviews = await browser.cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync('/tmp/dbcinema-mobile-landing-390-100reviews.png', Buffer.from(allReviews.data, 'base64'));
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await browser.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/?block-video=1' });
    for (let count = 0; count < 100 && !(await browser.evaluate(`!!document.querySelector('[data-testid="hero-video-play"]')`)); count++) await wait(50);
    const blockedFallback = await browser.evaluate(`(() => {const button=document.querySelector('[data-testid="hero-video-play"]'),video=document.querySelector('video');const r=button?.getBoundingClientRect();return{visible:!!button&&getComputedStyle(button).display!=='none'&&getComputedStyle(button).visibility!=='hidden',label:button?.getAttribute('aria-label'),height:r?.height,insideHero:!!button&&!!document.querySelector('[data-testid="mobile-landing-hero"]')&&r.top>=document.querySelector('[data-testid="mobile-landing-hero"]').getBoundingClientRect().top&&r.bottom<=document.querySelector('[data-testid="mobile-landing-hero"]').getBoundingClientRect().bottom,paused:video?.paused,poster:video?.poster}})()`);
    assert(blockedFallback.visible && blockedFallback.height >= 44 && blockedFallback.insideHero, `A blocked mobile autoplay shows a tappable play fallback inside the landing hero: ${JSON.stringify(blockedFallback)}`);
    assert.equal(blockedFallback.label, 'Play the landing page film');
    await wait(850);
    const blockedActions = await browser.evaluate(`(() => {const hero=document.querySelector('[data-testid="mobile-landing-hero"]'),labels=['Book rental gear','How it works','Call us'];return labels.map(label=>{const node=[...hero.querySelectorAll('a,button')].find(item=>item.textContent.includes(label));return{label,visible:!!node&&getComputedStyle(node.parentElement).opacity>=.95&&getComputedStyle(node).pointerEvents!=='none',height:node?.getBoundingClientRect().height}})})()`);
    assert(blockedActions.every(action=>action.visible&&action.height>=44), `The blocked-video fallback leaves the primary hero actions visible and usable: ${JSON.stringify(blockedActions)}`);
    const blockedShot = await browser.cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync('/tmp/dbcinema-mobile-landing-390-play-fallback.png', Buffer.from(blockedShot.data, 'base64'));
    await browser.evaluate(`window.__allowLandingVideo=true;document.querySelector('[data-testid="hero-video-play"]').click()`);
    for (let count = 0; count < 80 && !(await browser.evaluate(`(() => {const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.1})()`)); count++) await wait(50);
    assert(await browser.evaluate(`(() => {const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.1})()`), 'The play fallback successfully starts the landing video after a user action');
    console.log('PASS landing callouts, muted inline autoplay, visible play recovery, and mobile review-rail motion under normal/reduced motion.');
    console.log('LAYOUTS', JSON.stringify(layouts));
  } finally {
    if (browser) { browser.close(); await fetch((process.env.DBC_CDP_URL || 'http://localhost:9224') + '/json/close/' + browser.tabId).catch(() => {}); }
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
