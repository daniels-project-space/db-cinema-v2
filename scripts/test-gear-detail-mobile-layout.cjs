const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),root=path.resolve(__dirname,'..'),rootRequire=require('node:module').createRequire(path.join(root,'package.json'));
const esbuild=rootRequire('esbuild'),postcss=rootRequire('postcss');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const listing={_id:'fixture-arri',slug:'arri-alexa-mini-lf',title:'ARRI Alexa Mini LF cinema camera',category:'Cameras',heroImage:'/arri-deconstruct-poster.jpg',gallery:['/arri-deconstruct-poster.jpg','/arri-deconstruct-poster.jpg'],pricing:{daily:240,tiers:[{days:3,perDay:210,label:'3 days'},{days:7,perDay:180,label:'7 days'}]},depositAmount:0,minimumRentalDays:1,unavailableDates:[],description:'A compact professional cinema camera for documentary, commercial and narrative shoots across London.',bookable:true,demandScore:20,knowledge:{features:['Large format sensor','ProRes and raw capture','Fast on-set configuration'],bestFor:['Narrative','Commercial'],tips:['Check media and batteries before collection']}};
const stubs={
 '@/components/SiteHeader':`export function SiteHeader(){return <header className="sticky top-0 z-30 flex h-12 items-center border-b border-white/10 bg-black px-4 text-sm text-white">DB CINEMA <span className="ml-3 text-white/45">Gear · How it works</span></header>}`,
 '@/components/Recommendations':`export function Recommendations(){return null}`,
 '@/components/booking/RentalContentsList':`export function RentalContentsList(){return <div className="mt-5 rounded-xl border border-white/10 p-3 text-xs text-white/55">Included: body, top handle, charger and media case</div>}`,
 '@/components/gaffer/GafferFocus':`export function useGafferFocus(){return{focusedId:null}}`,
 '@/components/SmartImage':`export function SmartImage({src,alt='',className='',imgClassName=''}){return <div className={className}><img src={src||'/arri-deconstruct-poster.jpg'} alt={alt} className={'h-full w-full object-contain '+imgClassName}/></div>}`,
 '@/components/icons':`export const IconCheck=({className=''})=><span className={className} aria-hidden="true">✓</span>;export const IconChevronLeft=({className=''})=><span className={className} aria-hidden="true">‹</span>;export const IconChevronRight=({className=''})=><span className={className} aria-hidden="true">›</span>;export const IconX=({className=''})=><span className={className} aria-hidden="true">×</span>;`,
 '@/components/account/AccountProvider':`export function useAccount(){return{token:null,me:null}}`,
 '@/components/cart/CartProvider':`export function useCart(){return{items:[],add:()=>{window.__added=true},remove:()=>{}}}`,
 './useCalendarStock':`export function useCalendarStock(){return{ready:true,error:null,unavailable:new Set(),partial:new Set(),retry:async()=>{}}}`,
 '@/lib/dateSelection':`export function pickRentalDates(start,end,day){if(!start||end)return{start:day,end:null};return start<=day?{start,end:day}:{start:day,end:start}};export function crossesUnavailableDate(){return false}`,
 'next/link':`export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
};
(async()=>{
 const escaped=s=>s.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&');
 const plugin={name:'synthetic-gear-detail',setup(build){
  build.onResolve({filter:/^convex\/react$/},()=>({path:'convex-react',namespace:'fixture'}));build.onLoad({filter:/^convex-react$/,namespace:'fixture'},()=>({loader:'js',contents:`export const useQuery=(ref,args)=>window.__query(ref,args);export const useMutation=()=>async()=>null;`}));
  build.onResolve({filter:/^@cvx\/_generated\/api$/},()=>({path:'api',namespace:'fixture'}));build.onLoad({filter:/^api$/,namespace:'fixture'},()=>({loader:'js',contents:`export const api=new Proxy({}, {get:(_,ns)=>new Proxy({}, {get:(_,name)=>String(ns)+'.'+String(name)})});`}));
  build.onResolve({filter:/^next\/link$/},()=>({path:'next-link',namespace:'fixture'}));build.onLoad({filter:/^next-link$/,namespace:'fixture'},()=>({loader:'jsx',resolveDir:root,contents:stubs['next/link']}));
  for(const [spec,contents] of Object.entries(stubs))if(spec!=='next/link')build.onResolve({filter:new RegExp('^'+escaped(spec)+'$')},()=>({path:spec,namespace:'fixture'})),build.onLoad({filter:new RegExp('^'+escaped(spec)+'$'),namespace:'fixture'},()=>({loader:'jsx',resolveDir:root,contents}));
 }};
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-gear-detail-'));
 const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import GearDetailClient from './src/app/gear/[slug]/GearDetailClient';createRoot(document.getElementById('root')).render(<GearDetailClient slug="arri-alexa-mini-lf" initialListing={window.fixtureListing}/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,outdir:path.join(temp,'bundle'),platform:'browser',format:'iife',jsx:'automatic',loader:{'.module.css':'local-css'},tsconfig:path.join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[plugin]});
 const js=bundle.outputFiles.find(x=>x.path.endsWith('.js')).text;
 const css=await postcss([rootRequire('@tailwindcss/postcss')({base:root})]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')});
 const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(js)}if(req.url==='/style.css'){res.setHeader('content-type','text/css');return res.end(css.css)}if(req.url==='/arri-deconstruct-poster.jpg'){res.setHeader('content-type','image/jpeg');return res.end(fs.readFileSync(path.join(root,'public/arri-deconstruct-poster.jpg')))}res.setHeader('content-type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><style>html,body{margin:0;background:#09090a;color:#eee}*{box-sizing:border-box}</style><div id="root"></div><script>window.fixtureListing=${JSON.stringify(listing)};window.__query=(ref,args)=>ref==='catalog.getListingBySlug'?window.fixtureListing:ref==='reviews.stats'?{average:4.73,count:34}:ref==='settings.get'?{setupIntentSecurityEnabled:true}:ref==='availability.forCart'?{'fixture-arri':{ok:true,available:1}}:undefined</script><script src="/bundle.js"></script>`)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const profile=path.join(temp,'chrome');const chrome=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{stdio:'ignore'});let browser;
 try{let port;for(let n=0;n<100&&!port;n++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{await wait(80)}}if(!port)throw Error('Chromium CDP failed');process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;const s=fs.readFileSync(path.join(root,'scripts/test-membership-browser.cjs'),'utf8');const connect=new Function('require',s.slice(0,s.indexOf('const { ConvexHttpClient'))+';return connect;')(require);browser=await connect('about:blank');await browser.cmd('Page.enable');await browser.cmd('Runtime.enable');await browser.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});for(let n=0;n<100&&!await browser.evaluate(`!!document.querySelector('[data-listing-id] h1')`);n++)await wait(60);const out='/tmp/dbc-mobile-product-detail';fs.mkdirSync(out,{recursive:true});
  for(const [width,height] of [[320,640],[390,844],[430,932],[768,900],[1024,900],[1440,900]]){
    if(width!==320){await browser.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await wait(180)}
    await browser.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});
    await browser.evaluate('window.scrollTo(0,0)');await wait(900);
    const metrics=await browser.evaluate(`(()=>{const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,display:getComputedStyle(e).display}};const book=document.querySelector('#rental-booking-panel'),bar=rect('[data-testid="mobile-booking-jump-bar"]'),hero=document.querySelector('[data-listing-id] .spot.gradient-border img');return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,title:rect('h1'),gallery:rect('[data-listing-id] .spot.gradient-border'),share:rect('[data-testid="listing-share-button"]'),imageLoaded:!!hero&&hero.complete&&hero.naturalWidth>0,booking:rect('#rental-booking-panel'),mobileBar:bar,barVisible:!!bar&&bar.display!=='none'}})()`);
    assert(metrics.scrollWidth<=width,`No horizontal overflow at ${width}px: ${JSON.stringify(metrics)}`);
    assert(metrics.imageLoaded,`The actual listing image loads at ${width}px`);
    assert(metrics.share&&metrics.share.height>=44,`The listing share action has a 44px touch target at ${width}px: ${JSON.stringify(metrics.share)}`);
    if(width<1024){assert(metrics.barVisible,`The mobile booking shortcut remains available at ${width}px`);assert(metrics.title.bottom<=metrics.mobileBar.top,`The sticky booking bar does not cover the product title at ${width}px: ${JSON.stringify(metrics)}`);}
    else assert.equal(metrics.barVisible,false,'Desktop uses the booking panel without a mobile sticky bar');
    const shot=await browser.cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(out,`detail-${width}x${height}-top.png`),Buffer.from(shot.data,'base64'));
    if(width<768){
      await browser.evaluate(`document.querySelector('[data-testid="mobile-booking-jump"]')?.click()`);await wait(500);
      const targets=await browser.evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{width:r.width,height:r.height,left:r.left,right:r.right}};return{days:[...document.querySelectorAll('[data-testid="calendar-day"]')].map(rect),previous:rect(document.querySelector('[data-testid="calendar-previous-month"]')),next:rect(document.querySelector('[data-testid="calendar-next-month"]')),scrollWidth:document.documentElement.scrollWidth}})()`);
      assert(targets.days.length>0&&targets.days.every(r=>r.width>=44&&r.height>=44),`Phone calendar days provide 44×44px+ touch targets at ${width}px: ${JSON.stringify(targets)}`);
      assert(targets.previous.width>=44&&targets.previous.height>=44&&targets.next.width>=44&&targets.next.height>=44,`Phone month controls are at least 44×44px at ${width}px: ${JSON.stringify(targets)}`);
      assert(targets.scrollWidth<=width,`Expanded date targets do not cause horizontal overflow at ${width}px: ${JSON.stringify(targets)}`);
      const calendarShot=await browser.cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      fs.writeFileSync(path.join(out,`detail-${width}x${height}-calendar.png`),Buffer.from(calendarShot.data,'base64'));
      console.log(`CALENDAR TARGETS ${width}px ${JSON.stringify({day:targets.days[0],previous:targets.previous,next:targets.next,scrollWidth:targets.scrollWidth})}`);
    }
    console.log(`DETAIL ${width}px ${JSON.stringify(metrics)}`);
  }
  await browser.cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:844,deviceScaleFactor:1,mobile:false});
  await browser.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await wait(180);
  await browser.evaluate(`document.querySelectorAll('[data-testid="calendar-day"]:not(:disabled)')[0].click()`);await wait(50);
  await browser.evaluate(`document.querySelectorAll('[data-testid="calendar-day"]:not(:disabled)')[1].click()`);await wait(80);
  const desktopTerms=await browser.evaluate(`(()=>{const details=document.querySelector('[data-testid="desktop-security-details"]'),mobile=document.querySelector('[data-testid="mobile-security-details"]');return{detailsVisible:!!details&&getComputedStyle(details).display!=='none',mobileHidden:!!mobile&&getComputedStyle(mobile).display==='none',hasFullPolicy:details?.innerText.includes('Saved-card future-claim ceiling')}})()`);
  assert(desktopTerms.detailsVisible&&desktopTerms.mobileHidden&&desktopTerms.hasFullPolicy,`At 1440px the original full policy card stays visible and the phone disclosure stays hidden: ${JSON.stringify(desktopTerms)}`);
  fs.writeFileSync(path.join(out,'detail-1440-selected-dates.png'),Buffer.from((await browser.cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
  await browser.cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await browser.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});await wait(180);
  const gafferPrompt=await browser.evaluate(`(()=>{let detail=null;window.addEventListener('dbc:open-gaffer-chat',event=>{detail=event.detail},{once:true});document.querySelector('[data-testid="mobile-gaffer-trigger"]')?.click();return detail})()`);
  assert.equal(gafferPrompt?.prompt,`Tell me about ${listing.title}`,'The Gaffer control in the mobile booking bar opens a prompt for the current listing');
  await browser.evaluate(`document.querySelector('[data-testid="mobile-booking-jump"]')?.click()`);await wait(800);
  const jump=await browser.evaluate(`(()=>{const panel=document.querySelector('#rental-booking-panel'),bar=document.querySelector('[data-testid="mobile-booking-jump-bar"]');const rect=panel?.getBoundingClientRect();return{focused:document.activeElement===panel,top:rect?.top,bottom:rect?.bottom,barVisible:!!bar&&getComputedStyle(bar).display!=='none'}})()`);
  assert(jump.focused&&jump.top<844&&jump.bottom>0&&jump.barVisible,`The sticky button scrolls to the date panel and stays available while its Add to kit action is below the fold: ${JSON.stringify(jump)}`);
  fs.writeFileSync(path.join(out,'detail-390-booking-panel.png'),Buffer.from((await browser.cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
  console.log(`BOOKING JUMP ${JSON.stringify(jump)}`);
  const selectableDays=await browser.evaluate(`document.querySelectorAll('[data-testid="calendar-day"]:not(:disabled)').length`);
  assert(selectableDays>=2,`The synthetic calendar exposes two selectable rental days: ${selectableDays}`);
  await browser.evaluate(`document.querySelectorAll('[data-testid="calendar-day"]:not(:disabled)')[0].click()`);await wait(50);
  await browser.evaluate(`document.querySelectorAll('[data-testid="calendar-day"]:not(:disabled)')[1].click()`);await wait(80);
  const selected=await browser.evaluate(`(()=>{const panel=document.querySelector('#rental-booking-panel'),add=panel.querySelector('[data-testid="booking-add-to-kit"]'),card=add?.closest('.spot.gradient-border'),priceText=card?.innerText||'',bar=document.querySelector('[data-testid="mobile-booking-jump-bar"]'),rect=e=>{const r=e?.getBoundingClientRect();return r&&{top:r.top,bottom:r.bottom,height:r.height}};return{width:innerWidth,scrollY,viewportHeight:innerHeight,panel:rect(panel),priceCard:rect(card),add:rect(add),addEnabled:!!add&&!add.disabled,priceVisible:/Rental total/.test(priceText),securitySummary:panel.querySelector('details summary')?.innerText,stickyAction:bar?.querySelector('[data-testid="mobile-booking-jump"]')?.innerText,barVisible:!!bar&&getComputedStyle(bar).display!=='none',rentalTotal:(priceText.match(/£\\d+/g)||[]).slice(0,3)}})()`);
  assert(selected.addEnabled&&selected.priceVisible,`Selecting dates reveals a price and an enabled Add to kit action without removing the date controls: ${JSON.stringify(selected)}`);
  assert(selected.barVisible&&selected.stickyAction==='Review price & add',`The mobile booking shortcut stays available until the primary action is safely in view: ${JSON.stringify(selected)}`);
  assert(selected.securitySummary?.includes('Deposit & card authorisation'),`Full security wording is disclosed under an explicit, one-line summary: ${JSON.stringify(selected)}`);
  const mobileTerms=await browser.evaluate(`(()=>{const details=document.querySelector('[data-testid="mobile-security-details"]'),desktop=document.querySelector('[data-testid="desktop-security-details"]');details.open=true;const result={detailsVisible:getComputedStyle(details).display!=='none',desktopHidden:getComputedStyle(desktop).display==='none',fullCopy:details.innerText.includes('Stripe saves your card')&&details.innerText.includes('The ceiling is never charged')};details.open=false;return result})()`);
  assert(mobileTerms.detailsVisible&&mobileTerms.desktopHidden&&mobileTerms.fullCopy,`The phone disclosure preserves the complete security copy without changing checkout agreement: ${JSON.stringify(mobileTerms)}`);
  fs.writeFileSync(path.join(out,'detail-390-selected-dates.png'),Buffer.from((await browser.cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
  console.log(`SELECTED DATES ${JSON.stringify(selected)}`);
  await browser.evaluate(`document.querySelector('[data-testid="mobile-booking-jump"]')?.click()`);await wait(600);
  const actionView=await browser.evaluate(`JSON.stringify((()=>{const add=document.querySelector('#rental-booking-panel [data-testid=booking-add-to-kit]'),bar=document.querySelector('[data-testid="mobile-booking-jump-bar"]'),r=add.getBoundingClientRect();return{focused:document.activeElement===add,top:r.top,bottom:r.bottom,visibleBottom:innerHeight-72,barVisible:!!bar&&getComputedStyle(bar).display!=='none'}})())`).then(JSON.parse);
  assert(actionView.focused&&actionView.top>=0&&actionView.bottom<=actionView.visibleBottom&&!actionView.barVisible,`Review price & add scrolls to and focuses the enabled action, then clears the shortcut only when safe: ${JSON.stringify(actionView)}`);
  fs.writeFileSync(path.join(out,'detail-390-add-visible.png'),Buffer.from((await browser.cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
  const added=await browser.evaluate(`(()=>{const add=[...document.querySelectorAll('#rental-booking-panel button')].find(b=>['Add to kit','Add request to kit'].includes(b.textContent.trim()));if(!add)return{error:'Add to kit action missing'};const enabled=!add.disabled;if(enabled)add.click();return{enabled,clicked:enabled,text:add.textContent.trim()}})()`);
  assert(added.enabled&&added.clicked&&added.text==='Add to kit',`Selecting available dates enables the normal add-to-kit action in the isolated fixture: ${JSON.stringify(added)}`);
  await wait(80);assert.equal(await browser.evaluate('window.__added===true'),true,'The add-to-kit action reaches the isolated cart callback; no network service is called');
  console.log(`ADD TO KIT ${JSON.stringify(added)}`);
  console.log(`Screenshots: ${out}`);
 }finally{if(browser){browser.close();await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(()=>{})}if(chrome.exitCode===null){const done=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await done}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
