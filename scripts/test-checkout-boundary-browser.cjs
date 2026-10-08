/** Actual checkout boundary choices and persisted basket; never submits payment. */
const fs=require('node:fs'),assert=require('node:assert/strict');
process.env.DBC_CDP_URL??='http://localhost:9227';
const root=require('node:path').resolve(__dirname,'..'),art=process.env.DBC_CHECKOUT_SCREENSHOTS||'/tmp/dbc-boundary-times';
const src=fs.readFileSync(root+'/scripts/test-membership-browser.cjs','utf8');
const connect=new Function('require',src.slice(0,src.indexOf('const { ConvexHttpClient }'))+';return connect;')(require);
const {ConvexHttpClient}=require(root+'/node_modules/convex/browser'),{api}=require(root+'/convex/_generated/api.js');
const backend=process.env.DBC_CONVEX_URL||'https://deafening-stoat-340.convex.cloud',base=process.env.DBC_CHECKOUT_ROOT||'http://localhost:41935',client=new ConvexHttpClient(backend),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const version=await(await fetch(process.env.DBC_CDP_URL+'/json/version')).json(),ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let next=0;const pending=new Map();ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);pending.delete(r.id);r.error?p?.reject(Error(r.error.message)):p?.resolve(r.result)}});
 const browser=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const context=await browser('Target.createBrowserContext');let c;
 try{
  const target=await browser('Target.createTarget',{url:'about:blank',browserContextId:context.browserContextId});c=await connect(null,target.targetId);await c.cmd('Page.enable');await c.cmd('Runtime.enable');c.on(m=>{if(m.method==='Runtime.exceptionThrown')console.error(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)});

  fs.mkdirSync(art,{recursive:true});
  const result=await client.query(api.catalog.listListings,{}),rows=(Array.isArray(result)?result:result.items??result.listings??[]).filter(x=>x.pricing&&!x.marketingOnly&&!x.displayOnly);
  const future=new Date(Date.now()+90*86400000),date=Date.UTC(future.getUTCFullYear(),future.getUTCMonth(),future.getUTCDate()),dateString=new Date(date).toISOString().slice(0,10);
  let listing,slots;
  for(const candidate of rows){const s=await client.query(api.availability.forTimeSlots,{listingId:candidate._id,start:date,end:date,pickupTime:'18:00',returnTime:'20:00',items:[]});if(s.validPairs?.some(p=>p.pickupTime==='21:00'&&p.returnTime==='22:00')&&s.pickupBoundarySlots?.includes('22:00')&&s.returnBoundarySlots?.includes('09:00')){listing=candidate;slots=s;break}}
  assert(listing,'Requires a real available listing with independently free boundary times');
  async function until(expr,label){for(let i=0;i<200;i++){if(await c.evaluate(expr))return;await delay(200)}throw Error(label)}
  await c.cmd('Page.navigate',{url:base+'/checkout'});await until(`document.querySelector('main')&&location.pathname==='/checkout'`,'Checkout loads');
  const item={key:listing._id+':boundary-proof',listingId:listing._id,slug:listing.slug,title:listing.title,heroImage:listing.heroImage??null,start:dateString,end:dateString,pickupTime:'18:00',returnTime:'20:00',days:1,perDay:listing.pricing.daily,total:listing.pricing.daily,deposit:listing.depositAmount};
  await c.evaluate(`localStorage.setItem('dbc_cart_v1',${JSON.stringify(JSON.stringify([item]))});localStorage.removeItem('dbc_membership_selection_v1');true`);await c.cmd('Page.reload');
  const picker=n=>`document.querySelectorAll('[data-checkout-item-times] [role=combobox]')[${n}]`;
  async function ready(){await until(`${picker(0)}&&!${picker(0)}.disabled`,'Item time controls settle')}
  async function select(n,time){await ready();await c.evaluate(`${picker(n)}.click()`);await until(`!!document.querySelector('[role=listbox]')`,'Time choices open');assert.equal(await c.evaluate(`[...document.querySelectorAll('[role=option]')].find(e=>e.textContent===${JSON.stringify(time)})?.getAttribute('aria-disabled')`),'false',`${time} is stock-free independently of clock ordering`);await c.evaluate(`[...document.querySelectorAll('[role=option]')].find(e=>e.textContent===${JSON.stringify(time)}).click()`)}
  await select(0,'21:00');await until(`JSON.parse(localStorage.getItem('dbc_cart_v1'))[0].pickupTime==='21:00'&&JSON.parse(localStorage.getItem('dbc_cart_v1'))[0].returnTime==='22:00'`,'Return auto-adjusts after changed pickup');assert(await c.evaluate(`document.body.innerText.includes('Return moved to 22:00')`),'Adjustment is visibly announced');
  await select(1,'09:00');await until(`document.querySelector('[data-checkout-item-times]').innerText.includes('Return must be later than pickup')`,'Clock ordering is explained separately');assert.equal(await c.evaluate(`document.querySelector('main').innerText.includes('Some gear is unavailable')`),false,'Order is not reported as unavailable stock');assert.equal(await c.evaluate(`JSON.parse(localStorage.getItem('dbc_cart_v1'))[0].returnTime`),'09:00');
  await select(0,'22:00');await until(`JSON.parse(localStorage.getItem('dbc_cart_v1'))[0].pickupTime==='22:00'&&document.querySelector('[data-checkout-item-times]').innerText.includes('change the return date')`,'Last free pickup needs a later return date, not a false stock block');
  await select(0,'18:00');await until(`JSON.parse(localStorage.getItem('dbc_cart_v1'))[0].returnTime==='19:00'`,'Only invalid order is adjusted to a valid pair');
  await c.cmd('Page.reload');await ready();assert.equal(await c.evaluate(`JSON.parse(localStorage.getItem('dbc_cart_v1'))[0].pickupTime`),'18:00');assert.equal(await c.evaluate(`JSON.parse(localStorage.getItem('dbc_cart_v1'))[0].returnTime`),'19:00');
  const screenshots=[];
  for(const width of [1440,390]){await c.cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await c.evaluate(`document.querySelector('[data-checkout-item-times]').scrollIntoView({block:'center',behavior:'instant'})`);await delay(200);await c.evaluate(`${picker(0)}.click()`);await until(`!!document.querySelector('[role=listbox]')`,'Choices open');assert.equal(await c.evaluate(`document.documentElement.scrollWidth>innerWidth`),false);const shot=await c.cmd('Page.captureScreenshot',{format:'png'}),path=art+'/boundary-times-'+width+'.png';fs.writeFileSync(path,Buffer.from(shot.data,'base64'));screenshots.push(path);await c.evaluate(`${picker(0)}.click()`)}
  const receipt={result:'PASS',checkedAt:new Date().toISOString(),base,backend,listingId:listing._id,date:dateString,independentBoundarySlots:true,automaticReturnAdjustmentVisible:true,orderErrorSeparate:true,lastPickupSelectable:true,persistedAfterReload:true,desktopMobileNoOverflow:true,paymentSubmitted:false,accountOrCustomerCreated:false,screenshots};fs.writeFileSync(art+'/boundary-times-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
 }finally{c?.close();await browser('Target.disposeBrowserContext',{browserContextId:context.browserContextId});ws.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
