const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + '\nreturn connect;')(require);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const card = `Array.from(document.querySelectorAll('article')).find(element => element.textContent.includes('Delivered across London') || element.textContent.includes('Cancellation protection for free'))`;
const activeTitle = `${card}.querySelector('[aria-hidden="false"] h2').textContent`;

(async () => {
  const client = await connect();
  try {
    await client.cmd('Page.enable');
    await client.cmd('Network.enable');
    await client.cmd('Network.setBlockedURLs', {urls:['*convex.cloud*','*convex.site*']});
    for (const width of [390, 1440]) {
      await client.cmd('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      await client.cmd('Emulation.setDeviceMetricsOverride', {width,height:900,deviceScaleFactor:1,mobile:false});
      await client.cmd('Page.navigate', {url:process.env.DBC_TEST_URL || 'http://127.0.0.1:41902/'});
      for (let attempt=0;attempt<100&&!(await client.evaluate(`!!(${card})`));attempt++) await delay(100);
      assert(await client.evaluate(`!!(${card})`), 'The delivery tile exists');
      await client.evaluate(`${card}.scrollIntoView({block:'center',behavior:'instant'});void(window.__deliveryImages=[...${card}.querySelectorAll('img')])`);
      await delay(500);
      assert.equal(await client.evaluate(`window.__deliveryImages.length`),2,'Both visual slides stay mounted once');
      let title = await client.evaluate(activeTitle);
      for (let attempt=0;attempt<100&&title==='Delivered across London';attempt++) { await delay(100); title=await client.evaluate(activeTitle); }
      assert.equal(title,'Cancellation protection for free',`The tile rotates at ${width}px`);
      assert.equal(await client.evaluate(`${card}.querySelector('a').getAttribute('href')`),'/legal/cancellation');
      const dimensions = await client.evaluate(`(() => {const rect=${card}.getBoundingClientRect();return {left:rect.left,right:rect.right,width:innerWidth,scroll:document.documentElement.scrollWidth}})()`);
      assert(dimensions.left>=0 && dimensions.right<=dimensions.width && dimensions.scroll<=dimensions.width, `No horizontal overflow at ${width}px`);
      assert.equal(await client.evaluate(`${card}.querySelector('button')`),null,'The manual slide-switch button is removed');
      assert(await client.evaluate(`window.__deliveryImages.every(image=>image.isConnected&&${card}.contains(image))`),'The slide image elements remain mounted through rotation');
      await delay(5500);
      assert.equal(await client.evaluate(activeTitle),'Delivered across London','The tile continues to rotate automatically');
      for (let attempt=0;attempt<100&&await client.evaluate(activeTitle)!=='Cancellation protection for free';attempt++) await delay(100);
      await client.evaluate(`${card}.querySelector('a').focus()`);
      await delay(250);
      const focusedTitle = await client.evaluate(activeTitle);
      assert.equal(focusedTitle,'Cancellation protection for free','The terms link is keyboard reachable');
      await delay(5500);
      assert.equal(await client.evaluate(activeTitle),focusedTitle,'Reading the terms pauses automatic rotation');
      await client.evaluate(`${card}.querySelector('a').blur()`);
      await delay(8000);
      assert.equal(await client.evaluate(activeTitle),'Delivered across London','Automatic rotation resumes after focus leaves');
      assert(await client.evaluate(`window.__deliveryImages.every(image=>image.isConnected&&${card}.contains(image))`),'Neither slide image remounts after a full cycle');
    }
    await client.cmd('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await client.cmd('Page.navigate', {url:process.env.DBC_TEST_URL || 'http://127.0.0.1:41902/'});
    for (let attempt=0;attempt<100&&!(await client.evaluate(`!!(${card})`));attempt++) await delay(100);
    await delay(5500);
    assert.equal(await client.evaluate(activeTitle),'Delivered across London','Reduced motion prevents automatic rotation');
    assert.equal(await client.evaluate(`${card}.querySelector('button')`),null,'No manual switch control is exposed');
    console.log('PASS delivery/protection rotation, persistent images, terms link, focus and reduced motion.');
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
