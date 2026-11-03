const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + '\nreturn connect;')(require);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const card = `Array.from(document.querySelectorAll('article')).find(element => element.textContent.includes('Delivered across London') || element.textContent.includes('Cancellation protection for free'))`;

(async () => {
  const client = await connect();
  try {
    await client.cmd('Page.enable');
    await client.cmd('Network.enable');
    await client.cmd('Network.setBlockedURLs', {urls:['*convex.cloud*','*convex.site*']});
    for (const width of [390, 1440]) {
      await client.cmd('Emulation.setDeviceMetricsOverride', {width,height:900,deviceScaleFactor:1,mobile:false});
      await client.cmd('Page.navigate', {url:process.env.DBC_TEST_URL || 'http://127.0.0.1:41901/'});
      for (let attempt=0;attempt<100&&!(await client.evaluate(`!!(${card})`));attempt++) await delay(100);
      assert(await client.evaluate(`!!(${card})`), 'The delivery tile exists');
      let title = await client.evaluate(`${card}.querySelector('h2').textContent`);
      for (let attempt=0;attempt<80&&title==='Delivered across London';attempt++) { await delay(100); title=await client.evaluate(`${card}.querySelector('h2').textContent`); }
      assert.equal(title,'Cancellation protection for free',`The tile rotates at ${width}px`);
      assert.equal(await client.evaluate(`${card}.querySelector('a').getAttribute('href')`),'/legal/cancellation');
      const dimensions = await client.evaluate(`(() => {const rect=${card}.getBoundingClientRect();return {left:rect.left,right:rect.right,width:innerWidth,scroll:document.documentElement.scrollWidth}})()`);
      assert(dimensions.left>=0 && dimensions.right<=dimensions.width && dimensions.scroll<=dimensions.width, `No horizontal overflow at ${width}px`);
      await client.evaluate(`${card}.querySelector('button').focus()`);
      await delay(250);
      assert(await client.evaluate(`document.activeElement === ${card}.querySelector('button')`),'The manual switch receives keyboard focus');
      await delay(5500);
      assert(await client.evaluate(`document.activeElement === ${card}.querySelector('button')`),'Focus remains on the switch');
      assert.equal(await client.evaluate(`${card}.querySelector('h2').textContent`),title,'A focused control stops automatic changes');
      await client.evaluate(`${card}.querySelector('button').click()`);
      assert.equal(await client.evaluate(`${card}.querySelector('h2').textContent`),'Delivered across London','Manual switching works while focused');
    }
    await client.cmd('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await client.cmd('Page.navigate', {url:process.env.DBC_TEST_URL || 'http://127.0.0.1:41901/'});
    for (let attempt=0;attempt<100&&!(await client.evaluate(`!!(${card})`));attempt++) await delay(100);
    await delay(5500);
    assert.equal(await client.evaluate(`${card}.querySelector('h2').textContent`),'Delivered across London','Reduced motion prevents automatic rotation');
    await client.evaluate(`${card}.querySelector('button').click()`);
    assert.equal(await client.evaluate(`${card}.querySelector('h2').textContent`),'Cancellation protection for free','The alternate remains available with reduced motion');
    console.log('PASS delivery/protection rotation, terms link, focus, manual switch and reduced motion.');
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
