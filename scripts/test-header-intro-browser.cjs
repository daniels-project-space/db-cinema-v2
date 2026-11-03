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
    await client.cmd('Network.enable');
    await client.cmd('Network.setBlockedURLs', { urls: ['*convex.cloud*', '*convex.site*'] });
    for (const width of [768, 1024, 1280, 1440]) {
      await client.cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await client.cmd('Page.navigate', { url: process.env.DBC_TEST_URL || 'http://127.0.0.1:41901/' });
      for (let attempt = 0; attempt < 100 && !(await client.evaluate('!!document.querySelector(".f7-lockup")')); attempt++) await delay(100);
      for (let attempt = 0; attempt < 100 && !(await client.evaluate('document.querySelector(".f7-lockup").dataset.open === "true"')); attempt++) await delay(50);
      await delay(1200);
      const intro = await client.evaluate(`(() => { const coin = document.querySelector('.f7-lockup'), link = document.querySelector('header nav a[href="/gear"]'), group = link.parentElement, coinRect = coin.getBoundingClientRect(), linkRect = link.getBoundingClientRect(); return {open:coin.dataset.open, opacity:getComputedStyle(group).opacity, inert:group.inert, coinRight:coinRect.right, linkLeft:linkRect.left}; })()`);
      assert.equal(intro.open, 'true', `Intro is open at ${width}px`);
      assert.equal(intro.opacity, '1', `Navigation stays visible during intro at ${width}px`);
      assert.equal(intro.inert, false, `Navigation stays usable during intro at ${width}px`);
      assert(intro.coinRight <= intro.linkLeft, `Intro must not overlap navigation at ${width}px`);
      if (width === 1280) {
        const screenshot = await client.cmd('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync('/tmp/dbc-header-intro.png', Buffer.from(screenshot.data, 'base64'));
      }
      const coin = await client.evaluate(`(() => { const rect = document.querySelector('.f7-lockup').getBoundingClientRect(); return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}; })()`);
      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', ...coin });
      for (let attempt = 0; attempt < 30 && !(await client.evaluate(`getComputedStyle(document.querySelector('header nav a[href="/gear"]').parentElement).opacity === '0'`)); attempt++) await delay(100);
      const hovered = await client.evaluate(`(() => { const group = document.querySelector('header nav a[href="/gear"]').parentElement; return {opacity:getComputedStyle(group).opacity, inert:group.inert}; })()`);
      assert.equal(hovered.opacity, '0', `Hover hides navigation at ${width}px`);
      assert.equal(hovered.inert, true, `Hidden navigation cannot receive focus at ${width}px`);
      await client.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: width - 5, y: 400 });
    }
    console.log('PASS FORM / SEVEN introduction and hover navigation at four desktop/tablet widths.');
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
