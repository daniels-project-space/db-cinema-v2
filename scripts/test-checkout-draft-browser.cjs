/** Real Next checkout navigation/React/price refresh; read-only catalogue and quotes. Never submits payment. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..');
const src=fs.readFileSync(root+'/scripts/test-membership-browser.cjs','utf8');
const connect=new Function('require',src.slice(0,src.indexOf('const { ConvexHttpClient }'))+'\nreturn connect;')(require);
const {ConvexHttpClient}=require('convex/browser'),{api}=require('../convex/_generated/api.js');
const base=process.env.DBC_CHECKOUT_ROOT||process.env.DBC_BROWSER_ROOT||'http://localhost:41848';
const cv=new ConvexHttpClient(process.env.DBC_CONVEX_URL||'https://deafening-stoat-340.convex.cloud');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const r=await cv.query(api.catalog.listListings,{}),rows=(Array.isArray(r)?r:r.items??r.listings??[]).filter(x=>x.pricing&&!x.marketingOnly&&!x.displayOnly);
 const future=new Date(Date.now()+90*86400000),start=Date.UTC(future.getUTCFullYear(),future.getUTCMonth(),future.getUTCDate()),end=start+2*86400000;
 let listing;for(const l of rows){const a=await cv.query(api.availability.forCart,{items:[{listingId:l._id,start,end}]});if(a[l._id]?.ok){listing=l;break}}assert(listing,'Read-only test requires one actually available listing');
 const cart=[{key:listing._id+':draft-test',listingId:listing._id,slug:listing.slug,title:listing.title,heroImage:listing.heroImage,
  start:new Date(start).toISOString().slice(0,10),end:new Date(end).toISOString().slice(0,10),days:3,perDay:listing.pricing.daily,total:listing.pricing.daily*3,deposit:listing.depositAmount}];
 const c=await connect();let failure;
 const output=process.env.DBC_CHECKOUT_SCREENSHOTS||'/root/dbc-checkout-draft-review';fs.mkdirSync(output,{recursive:true});
 async function until(expression,label){for(let n=0;n<160;n++){if(await c.evaluate(expression))return;await delay(200)}throw Error(label)}
 async function fill(id,value){await c.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('Missing field');const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(50)}
 async function ready(){await until(`!!document.getElementById('co-sig')&&!document.getElementById('co-sig').disabled`,'Fresh quote must enable signature');}
 async function ensureTimePickers(){
  await c.evaluate(`document.querySelectorAll('[data-checkout-item-times]>button[aria-expanded="false"]').forEach(e=>e.click())`);
  await until(`document.querySelectorAll('[role="combobox"][aria-haspopup="listbox"]').length>=2`,'Rental time controls render');
 }
 async function timePickerId(index){return c.evaluate(`document.querySelectorAll('[role="combobox"][aria-haspopup="listbox"]')[${index}]?.id??null`);}
 async function timePickerText(index){return c.evaluate(`document.querySelectorAll('[role="combobox"][aria-haspopup="listbox"]')[${index}]?.querySelector('[id$="-value"]')?.textContent?.trim()??''`);}
 async function chooseTime(index,time){
  const id=await timePickerId(index);assert(id,`Rental time picker ${index+1} must render`);
  await until(`document.getElementById(${JSON.stringify(id)})&&!document.getElementById(${JSON.stringify(id)}).disabled`,'Time availability settles');
  await c.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  await until(`!!document.querySelector('[role=listbox]')`,'Custom time options must open');
  await c.evaluate(`([...document.querySelectorAll('[role=option]')].find(e=>e.innerText===${JSON.stringify(time)})??(()=>{throw Error('Missing time option')})()).click()`);
  const field=index===0?'pickupTime':'returnTime';
  await until(`JSON.parse(localStorage.getItem('dbc_cart_v1'))?.some(item=>item.${field}===${JSON.stringify(time)})`,'Selected rental time saves to the basket');
  await until(`![...document.querySelectorAll('[data-checkout-item-times]')].some(e=>e.innerText.includes('Updating rental duration and price…'))`,'Rental time price update settles');
  await ready();
 }
 async function navigate(path){const epoch=await c.evaluate('performance.timeOrigin');await c.cmd('Page.navigate',{url:base+path});await until(`performance.timeOrigin!==${epoch}&&document.readyState==='complete'`,'New checkout document');await ready();}
 try{
  await c.cmd('Page.enable');await c.cmd('Network.enable');await c.cmd('Network.setBlockedURLs',{urls:['*.mp4*','*.webm*','*.mov*']});
  await c.cmd('Page.navigate',{url:base+'/gear'});
  await until(`(document.body?.innerText.length??0)>100`,'Application must render');
  await c.evaluate(`sessionStorage.clear()`);
  await c.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(new URL(base).origin)}&&location.pathname==='/checkout'&&!sessionStorage.getItem('draft-browser-seeded')){localStorage.removeItem('dbc_acct');localStorage.removeItem('dbc_membership_selection_v1');localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify(cart))});sessionStorage.setItem('draft-browser-seeded','1')}`});
  await navigate('/checkout');
  await fill('co-email','draft-review@example.invalid');await fill('co-name','Draft Review Renter');await fill('co-phone','07000000000');await fill('co-billing-address','123 Fixture Street, London SW1A 1AA');await ready();
  await ensureTimePickers();
  for(const [index,time] of [[0,'10:00'],[1,'18:00']]){
   const id=await timePickerId(index);assert(id,`Rental time picker ${index+1} must have a stable DOM id`);
   await until(`document.getElementById(${JSON.stringify(id)})&&!document.getElementById(${JSON.stringify(id)}).disabled`,'Time availability settles');
   await c.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
   await until(`!!document.querySelector('[role=listbox]')`,'Custom time options must open');
   await c.evaluate(`[...document.querySelectorAll('[role=option]')].find(e=>e.innerText===${JSON.stringify(time)}).click()`);
  }
  await ready();await c.evaluate(`document.querySelector('[data-testid=rental-agreement-checkbox]').click()`);await fill('co-sig','Draft Review Renter');await delay(400);
  assert.equal(await c.evaluate(`document.querySelector('[data-testid=rental-agreement-checkbox]').checked`),true,'Typing signature must not uncheck terms');
  assert.equal(await c.evaluate(`document.getElementById('co-sig').value`),'Draft Review Renter');
  await fill('co-phone','07111111111');await delay(300);
  assert.equal(await c.evaluate(`document.getElementById('co-sig').value`),'','Changing signed details requires fresh signature');
  assert.equal(await c.evaluate(`document.querySelector('[data-testid=rental-agreement-checkbox]').checked`),true);
  await c.evaluate(`document.querySelector('[data-testid=cancellation-protection]').click()`);
  await until(`!!document.querySelector('dialog[open][aria-label="Cancellation protection"]')`,'Cancellation protection details open');
  await c.evaluate(`document.querySelector('[aria-label="Close cancellation protection"]').click()`);await ready();
  assert.equal(await c.evaluate(`document.querySelector('[data-testid=rental-agreement-checkbox]').checked`),true);
  await fill('co-sig','Draft Review Renter');
  const extendedEnd=new Date(end+86400000).toISOString().slice(0,10);
  await c.cmd('Page.navigate',{url:base+'/cart'});await until(`(document.body?.innerText??'').includes(${JSON.stringify(listing.title)})`,'Actual basket must render');
  await c.evaluate(`document.querySelector('[data-cart-dates] button').click()`);
  await until(`!!document.querySelector('input[type="date"][aria-label^="Return date for"]')`,'Cart date editor opens');
  await c.evaluate(`(()=>{const e=document.querySelector('input[type="date"][aria-label^="Return date for"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(extendedEnd)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('[data-cart-date-save]')&&!document.querySelector('[data-cart-date-save]').disabled`,'Updated cart dates are available');
  await c.evaluate(`document.querySelector('[data-cart-date-save]').click()`);
  await until(`JSON.parse(localStorage.getItem('dbc_cart_v1'))?.[0]?.end===${JSON.stringify(extendedEnd)}&&!JSON.parse(localStorage.getItem('dbc_cart_v1'))?.[0]?.pickupTime&&!JSON.parse(localStorage.getItem('dbc_cart_v1'))?.[0]?.returnTime`,'Changing dates clears the now-unverified time selections');
  await navigate('/checkout');await ensureTimePickers();
  assert.deepEqual(await c.evaluate(`['co-email','co-name','co-phone','co-billing-address','co-sig'].map(id=>document.getElementById(id).value)`),['draft-review@example.invalid','Draft Review Renter','07111111111','123 Fixture Street, London SW1A 1AA','']);
  assert.equal(await c.evaluate(`document.querySelector('[data-testid=rental-agreement-checkbox]').checked`),true,'Terms survive basket changes and fresh quote');
  assert.equal(await c.evaluate(`document.querySelector('[data-checkout-item-times]').innerText.includes('Times needed')`),true,'Changing rental dates requires fresh pickup and return times');
  await chooseTime(0,'10:00');await chooseTime(1,'18:00');
  assert.equal(await timePickerText(0),'10:00');
  assert.equal(await timePickerText(1),'18:00');
  assert.equal(await c.evaluate(`!!document.querySelector('.toast-in')`),false,'Checkout time changes do not cover agreement controls with a cart toast');
  assert.equal(await c.evaluate(`document.querySelector('[data-testid=refundable-security]').innerText.toLowerCase().includes('saved card & future claims')`),true,'Saved-card security quote remains visible after basket changes');
  assert.equal(await c.evaluate(`!!document.querySelector('[data-testid=cancellation-protection]')`),true,'Cancellation protection details remain available after basket changes');
  const stored=await c.evaluate(`sessionStorage.getItem('dbc_checkout_draft_v1:guest')`);assert(stored&&!stored.includes('signature')&&!stored.includes('requestId'));
  const epoch=await c.evaluate('performance.timeOrigin');await c.cmd('Page.reload');await until(`performance.timeOrigin!==${epoch}&&document.readyState==='complete'`,'Reloaded checkout document');await ready();await ensureTimePickers();assert.equal(await c.evaluate(`document.querySelector('[data-testid=rental-agreement-checkbox]').checked`),true);
  assert.equal(await c.evaluate(`document.getElementById('co-sig').value`),'');
  let pickupId=await timePickerId(0);await until(`document.getElementById(${JSON.stringify(pickupId)})&&!document.getElementById(${JSON.stringify(pickupId)}).disabled`,'Reloaded time availability settles');
  await c.cmd('Page.bringToFront');
  await until(`!document.getElementById(${JSON.stringify(pickupId)}).disabled&&document.querySelector('main').innerText.includes('Availability checked.')`,'Focus-triggered stock refresh settles');
  await c.evaluate(`document.getElementById(${JSON.stringify(pickupId)}).scrollIntoView({block:'center',behavior:'instant'});document.getElementById(${JSON.stringify(pickupId)}).focus()`);
  await until(`document.activeElement?.id===${JSON.stringify(pickupId)}&&!document.getElementById(${JSON.stringify(pickupId)}).disabled`,'Time trigger has keyboard focus');
  for(const key of ['ArrowDown','End','Enter']){await c.cmd('Input.dispatchKeyEvent',{type:'keyDown',key});await c.cmd('Input.dispatchKeyEvent',{type:'keyUp',key});if(key==='ArrowDown')await until(`!!document.querySelector('[role=listbox]')`,'Keyboard opens time choices');if(key==='End')await until(`document.getElementById(${JSON.stringify(pickupId)}).getAttribute('aria-activedescendant')?.endsWith('-13')`,'Keyboard selects final available time');if(key==='Enter')await until(`document.getElementById(${JSON.stringify(pickupId)}).innerText==='22:00'`,'Keyboard choice is saved');}
  assert.equal(await c.evaluate(`document.getElementById(${JSON.stringify(pickupId)}).innerText`),'22:00','Keyboard selection must work');
  for(const width of [1440,390]){
   await c.cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
   await ensureTimePickers();pickupId=await timePickerId(0);
   await until(`!document.getElementById(${JSON.stringify(pickupId)}).disabled`,'Saved time availability settles');
   await c.evaluate(`document.getElementById(${JSON.stringify(pickupId)}).scrollIntoView({block:'center',behavior:'instant'});document.getElementById(${JSON.stringify(pickupId)}).focus();document.getElementById(${JSON.stringify(pickupId)}).click()`);await delay(200);
   assert.equal(await c.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
   const geometry=await c.evaluate(`(()=>{const e=document.querySelector('[role=listbox]').parentElement,r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight}})()`);assert(geometry.left>=0&&geometry.right<=geometry.w&&geometry.top>=0&&geometry.bottom<=geometry.h);
   const shot=await c.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(output+'/time-picker-'+width+'.png',Buffer.from(shot.data,'base64'));
   await c.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await c.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
   await until(`!document.querySelector('[role=listbox]')`,'Escape closes time choices');
   assert.equal(await c.evaluate(`!!document.querySelector('[role=listbox]')`),false);
  }
  console.log('PASS real checkout: signature preserves terms; signed-detail changes invalidate signature only; date edits clear old times; saved terms and time selections restore; no saved signature; custom picker keyboard/Escape/desktop/mobile placement. No payment submitted.');
 }catch(e){failure=e;console.error(e.message);console.error(await c.evaluate("JSON.stringify({title:document.title,url:location.href,cart:localStorage.getItem('dbc_cart_v1'),seed:sessionStorage.getItem('draft-browser-seeded'),errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.innerText),sig:!!document.getElementById('co-sig'),due:document.querySelector('[data-testid=checkout-due]')?.innerText,tail:document.querySelector('main')?.innerText.slice(-1200)})"));const shot=await c.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(output+'/failure.png',Buffer.from(shot.data,'base64'))}finally{c.close();await fetch(`${process.env.DBC_CDP_URL||'http://localhost:9224'}/json/close/${c.tabId}`)}
 if(failure)throw failure;
})().catch(e=>{console.error(e.stack);process.exitCode=1});
