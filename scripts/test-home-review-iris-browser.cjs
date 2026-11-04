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
      await client.cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await client.cmd('Page.navigate', { url: process.env.DBC_TEST_URL || 'http://127.0.0.1:41901/' });
      for (let attempt = 0; attempt < 100 && !(await client.evaluate('!!document.querySelector("[data-testid=hygglo-trust-card]")')); attempt++) await delay(100);
      assert(await client.evaluate('!!document.querySelector("[data-testid=hygglo-trust-card]")'), 'Published reviews are required for this browser check');
      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: width - 2, y: 700 });
      const samples = [];
      for (let index = 0; index < 4; index++) {
        samples.push(await client.evaluate(`(() => { const tile = document.querySelector('[data-testid=hygglo-trust-card]'); return {height:tile.getBoundingClientRect().height, text:tile.querySelector('blockquote').textContent}; })()`));
        await delay(3200);
      }
      assert(new Set(samples.map(sample => sample.text)).size > 1, `The featured review rotates at ${width}px`);
      const extremes = await client.evaluate(`(() => { const tile = document.querySelector('[data-testid=hygglo-trust-card]'), quote = tile.querySelector('blockquote'); quote.textContent = 'Excellent.'; const short = tile.getBoundingClientRect().height; quote.textContent = 'A long review with many words. '.repeat(100); return {short, long:tile.getBoundingClientRect().height}; })()`);
      assert(extremes.long > extremes.short + 32, `The featured tile grows to fit longer reviews at ${width}px`);
      assert(await client.evaluate(`(() => { const quote = document.querySelector('[data-testid=hygglo-trust-card] blockquote'); return quote.scrollHeight <= quote.clientHeight + 1; })()`), `The longer featured review is not clipped at ${width}px`);
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
