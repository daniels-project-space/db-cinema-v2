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
    for (const width of [390, 768, 1280]) {
      await client.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      await client.cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await client.cmd('Page.navigate', { url: process.env.DBC_TEST_URL || 'http://127.0.0.1:41902/' });
      for (let attempt = 0; attempt < 100 && !(await client.evaluate('!!document.querySelector("[data-testid=hygglo-trust-card]")')); attempt++) await delay(100);
      assert(await client.evaluate('!!document.querySelector("[data-testid=hygglo-trust-card]")'), 'Published reviews are required for this browser check');
      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: width - 2, y: 700 });
      assert.equal(await client.evaluate(`document.querySelector('[data-testid=hygglo-trust-card]').getAttribute('href')`), '/#reviews', `The featured tile links to all reviews at ${width}px`);
      assert(await client.evaluate(`!!document.querySelector('[data-testid=review-eye-glyph]')`), `The animated eye glyph appears beside the trust label at ${width}px`);
      assert.equal(await client.evaluate(`document.querySelector('[data-testid=delivery-protection-tile] button')`), null, `The obsolete manual switch is removed at ${width}px`);
      for (let attempt = 0; attempt < 70 && !await client.evaluate(`!!document.querySelector('[data-testid=delivery-slide-incoming]')`); attempt++) await delay(100);
      const delivery = await client.evaluate(`(() => { const tile = document.querySelector('[data-testid=delivery-protection-tile]'); if (!tile) return null; const outgoing = tile.querySelector('[data-testid=delivery-slide-outgoing]'), incoming = tile.querySelector('[data-testid=delivery-slide-incoming]'); return {titles:[...tile.querySelectorAll('h2')].map(title=>title.textContent), duration:incoming&&getComputedStyle(incoming).animationDuration, animation:incoming&&getComputedStyle(incoming).animationName, incomingCopyDuration:incoming&&getComputedStyle(incoming.querySelector('[data-testid=delivery-slide-copy]')).animationDuration, outgoingCopyDuration:outgoing&&getComputedStyle(outgoing.querySelector('[data-testid=delivery-slide-copy]')).animationDuration, outgoingOpacity:outgoing&&getComputedStyle(outgoing).opacity}; })()`);
      assert(delivery, `The rotating delivery and protection tile exists at ${width}px`);
      assert(delivery.titles.includes('Delivered across London') && delivery.titles.includes('Cancellation protection for free'), `Both tile images and messages overlap during the crossfade at ${width}px`);
      assert(delivery.duration.includes('2.4s') && delivery.animation.includes('slide-in'), `The tile image crossfade uses the slower synchronized animation at ${width}px`);
      assert.equal(delivery.incomingCopyDuration,'1.1s',`Incoming copy eases in gradually at ${width}px`);
      assert.equal(delivery.outgoingCopyDuration,'0.65s',`Outgoing copy has time to fade away before new copy appears at ${width}px`);
      await delay(500);
      const crossfade = await client.evaluate(`(() => {const tile=document.querySelector('[data-testid=delivery-protection-tile]');return {incoming:Number(getComputedStyle(tile.querySelector('[data-testid=delivery-slide-incoming]')).opacity),outgoing:Number(getComputedStyle(tile.querySelector('[data-testid=delivery-slide-outgoing]')).opacity)}})()`);
      assert(crossfade.incoming > 0 && crossfade.incoming < 1 && crossfade.outgoing > 0 && crossfade.outgoing < 1, `Both slides visibly crossfade instead of switching abruptly at ${width}px: ${JSON.stringify(crossfade)}`);
      await delay(1250);
      assert.equal(await client.evaluate(`document.querySelector('[data-testid=delivery-protection-tile] [aria-hidden="false"] h2').textContent`), 'Cancellation protection for free', `The incoming protection slide settles cleanly at ${width}px`);
      const samples = [];
      const reviewSamples = width === 390 ? 2 : 1;
      for (let index = 0; index < reviewSamples; index++) {
        samples.push(await client.evaluate(`(() => { const tile = document.querySelector('[data-testid=hygglo-trust-card]'); return {height:tile.getBoundingClientRect().height, text:tile.querySelector('blockquote').textContent}; })()`));
        if (index + 1 < reviewSamples) await delay(4200);
      }
      if (width === 390) assert(new Set(samples.map(sample => sample.text)).size > 1, `The featured review rotates at ${width}px`);
      assert.equal(new Set(samples.map(sample => sample.height)).size, 1, `Review rotation does not change the tile height at ${width}px`);
      const dimensions = await client.evaluate(`(() => { const tile = document.querySelector('[data-testid=hygglo-trust-card]'), quote = tile.querySelector('blockquote'); quote.textContent = 'Excellent.'; const short = tile.getBoundingClientRect().height; quote.textContent = 'A thoughtful review with useful detail about every part of the rental. '.repeat(6); const detailed = tile.getBoundingClientRect().height; quote.textContent = 'A long review with many words. '.repeat(100); return {short, detailed, extreme:tile.getBoundingClientRect().height, quoteHeight:quote.clientHeight, quoteScrollHeight:quote.scrollHeight}; })()`);
      assert.equal(dimensions.detailed, dimensions.short, `A detailed review cannot expand the tile at ${width}px`);
      assert.equal(dimensions.extreme, dimensions.short, `An extreme review cannot expand the tile at ${width}px`);
      assert(dimensions.extreme <= 310, `The featured tile stays at its fixed compact height at ${width}px`);
      assert.equal(dimensions.quoteHeight, 54, `The quote keeps a stable three-line space at ${width}px`);
      assert(dimensions.quoteScrollHeight > dimensions.quoteHeight + 1, `An extreme review is clamped with an ellipsis at ${width}px`);
      assert(await client.evaluate('document.documentElement.scrollWidth <= innerWidth'), `No horizontal overflow at ${width}px`);
    }
    await client.evaluate('document.documentElement.style.scrollBehavior="auto";document.querySelector("[data-testid=home-aperture-button]").scrollIntoView({block:"center",behavior:"instant"})');
    await delay(250);
    const button = await client.evaluate(`(() => { const iris = document.querySelector('[data-testid="home-aperture-button"]'), rect = iris.getBoundingClientRect(), blade = iris.querySelector('svg g'); return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,transform:getComputedStyle(blade).transform}; })()`);
    await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: button.x, y: button.y });
    await delay(1500);
    assert(await client.evaluate(`!!document.querySelector('[role="progressbar"]')`), 'The hover progress indicator appears during its cancellable phase');
    await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
    await delay(100);
    assert.equal(await client.evaluate(`document.querySelector('[role="progressbar"]')`), null, 'Leaving before 2.5 seconds cancels and resets the aperture');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="home-aperture-portal"]')`), null, 'The portal does not open before commitment');
    await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: button.x, y: button.y });
    await delay(2750);
    const portal = await client.evaluate(`(() => { const portal = document.querySelector('[data-testid="home-aperture-portal"]'), frame = portal?.querySelector('iframe'), button = document.querySelector('[data-testid="home-aperture-button"]'); return {portal:!!portal, frame:frame?.getAttribute('src'), clip:portal&&getComputedStyle(portal).clipPath, committed:button?.getAttribute('aria-busy'), moving:[...document.querySelectorAll('[data-portal-letter]')].some(letter=>getComputedStyle(letter).animationName.includes('letter-suck'))}; })()`);
    assert(portal.portal && portal.frame === '/gear', 'The portal reveals the real gear page behind the aperture');
    assert(portal.clip.includes('circle('), 'The portal expands as a circular iris');
    assert.equal(portal.committed, 'true', 'The transition cannot be cancelled after the midpoint');
    assert(portal.moving, 'The headline and supporting copy are pulled in letter by letter');
    const screenshot = await client.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/tmp/dbc-iris-committed.png', Buffer.from(screenshot.data, 'base64'));
    console.log('PASS rotating featured review dimensions, delivery crossfade and committed aperture transition.');
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
