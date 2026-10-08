/** Real Next checkout navigation/React/price refresh; read-only catalogue and quotes. Never submits payment. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..');
const src=fs.readFileSync(root+'/scripts/test-membership-browser.cjs','utf8');
const connect=new Function('require',src.slice(0,src.indexOf('const { ConvexHttpClient }'))+'\nreturn connect;')(require);
const {ConvexHttpClient}=require('convex/browser'),{api}=require('../convex/_generated/api.js');
const base=process.env.DBC_CHECKOUT_ROOT||'http://localhost:41848';
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
 async function navigate(path){const epoch=await c.evaluate('performance.timeOrigin');await c.cmd('Page.navigate',{url:base+path});await until(`performance.timeOrigin!==${epoch}&&document.readyState==='complete'`,'New checkout document');await ready();}
 try{
  await c.cmd('Page.enable');await c.cmd('Network.enable');await c.cmd('Network.setBlockedURLs',{urls:['*.mp4*','*.webm*','*.mov*']});
  await c.cmd('Page.navigate',{url:base+'/gear'});
  await until(`(document.body?.innerText.length??0)>100`,'Application must render');
  await c.evaluate(`sessionStorage.clear()`);
  await c.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(new URL(base).origin)}&&location.pathname==='/checkout'&&!sessionStorage.getItem('draft-browser-seeded')){localStorage.removeItem('dbc_acct');localStorage.removeItem('dbc_membership_selection_v1');localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify(cart))});sessionStorage.setItem('draft-browser-seeded','1')}`});
  await navigate('/checkout');
  await fill('co-email','draft-review@example.invalid');await fill('co-name','Draft Review Renter');await fill('co-phone','07000000000');await fill('co-billing-address','123 Fixture Street, London SW1A 1AA');await ready();
  for(const [id,time] of [['co-time-out','10:00'],['co-time-back','18:00']]){
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
  await c.evaluate(`[...document.querySelectorAll('button')].find(e=>e.innerText.includes('Full-value card hold')).click()`);await ready();
  assert.equal(await c.evaluate(`document.querySelector('[data-testid=rental-agreement-checkbox]').checked`),true);
  await fill('co-sig','Draft Review Renter');
  await c.cmd('Page.navigate',{url:base+'/cart'});await until(`(document.body?.innerText??'').includes(${JSON.stringify(listing.title)})`,'Actual basket must render');
  await c.evaluate(`(()=>{const items=JSON.parse(localStorage.getItem('dbc_cart_v1'));items[0].end=${JSON.stringify(new Date(end+86400000).toISOString().slice(0,10))};items[0].days=4;localStorage.setItem('dbc_cart_v1',JSON.stringify(items));})()`);
  await navigate('/checkout');
  assert.deepEqual(await c.evaluate(`['co-email','co-name','co-phone','co-billing-address','co-sig'].map(id=>document.getElementById(id).value)`),['draft-review@example.invalid','Draft Review Renter','07111111111','123 Fixture Street, London SW1A 1AA','']);
  assert.equal(await c.evaluate(`document.querySelector('[data-testid=rental-agreement-checkbox]').checked`),true,'Terms survive basket changes and fresh quote');
  assert.equal(await c.evaluate(`document.getElementById('co-time-out').innerText`),'10:00');
  assert.equal(await c.evaluate(`document.getElementById('co-time-back').innerText`),'18:00');
  assert.equal(await c.evaluate(`[...document.querySelectorAll('button')].find(e=>e.innerText.includes('Full-value card hold')).className.includes('border-accent-400')`),true,'Protection selection must survive basket changes');
  const stored=await c.evaluate(`sessionStorage.getItem('dbc_checkout_draft_v1:guest')`);assert(stored&&!stored.includes('signature')&&!stored.includes('requestId'));
  const epoch=await c.evaluate('performance.timeOrigin');await c.cmd('Page.reload');await until(`performance.timeOrigin!==${epoch}&&document.readyState==='complete'`,'Reloaded checkout document');await ready();assert.equal(await c.evaluate(`document.querySelector('[data-testid=rental-agreement-checkbox]').checked`),true);
  assert.equal(await c.evaluate(`document.getElementById('co-sig').value`),'');
  await c.evaluate(`document.getElementById('co-time-out').focus()`);
  for(const key of ['ArrowDown','End','Enter']){await c.cmd('Input.dispatchKeyEvent',{type:'keyDown',key});await c.cmd('Input.dispatchKeyEvent',{type:'keyUp',key});}
  assert.equal(await c.evaluate(`document.getElementById('co-time-out').innerText`),'22:00','Keyboard selection must work');
  for(const width of [1440,390]){
   await c.cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
   await c.evaluate(`document.getElementById('co-time-out').scrollIntoView({block:'center',behavior:'instant'});document.getElementById('co-time-out').click()`);await delay(200);
   assert.equal(await c.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
   const geometry=await c.evaluate(`(()=>{const e=document.querySelector('[role=listbox]').parentElement,r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight}})()`);assert(geometry.left>=0&&geometry.right<=geometry.w&&geometry.top>=0&&geometry.bottom<=geometry.h);
   const shot=await c.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(output+'/time-picker-'+width+'.png',Buffer.from(shot.data,'base64'));
   await c.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await c.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
   assert.equal(await c.evaluate(`!!document.querySelector('[role=listbox]')`),false);
  }
  console.log('PASS real checkout: signature preserves terms; signed-detail changes invalidate signature only; basket/date change and reload preserve details/times/terms; no saved signature; custom picker keyboard/Escape/desktop/mobile placement. No payment submitted.');
 }catch(e){failure=e;console.error(e.message);console.error(await c.evaluate("JSON.stringify({title:document.title,url:location.href,cart:localStorage.getItem('dbc_cart_v1'),seed:sessionStorage.getItem('draft-browser-seeded'),errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.innerText),sig:!!document.getElementById('co-sig'),due:document.querySelector('[data-testid=checkout-due]')?.innerText,tail:document.querySelector('main')?.innerText.slice(-1200)})"));const shot=await c.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(output+'/failure.png',Buffer.from(shot.data,'base64'))}finally{c.close();await fetch(`${process.env.DBC_CDP_URL||'http://localhost:9224'}/json/close/${c.tabId}`)}
 if(failure)throw failure;
})().catch(e=>{console.error(e.stack);process.exitCode=1});
