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
    await client.cmd('Network.setBlockedURLs', {urls:['*convex.cloud*','*convex.site*']});
    await client.cmd('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:false});
    await client.cmd('Page.navigate', {url:process.env.DBC_TEST_URL || 'http://127.0.0.1:41901/'});
    for(let attempt=0;attempt<100&&!(await client.evaluate('!!document.querySelector(\'[aria-label="Rental and review figures"]\')'));attempt++)await delay(100);
    await client.evaluate(`document.documentElement.style.scrollBehavior='auto';document.querySelector('[aria-label="Rental and review figures"]').scrollIntoView({block:'center',behavior:'instant'})`);
    const samples=[];
    for(let index=0;index<20;index++){samples.push(await client.evaluate(`Array.from(document.querySelectorAll('[aria-label="Rental and review figures"] [aria-hidden="true"]')).map(item=>item.textContent)`));await delay(120);}
    assert(samples.every(sample=>sample.length===3),'All three public figures are present');
    assert(new Set(samples.map(sample=>sample[1])).size>1,'The review count animates after scrolling');
    assert.equal(samples.at(-1)[0],'4.73');
    assert.equal(samples.at(-1)[1],'1,300+');
    assert(/^\d[\d,]*$/.test(samples.at(-1)[2]),'The item count uses the current catalogue value');
    assert(await client.evaluate(`Array.from(document.querySelectorAll('[aria-label="Rental and review figures"] .sr-only')).every(item=>{const rect=item.getBoundingClientRect();return rect.width<=1 && rect.height<=1})`),'Accessible final values are visually hidden, not duplicated');
    console.log('PASS live three-figure count-up and visually hidden accessible values.');
  } finally { client.close(); await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`); }
})().catch(error=>{console.error(error);process.exitCode=1});
