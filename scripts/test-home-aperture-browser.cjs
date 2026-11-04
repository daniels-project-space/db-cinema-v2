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
      const initial = await client.evaluate(`(() => {const button=document.querySelector('[data-testid="home-aperture-button"]'),gearFrames=[...document.querySelectorAll('iframe')].filter(frame=>frame.title==='Gear catalogue preview'||new URL(frame.src,location.href).pathname==='/gear');return {button:!!button,copy:document.querySelector('#home-closing-title')?.textContent,width:document.documentElement.scrollWidth,blades:button?.querySelectorAll('[data-aperture-blade]').length,gearFrames:gearFrames.length}})()`);
      assert(initial.button, `The aperture renders at ${width}px`);
      assert.equal(initial.copy, 'Your next shot starts here.', 'The accessible heading remains intact');
      assert(initial.width <= width, `The section does not overflow at ${width}px`);
      assert.equal(initial.blades, 8, 'The custom iris has eight aligned overlapping leaves');
      assert.equal(initial.gearFrames, 0, 'The home page does not embed a duplicate gear page');
      await client.evaluate(`document.querySelector('[data-testid="home-aperture-button"]').scrollIntoView({block:'end',behavior:'instant'})`);
      await delay(1200);
      let hydrated = false;
      for (let attempt = 0; attempt < 50 && !hydrated; attempt++) {
        hydrated = await client.evaluate(`(() => {const button=document.querySelector('[data-testid="home-aperture-button"]'),key=button&&Object.keys(button).find(key=>key.startsWith('__reactProps'));return Boolean(key&&button[key].onPointerEnter)})()`);
        if (!hydrated) await delay(100);
      }
      assert(hydrated, 'The aperture interaction hydrates before hover');
      const position = await client.evaluate(`(() => {const r=document.querySelector('[data-testid="home-aperture-iris"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);

      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      await delay(100);
      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x, y: position.y });
      await delay(1100);
      const charging = await client.evaluate(`(() => {const button=document.querySelector('[data-testid="home-aperture-button"]'),bar=document.querySelector('[role="progressbar"]'),blade=button?.querySelector('[data-aperture-blade]'),transform=blade&&getComputedStyle(blade).transform;return {progress:Number(bar?.getAttribute('aria-valuenow')||0),transform,phase:button?.className,route:location.pathname,bodyPhase:document.body.dataset.apertureTransition,portal:!!document.querySelector('[data-testid="home-aperture-portal"]')}})()`);
      assert(charging.progress > 20 && charging.progress < 70, `The cancellable charge grows continuously: ${JSON.stringify(charging)}`);
      assert(charging.transform !== 'none', 'The physical leaves open during the cancellable hold');
      assert.equal(charging.route, '/', 'No route change occurs before commitment');
      assert.equal(charging.bodyPhase, 'charging', 'The transition coordinates the floating contact chip');
      const midCharge = await client.cmd('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`/tmp/dbc-home-aperture-charge-${width}.png`, Buffer.from(midCharge.data, 'base64'));

      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      await delay(550);
      assert.equal(await client.evaluate(`document.querySelector('[role="progressbar"]')`), null, 'Leaving before 2.5 seconds cancels the sequence');
      assert.equal(await client.evaluate(`document.querySelector('[data-testid="home-aperture-portal"]')`), null, 'A cancelled hover leaves no transition layer');
      assert.equal(await client.evaluate('location.pathname'), '/', 'Cancellation keeps the visitor on the home page');
      assert.equal(await client.evaluate('document.body.dataset.apertureTransition'), undefined, 'Cancellation restores the floating contact chip');

      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      await delay(100);
      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x, y: position.y });
      for (let attempt = 0; attempt < 35 && await client.evaluate(`document.querySelector('[data-testid="home-aperture-portal"]')?.getAttribute('data-transition-phase') !== 'committed'`); attempt++) await delay(100);
      const committed = await client.evaluate(`(() => {const button=document.querySelector('[data-testid="home-aperture-button"]'),portal=document.querySelector('[data-testid="home-aperture-portal"]'),bar=document.querySelector('[role="progressbar"]'),letters=[...document.querySelectorAll('[data-portal-letter]')],gearFrames=[...document.querySelectorAll('iframe')].filter(frame=>frame.title==='Gear catalogue preview'||new URL(frame.src,location.href).pathname==='/gear'),launcher=document.querySelector('.launcher');return {button:!!button,phase:portal?.getAttribute('data-transition-phase'),route:location.pathname,busy:button?.getAttribute('aria-busy'),bar:Number(bar?.getAttribute('aria-valuenow')||0),bodyPhase:document.body.dataset.apertureTransition,launcherVisibility:launcher&&getComputedStyle(launcher).visibility,gearFrames:gearFrames.length,letterCount:letters.length}})()`);
      assert.equal(committed.phase, 'committed', 'The second stage locks in after a continuous 2.5-second hold');
      assert.equal(committed.route, '/', 'The gear route waits until the text-and-vortex stage completes');
      assert.equal(committed.busy, 'true', 'The committed phase cannot be cancelled');
      assert.equal(committed.bodyPhase, 'committed', 'The committed stage remains registered for the transition');
      if (committed.launcherVisibility) assert.equal(committed.launcherVisibility, 'hidden', 'The floating contact chip does not cover the aperture');
      assert.equal(committed.gearFrames, 0, 'The transition never creates a second gear-page instance');
      assert(committed.letterCount > 80, 'The full copy is available for the letter-by-letter animation');
      await delay(850);
      const movingLetters = await client.evaluate(`(() => [...document.querySelectorAll('[data-portal-letter]')].filter(letter=>Number(getComputedStyle(letter).opacity)<0.98||getComputedStyle(letter).transform!=='none').length)()`);
      assert(movingLetters > 10, `Text moves into the aperture as individual letters: ${movingLetters}`);
      const commitScreenshot = await client.cmd('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`/tmp/dbc-home-aperture-commit-${width}.png`, Buffer.from(commitScreenshot.data, 'base64'));

      for (let attempt = 0; attempt < 50 && await client.evaluate('location.pathname') !== '/gear'; attempt++) await delay(100);
      assert.equal(await client.evaluate('location.pathname'), '/gear', 'The committed transition opens the gear route once');
      let routeReveal = false;
      for (let attempt = 0; attempt < 30 && !routeReveal; attempt++) {
        routeReveal = await client.evaluate(`document.querySelector('[data-testid="home-aperture-portal"]')?.getAttribute('data-transition-phase') === 'revealing'`);
        if (!routeReveal) await delay(50);
      }
      assert(routeReveal, 'The real gear route is revealed through the aperture');
      const revealScreenshot = await client.cmd('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`/tmp/dbc-home-aperture-reveal-${width}.png`, Buffer.from(revealScreenshot.data, 'base64'));
      assert.equal(await client.evaluate(`([...document.querySelectorAll('iframe')].filter(frame=>frame.title==='Gear catalogue preview'||new URL(frame.src,location.href).pathname==='/gear').length)`), 0, 'The revealed gear page is not duplicated in an iframe');
      for (let attempt = 0; attempt < 40 && await client.evaluate(`!!document.querySelector('[data-testid="home-aperture-portal"]')`); attempt++) await delay(100);
      assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="home-aperture-portal"]')`), false, 'The full gear page settles after the reveal');
      assert.equal(await client.evaluate('document.querySelectorAll("#main-content").length'), 1, 'Only one site page tree remains after navigation');
      assert.equal(await client.evaluate('document.body.dataset.apertureTransition'), undefined, 'The contact chip returns after the transition');
    }
    console.log('PASS aligned iris, cancellable charge, letter suction, continuous vortex, single gear route, mobile/desktop reveal.');
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
