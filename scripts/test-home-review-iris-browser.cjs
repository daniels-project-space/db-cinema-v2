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
      await client.cmd('Page.navigate', { url: process.env.DBC_TEST_URL || 'http://127.0.0.1:41901/' });
      for (let attempt = 0; attempt < 100 && !(await client.evaluate('!!document.querySelector("[data-testid=hygglo-trust-card]")')); attempt++) await delay(100);
      assert(await client.evaluate('!!document.querySelector("[data-testid=hygglo-trust-card]")'), 'Published reviews are required for this browser check');
      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: width - 2, y: 700 });
      assert.equal(await client.evaluate(`document.querySelector('[data-testid=hygglo-trust-card]').getAttribute('href')`), '/#reviews', `The featured tile links to all reviews at ${width}px`);
      assert(await client.evaluate(`!!document.querySelector('[data-testid=review-eye-glyph]')`), `The animated eye glyph appears beside the trust label at ${width}px`);
      await client.evaluate(`(() => document.querySelector('[data-testid=delivery-protection-tile] button')?.focus())()`);
      for (let attempt = 0; attempt < 30 && await client.evaluate(`!!document.querySelector('[data-testid=delivery-slide-incoming]')`); attempt++) await delay(100);
      if (await client.evaluate(`document.querySelector('[data-testid=delivery-protection-tile] h2').textContent`) === 'Cancellation protection for free') {
        await client.evaluate(`document.querySelector('[data-testid=delivery-protection-tile] button').click()`);
        await delay(1500);
      }
      await client.evaluate(`document.querySelector('[data-testid=delivery-protection-tile] button').click()`);
      await delay(100);
      const delivery = await client.evaluate(`(() => { const tile = document.querySelector('[data-testid=delivery-protection-tile]'); if (!tile) return null; const outgoing = tile.querySelector('[data-testid=delivery-slide]'), incoming = tile.querySelector('[data-testid=delivery-slide-incoming]'); return {titles:[...tile.querySelectorAll('h2')].map(title=>title.textContent), duration:incoming&&getComputedStyle(incoming).animationDuration, animation:incoming&&getComputedStyle(incoming).animationName, outgoingOpacity:outgoing&&getComputedStyle(outgoing).opacity}; })()`);
      assert(delivery, `The rotating delivery and protection tile exists at ${width}px`);
      assert(delivery.titles.includes('Delivered across London') && delivery.titles.includes('Cancellation protection for free'), `Both tile images and messages overlap during the crossfade at ${width}px`);
      assert(delivery.duration.includes('2.4s') && delivery.animation.includes('slide-in'), `The tile image crossfade uses the slower synchronized animation at ${width}px`);
      await delay(500);
      const crossfade = await client.evaluate(`(() => {const tile=document.querySelector('[data-testid=delivery-protection-tile]');return {incoming:Number(getComputedStyle(tile.querySelector('[data-testid=delivery-slide-incoming]')).opacity),outgoing:Number(getComputedStyle(tile.querySelector('[data-testid=delivery-slide]')).opacity)}})()`);
      assert(crossfade.incoming > 0 && crossfade.incoming < 1 && crossfade.outgoing > 0 && crossfade.outgoing < 1, `Both slides visibly crossfade instead of switching abruptly at ${width}px: ${JSON.stringify(crossfade)}`);
      await delay(850);
      const textFade = await client.evaluate(`(() => {const tile=document.querySelector('[data-testid=delivery-protection-tile]'),outgoing=tile.querySelector('[data-testid=delivery-slide] [data-testid=delivery-slide-copy]'),incoming=tile.querySelector('[data-testid=delivery-slide-incoming] [data-testid=delivery-slide-copy]');return {incoming:Number(getComputedStyle(incoming).opacity),outgoing:Number(getComputedStyle(outgoing).opacity)}})()`);
      assert(textFade.outgoing < 0.05 && textFade.incoming > 0 && textFade.incoming < 1, `Slide copy does not ghost over itself during the image crossfade at ${width}px: ${JSON.stringify(textFade)}`);
      await delay(1050);
      assert.equal(await client.evaluate(`document.querySelector('[data-testid=delivery-protection-tile] h2').textContent`), 'Cancellation protection for free', `The incoming protection slide settles cleanly at ${width}px`);
      const textTimings = await client.evaluate(`(() => { const tile=document.querySelector('[data-testid=delivery-protection-tile]'),incoming=tile.querySelector('[data-testid=delivery-slide-incoming] [data-testid=delivery-slide-copy]'),outgoing=tile.querySelector('[data-testid=delivery-slide] [data-testid=delivery-slide-copy]'); return {incoming:getComputedStyle(incoming).animationDuration,outgoing:getComputedStyle(outgoing).animationDuration}; })()`);
      assert.equal(textTimings.incoming,'1.1s',`Incoming copy eases in gradually at ${width}px`);
      assert.equal(textTimings.outgoing,'0.65s',`Outgoing copy has time to fade away before new copy appears at ${width}px`);
      const samples = [];
      for (let index = 0; index < 4; index++) {
        samples.push(await client.evaluate(`(() => { const tile = document.querySelector('[data-testid=hygglo-trust-card]'); return {height:tile.getBoundingClientRect().height, text:tile.querySelector('blockquote').textContent}; })()`));
        await delay(4200);
      }
      assert(new Set(samples.map(sample => sample.text)).size > 1, `The featured review rotates at ${width}px`);
      assert.equal(new Set(samples.map(sample => sample.height)).size, 1, `Review rotation does not change the tile height at ${width}px`);
      const dimensions = await client.evaluate(`(() => { const tile = document.querySelector('[data-testid=hygglo-trust-card]'), quote = tile.querySelector('blockquote'); quote.textContent = 'Excellent.'; const short = tile.getBoundingClientRect().height; quote.textContent = 'A thoughtful review with useful detail about every part of the rental. '.repeat(6); const detailed = tile.getBoundingClientRect().height; quote.textContent = 'A long review with many words. '.repeat(100); return {short, detailed, extreme:tile.getBoundingClientRect().height, quoteHeight:quote.clientHeight, quoteScrollHeight:quote.scrollHeight}; })()`);
      assert.equal(dimensions.detailed, dimensions.short, `A detailed review cannot expand the tile at ${width}px`);
      assert.equal(dimensions.extreme, dimensions.short, `An extreme review cannot expand the tile at ${width}px`);
      assert(dimensions.extreme <= 310, `The featured tile stays at its fixed compact height at ${width}px`);
      assert.equal(dimensions.quoteHeight, 80, `The quote keeps a stable four-line space at ${width}px`);
      assert(dimensions.quoteScrollHeight > dimensions.quoteHeight + 1, `An extreme review is clamped with an ellipsis at ${width}px`);
      assert(await client.evaluate('document.documentElement.scrollWidth <= innerWidth'), `No horizontal overflow at ${width}px`);
    }
    await client.evaluate('document.documentElement.style.scrollBehavior="auto";document.getElementById("home-closing-title").scrollIntoView({block:"center",behavior:"instant"})');
    await delay(1500);
    const button = await client.evaluate(`(() => { const iris = document.querySelector('a[href="/gear"] svg[viewBox="0 0 100 100"]'), rect = iris.getBoundingClientRect(), blade = iris.querySelector('path'); return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,transform:getComputedStyle(blade).transform}; })()`);
    const initial = await client.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/tmp/dbc-iris-initial.png', Buffer.from(initial.data, 'base64'));
    await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: button.x, y: button.y });
    for (let attempt = 0; attempt < 30 && (await client.evaluate(`getComputedStyle(document.querySelector('a[href="/gear"] svg[viewBox="0 0 100 100"] path')).transform`)) === button.transform; attempt++) await delay(100);
    const transform = await client.evaluate(`getComputedStyle(document.querySelector('a[href="/gear"] svg[viewBox="0 0 100 100"] path')).transform`);
    assert.notEqual(transform, button.transform, 'The aperture opens on hover');
    const hovered = await client.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/tmp/dbc-iris-hover.png', Buffer.from(hovered.data, 'base64'));
    console.log('PASS rotating featured review dimensions and opening booking aperture.');
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
