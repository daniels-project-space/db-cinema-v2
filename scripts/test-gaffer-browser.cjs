/** Run against a local preview, or the exact production domain with --production. Uses real catalogue reads and the rendered
 * Gaffer tool closures; never starts a call, adds stock holds, or checks out.
 * PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-gaffer-browser.cjs
 */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.PREVIEW_URL || 'http://127.0.0.1:3091';
const production=process.argv.includes('--production') && new URL(base).origin==='https://dbcinemarentals.com';
if(!production && !['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Use a local preview or explicitly select the production domain');
async function getTools(page, name, args={}) {
 return page.evaluate(async ({name,args})=>{
  const element=[...document.querySelectorAll('*')].find(e=>Object.keys(e).some(k=>k.startsWith('__reactFiber')));
  let fiber=element[Object.keys(element).find(k=>k.startsWith('__reactFiber'))];while(fiber.return)fiber=fiber.return;
  const stack=[fiber],seen=new Set();
  while(stack.length){const n=stack.pop();if(!n||seen.has(n))continue;seen.add(n);let hook=n.memoizedState;
   while(hook){const value=hook.memoizedState?.current;if(value?.recommend_gear)return value[name](args);hook=hook.next;}
   stack.push(n.child,n.sibling);
  }throw Error('Live Gaffer tools missing');
 },{name,args});
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  for(const viewport of [{width:1365,height:900},{width:390,height:844}]) {
   const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/faq',{waitUntil:'networkidle'});
   // Delay first catalogue navigation: the old 120ms scroll would run on /faq.
   await page.route('**/gear?**',async route=>{await new Promise(r=>setTimeout(r,650));await route.continue();});
   await getTools(page,'show_basket');
   assert.match(await getTools(page,'recommend_gear',{item:'sony camera'}),/on screen and highlighted/);
   await page.waitForTimeout(550);
   let screen=await page.evaluate(()=>({x:document.querySelector('aside').getBoundingClientRect().x,y:document.querySelector('[data-listing-id]').getBoundingClientRect().top,scroll:scrollY}));
   assert.ok(screen.x>=viewport.width-2,'basket closed');assert.ok(screen.y>=60 && screen.y<viewport.height-100,'top pick visible');assert.ok(screen.scroll>100);
   await page.screenshot({path:`/tmp/dbc-gaffer-${production ? "production-" : ""}${viewport.width}.png`});
   assert.match(await getTools(page,'select_item',{item:'sony fx3'}),/Highlighted/);
   const target=await page.locator('[data-listing-id]').first().boundingBox();assert.ok(target.y<viewport.height-100,'encoded spaces in route scroll correctly');
   await getTools(page,'show_basket');
   assert.match(await getTools(page,'browse_for',{category:'Lighting'}),/Showing Lighting/);
   await page.waitForTimeout(550);
   assert.ok(await page.evaluate(()=>document.querySelector('aside').getBoundingClientRect().x>=innerWidth-2));
   const toolbar=await page.locator('#gear-toolbar').boundingBox();assert.ok(toolbar.y<200,'category browse scrolled');
   await getTools(page,'navigate_to',{destination:'gear'});
   await page.waitForFunction(()=>document.querySelector('main')?.dataset.gafferReady==='true');
   assert.equal(await page.locator('input[placeholder]').first().inputValue(),'','unfiltered navigation clears previous search');
   assert.match(await getTools(page,'request_better_price'),/has not asked/,'no unsolicited discount');
   assert.deepEqual(errors,[]);
   console.log(`PASS ${viewport.width}px: delayed navigation, shortlist, item selection, drawer closure, category scroll, filter reset, no unsolicited discount.`);
   await page.close();
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
