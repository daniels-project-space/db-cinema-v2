const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + '\nreturn connect;')(require);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const client = await connect();
  try {
    await client.cmd('Page.enable');
    await client.cmd('Runtime.enable');
    client.on(message => {
      if (message.method === 'Runtime.exceptionThrown') console.error('PAGE_EXCEPTION', message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') console.error('PAGE_CONSOLE_ERROR', message.params.args?.map(argument => argument.value || argument.description).join(' '));
    });
    for (const width of [390, 1280]) {
      await client.cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await client.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await client.cmd('Page.navigate', { url: process.env.DBC_TEST_URL || 'http://127.0.0.1:41902/' });
      for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="home-aperture-button"]')`); attempt++) await delay(100);
      const initial = await client.evaluate(`(() => {const button=document.querySelector('[data-testid="home-aperture-button"]');return {button:!!button,copy:document.querySelector('#home-closing-title')?.textContent,width:document.documentElement.scrollWidth}})()`);
      assert(initial.button, `The aperture renders at ${width}px`);
      assert.equal(initial.copy, 'Your next shot starts here.', 'The accessible heading remains intact');
      assert(initial.width <= width, `The portal section does not overflow at ${width}px`);
      await client.evaluate(`document.querySelector('[data-testid="home-aperture-button"]').scrollIntoView({block:'end',behavior:'instant'})`);
      await delay(1200);
      let hydrated = false;
      for (let attempt = 0; attempt < 50 && !hydrated; attempt++) {
        hydrated = await client.evaluate(`(() => {const button=document.querySelector('[data-testid="home-aperture-button"]'),key=button&&Object.keys(button).find(key=>key.startsWith('__reactProps'));return Boolean(key&&button[key].onPointerEnter)})()`);
        if (!hydrated) await delay(100);
      }
      assert(hydrated, 'The aperture client interaction is hydrated before the hover check');
      const position = await client.evaluate(`(() => {const r=document.querySelector('[data-testid="home-aperture-iris"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);

      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      await delay(100);
      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x, y: position.y });
      await delay(1000);
      const hoverState = await client.evaluate(`(() => {const button=document.querySelector('[data-testid="home-aperture-button"]'),top=document.elementFromPoint(${position.x},${position.y});return {progress:!!document.querySelector('[role="progressbar"]'),hover:button.matches(':hover'),active:button.className,top:top?.tagName+':'+top?.className,rect:button.getBoundingClientRect().toJSON(),ready:document.readyState,resources:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/_next/static/chunks/app/page')).map(entry=>({name:entry.name,duration:entry.duration}))}})()`);
      assert(hoverState.progress, `The cancellable loading bar appears on hover: ${JSON.stringify(hoverState)}`);
      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      await delay(150);
      assert.equal(await client.evaluate(`document.querySelector('[role="progressbar"]')`), null, 'Leaving before 2.5 seconds resets progress');
      assert.equal(await client.evaluate(`document.querySelector('[data-testid="home-aperture-portal"]')`), null, 'A cancelled hover leaves the page unchanged');

      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      await delay(100);
      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x, y: position.y });
      await delay(2750);
      const committed = await client.evaluate(`(() => {const portal=document.querySelector('[data-testid="home-aperture-portal"]'),button=document.querySelector('[data-testid="home-aperture-button"]'),iris=document.querySelector('[data-testid="home-aperture-iris"]'),rect=iris.getBoundingClientRect(),frame=portal?.querySelector('iframe'),letters=[...document.querySelectorAll('[data-portal-letter]')],portalStyle=portal&&getComputedStyle(portal);return {src:frame?.getAttribute('src'),originX:portalStyle?.getPropertyValue('--portal-x'),originY:portalStyle?.getPropertyValue('--portal-y'),irisX:rect.left+rect.width/2,irisY:rect.top+rect.height/2,clip:portalStyle?.clipPath,busy:button?.getAttribute('aria-busy'),lettersPulled:letters.filter(letter=>Number(getComputedStyle(letter).opacity)<0.99||getComputedStyle(letter).transform!=='none').length}})()`);
      assert.equal(committed.src, '/gear', 'The portal previews the real gear page');
      assert(committed.clip.includes('circle('), 'The aperture expands across the screen');
      assert(Math.abs(parseFloat(committed.originX) - committed.irisX) < 5 && Math.abs(parseFloat(committed.originY) - committed.irisY) < 5, `The iris starts at the aperture, not the screen center: ${JSON.stringify(committed)}`);
      assert(Math.abs(committed.irisY - 450) > 100, 'The portal test deliberately opens away from the viewport center');
      assert.equal(committed.busy, 'true', 'The second phase cannot be cancelled');
      assert(committed.lettersPulled > 0, 'Copy is pulled toward the iris letter by letter');
      await delay(1900);
      const frameState = await client.evaluate(`(() => {const frame=document.querySelector('[data-testid="home-aperture-portal"] iframe');let sameOrigin=false;try{sameOrigin=frame.contentDocument?.location.origin===window.location.origin}catch{}return {sameOrigin,ready:frame?.className.includes('gearPageReady')}})()`);
      assert(frameState.sameOrigin && frameState.ready, `The portal reveals the real same-origin gear page: ${JSON.stringify(frameState)}`);
      const screenshot = await client.cmd('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`/tmp/dbc-home-aperture-${width}.png`, Buffer.from(screenshot.data, 'base64'));
      for (let attempt = 0; attempt < 50 && await client.evaluate('location.pathname') !== '/gear'; attempt++) await delay(100);
      assert.equal(await client.evaluate('location.pathname'), '/gear', 'The full-screen portal finishes by opening the gear catalogue');
      const gearPage = await client.cmd('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`/tmp/dbc-gear-after-portal-${width}.png`, Buffer.from(gearPage.data, 'base64'));
    }
    console.log('PASS cancellable hover, committed iris, letter suction, mobile/desktop layout and gear navigation.');
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
