const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
const helper = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", helper.slice(0, helper.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);
const { formatRate, quote } = require("./lib/rentalTestHarness.cjs").load("src/lib/pricing.ts");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const listings = [
  { _id: "camera-sony-fx3", slug: "sony-fx3", title: "Sony FX3 cinema camera", category: "Cameras", itemType: "camera", isPackage: false, heroImage: "/arri-deconstruct-poster.jpg", imageSources: ["/images/home/maintained-cinema-gear-20261028.webp"], pricing: { daily: 150, day3: 130, day7: 110 }, depositAmount: 50, minimumRentalDays: 1, displayOnly: false, bookable: true },
  { _id: "lens-sony-2470", slug: "sony-24-70-lens", title: "Sony 24–70mm f/2.8 G Master lens", category: "Lenses", itemType: "lens", isPackage: false, heroImage: "/images/home/maintained-cinema-gear-20261028.webp", imageSources: ["/arri-deconstruct-poster.jpg"], pricing: { daily: 70, day3: 60, day7: 50 }, depositAmount: 20, minimumRentalDays: 1, displayOnly: false, bookable: true },
  { _id: "lens-canon-2470", slug: "canon-24-70-lens", title: "Canon 24–70mm f/2.8 L lens", category: "Lenses", itemType: "lens", isPackage: false, heroImage: "/arri-deconstruct-poster.jpg", imageSources: ["/images/home/maintained-cinema-gear-20261028.webp"], pricing: { daily: 55, day3: 48, day7: 42 }, depositAmount: 20, minimumRentalDays: 1, displayOnly: false, bookable: true },
  { _id: "light-nanlite-30x", slug: "nanlite-pavotube-30x", title: "Nanlite PavoTube 30X II light kit", category: "Lighting", itemType: "lighting", isPackage: false, heroImage: "/images/home/maintained-cinema-gear-20261028.webp", imageSources: ["/arri-deconstruct-poster.jpg"], pricing: { daily: 95, day3: 85, day7: 75 }, depositAmount: 50, minimumRentalDays: 1, displayOnly: false, bookable: true },
  { _id: "audio-rode-ntg", slug: "rode-ntg", title: "RØDE NTG microphone kit", category: "Audio", itemType: "audio", isPackage: false, heroImage: "/arri-deconstruct-poster.jpg", imageSources: ["/images/home/maintained-cinema-gear-20261028.webp"], pricing: { daily: 45, day3: 40, day7: 35 }, depositAmount: 20, minimumRentalDays: 1, displayOnly: false, bookable: true },
  { _id: "package-sony-crew", slug: "sony-fx3-camera-kit", title: "Sony FX3 complete camera kit", category: "Packages", itemType: "package", isPackage: true, heroImage: "/images/home/maintained-cinema-gear-20261028.webp", imageSources: ["/arri-deconstruct-poster.jpg"], pricing: { daily: 280, day3: 240, day7: 210 }, depositAmount: 100, minimumRentalDays: 1, displayOnly: false, bookable: true },
];

const categories = ["Cameras", "Lenses", "Lighting", "Audio", "Packages"].map(name => ({ name, count: listings.filter(item => item.category === name).length }));
const aliases = new Map([
  ["next/link", `import React from "react";export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`],
  ["next/navigation", `import React from "react";export function useSearchParams(){const search=React.useSyncExternalStore(cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)},()=>window.location.search,()=>window.location.search);return new URLSearchParams(search)}export function useRouter(){return{push(url){window.history.pushState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'))},replace(url){window.history.replaceState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'))}}}`],
  ["convex/react", `export function useQuery(ref,args){const key=String(ref),items=window.__listings??[];window.__catalogCalls?.push({key,args});if(key==='catalog.categories')return window.__categories;if(key==='catalog.bestSellers')return[];if(key==='catalog.listingsByIds')return args==='skip'?undefined:items.filter(item=>args?.ids?.includes(item._id));if(key==='catalog.listListings'){if(args==='skip')return undefined;return items.filter(item=>item.active!==false&&!item.suppressed&&(!args?.category||item.category===args.category)&&(!args?.search||item.title.toLowerCase().includes(args.search.toLowerCase())))}return undefined}const track=async value=>{window.__analytics.push(value)};export function useMutation(){return track}`],
  ["@cvx/_generated/api", `export const api=new Proxy({}, {get:(_,namespace)=>new Proxy({}, {get:(_,name)=>String(namespace)+'.'+String(name)})})`],
  ["@/components/gaffer/GafferFocus", `export function useGafferFocus(){return{focusedId:null,suggestedIds:[]}}`],
  ["@/components/account/AccountProvider", `export function useAccount(){return{me:null,toggleFavorite(){}}}`],
  ["@/components/SmartImage", `import React from 'react';export function SmartImage({src,fallbackSources=[],alt='',className='',imgClassName='',fit='contain',loading='lazy'}){return <div className={'relative overflow-hidden bg-charcoal-800 '+className}>{src?<img src={src} alt={alt} loading={loading} style={{objectFit:fit}} className={'absolute inset-0 h-full w-full '+imgClassName}/>:<img src={fallbackSources[0]} alt={alt} className='h-full w-full object-contain'/>}</div>}`],
  ["@/components/icons", `import React from 'react';const make=(label)=>props=><svg {...props} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' aria-label={label}><circle cx='10' cy='10' r='6'/><path d='m14.5 14.5 5 5'/></svg>;export const IconSearch=make('Search'),IconHeart=()=>null,IconCheck=()=>null`],
  ["@/components/AssemblyShowcase", `import React from 'react';export function AssemblyShowcase(){return <section data-testid='assembly-showcase' className='mx-auto mt-4 max-w-6xl rounded-xl border border-white/10 p-4 text-xs text-white/50'>Build a kit from compatible gear</section>}`],
  ["@/components/HireProfessionals", `export function HireProfessionals(){return null}`],
  ["@/components/SiteHeader", `import React from 'react';export function SiteHeader(){const[open,setOpen]=React.useState(false);return <><header className='sticky top-0 z-40 flex min-h-[68px] items-center justify-between border-b border-white/10 bg-black px-3 py-3 text-sm text-white sm:px-4'><a href='/' className='shrink-0 font-semibold'>DB CINEMA</a><nav className='ml-auto flex shrink-0 items-center gap-2 sm:gap-2.5'><div className='hidden items-center gap-4 md:flex'><a href='/gear'>Gear</a><a href='/guides'>Guides</a><a href='/contact'>Contact</a></div><a href='/account' aria-label='Account' className='grid h-10 w-10 place-items-center rounded-full border border-white/10'>A</a><button type='button' aria-label='Open kit' className='min-h-11 rounded-full border border-white/10 px-3'>Kit</button><button type='button' aria-label='Open menu' aria-expanded={open} onClick={()=>setOpen(!open)} className='h-11 w-11 rounded-full border border-white/10'>☰</button></nav></header>{open&&<nav aria-label='Mobile menu' className='absolute right-3 top-16 z-50 grid gap-3 rounded-xl border border-white/10 bg-black p-4 md:hidden'><a href='/gear'>Gear</a><a href='/membership'>Subscriptions</a><a href='/how-it-works'>How it works</a></nav>}</>}`],
  ["@/components/Reveal", `import React from 'react';export function Reveal({children,className='',delay=0}){return <div className={className} style={{transitionDelay:delay+'ms'}}>{children}</div>}`],
  ["@/components/CategoryIcon", `import React from 'react';export function CategoryIcon({name,className=''}){return <svg aria-hidden='true' viewBox='0 0 24 24' className={className} fill='none' stroke='currentColor' strokeWidth='1.5'><circle cx='12' cy='12' r='8'/><path d='M4 12h16'/></svg>}`],
  ["@/lib/session", `export function getSessionId(){return'catalog-mobile-fixture'}`],
  ["@/lib/pricing", `export { money, formatRate, quote } from ${JSON.stringify(path.join(root, "src/lib/pricing.ts"))}`],
]);

const plugin = {
  name: "gear-catalogue-mobile-route",
  setup(build) {
    for (const [specifier, contents] of aliases) {
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      build.onResolve({ filter: new RegExp("^" + escaped + "$") }, () => ({ path: specifier, namespace: "gear-catalogue-fixture" }));
      build.onLoad({ filter: /.*/, namespace: "gear-catalogue-fixture" }, args => ({ loader: "tsx", resolveDir: root, contents: aliases.get(args.path) }));
    }
  },
};

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-gear-catalogue-mobile-"));
  const result = await esbuild.build({ entryPoints: [path.join(root, "scripts/fixtures/gear-catalogue-route.tsx")], outfile: path.join(temp, "bundle.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), plugins: [plugin], define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
  const js = fs.readFileSync(path.join(temp, "bundle.js"), "utf8");
  assert(js.length > 20_000, "The actual GearCatalogueClient and GearCard are bundled into the route fixture");
  const css = await require("postcss")([require("@tailwindcss/postcss")({ base: root })]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const assets = new Map([
    ["/gear-loop.mp4", ["video/mp4", path.join(root, "public/gear-loop.mp4")]],
    ["/gear-loop-mobile.mp4", ["video/mp4", path.join(root, "public/gear-loop-mobile.mp4")]],
    ["/gear-loop-poster.jpg", ["image/jpeg", path.join(root, "public/gear-loop-poster.jpg")]],
    ["/arri-deconstruct-poster.jpg", ["image/jpeg", path.join(root, "public/arri-deconstruct-poster.jpg")]],
    ["/images/home/maintained-cinema-gear-20261028.webp", ["image/webp", path.join(root, "public/images/home/maintained-cinema-gear-20261028.webp")]],
  ]);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://fixture.local").pathname;
    if (pathname === "/bundle.js") { res.setHeader("content-type", "text/javascript"); return res.end(js); }
    if (pathname === "/style.css") { res.setHeader("content-type", "text/css"); return res.end(css.css); }
    const asset = assets.get(pathname);
    if (asset) {
      const stat = fs.statSync(asset[1]);
      res.setHeader("accept-ranges", "bytes"); res.setHeader("content-type", asset[0]);
      if (req.headers.range) { const [startText,endText]=req.headers.range.replace(/bytes=/,"").split("-");const start=Number(startText),end=endText?Math.min(Number(endText),stat.size-1):stat.size-1;res.statusCode=206;res.setHeader("content-range",`bytes ${start}-${end}/${stat.size}`);res.setHeader("content-length",end-start+1);return fs.createReadStream(asset[1],{start,end}).pipe(res); }
      res.setHeader("content-length",stat.size);return fs.createReadStream(asset[1]).pipe(res);
    }
    const blockScript = new URL(req.url, "http://fixture.local").searchParams.has("block-video")
      ? `<script>window.__allowGearVideo=false;window.__nativeGearPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(!window.__allowGearVideo){const error=new Error('Autoplay blocked by test');error.name='NotAllowedError';return Promise.reject(error)}return window.__nativeGearPlay.apply(this,arguments)};const auto=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'autoplay');Object.defineProperty(HTMLMediaElement.prototype,'autoplay',{configurable:true,get(){return false},set(value){if(!value&&auto?.set)auto.set.call(this,false)}});const set=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){if(name.toLowerCase()==='autoplay'&&this instanceof HTMLMediaElement)return;return set.call(this,name,value)}</script>`
      : "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><style>html,body,#root{margin:0;min-height:100%;background:#08090a;color:#eee}button,input,select{font:inherit}</style></head><body><div id="root"></div>${blockScript}<script>window.__listings=${JSON.stringify(listings)};window.__categories=${JSON.stringify(categories)};window.__analytics=[];window.__catalogCalls=[];</script><script src="/bundle.js"></script></body></html>`;
    res.setHeader("content-type", "text/html"); res.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-gear-catalogue-chrome-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let browser;
  try {
    let port;
    for (let attempt=0;attempt<100&&!port;attempt++){try{port=fs.readFileSync(path.join(profile,"DevToolsActivePort"),"utf8").split("\n")[0]}catch{await wait(100)}}
    assert(port,"Temporary Chromium starts");process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;browser=await connect("about:blank");await browser.cmd("Page.enable");await browser.cmd("Runtime.enable");
    const navigateToFreshDocument = async url => {
      const previousTimeOrigin = await browser.evaluate("performance.timeOrigin");
      await browser.cmd("Page.navigate",{url});
      for(let attempt=0;attempt<100;attempt++){
        const documentState=await browser.evaluate("({timeOrigin:performance.timeOrigin,url:location.href,readyState:document.readyState})");
        if(documentState.timeOrigin!==previousTimeOrigin&&documentState.url===url&&documentState.readyState==="complete")return;
        await wait(25);
      }
      throw new Error(`Navigation did not commit a fresh document: ${url}`);
    };
    browser.on(event=>{if(event.method==="Runtime.exceptionThrown")console.error("BROWSER",JSON.stringify(event.params).slice(0,700))});
    const out="/tmp/dbc-gear-catalogue-mobile";fs.mkdirSync(out,{recursive:true});
    for(const [width,height] of [[320,640],[390,844],[430,932],[768,900],[1440,900]]){
      await browser.cmd("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:width<768});

      await navigateToFreshDocument(`http://127.0.0.1:${server.address().port}/gear`);
      for(let attempt=0;attempt<100&&!await browser.evaluate(`!!document.querySelector('[data-gaffer-ready="true"]')`);attempt++)await wait(50);
      for(let attempt=0;attempt<40&&!await browser.evaluate(`(()=>{const v=document.querySelector('video');return v&&v.readyState>=2&&v.currentTime>.2&&!v.paused})()`);attempt++)await wait(50);
      const geometry=await browser.evaluate(`(()=>{const banner=document.querySelector('main')?.previousElementSibling,toolbar=document.querySelector('#gear-toolbar'),cards=[...document.querySelectorAll('.gear-card')],filters=document.querySelector('#gear-refinements'),rail=document.querySelector('[role="group"][aria-label="Gear categories"]'),tabs=[...rail.querySelectorAll('button')],video=document.querySelector('video');const box=e=>{const r=e?.getBoundingClientRect();return r&&{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,banner:box(banner),toolbar:box(toolbar),cardCount:cards.length,cards:cards.map(box),rail:box(rail),railScroll:{clientWidth:rail.clientWidth,scrollWidth:rail.scrollWidth,scrollLeft:rail.scrollLeft},edgeHints:{left:rail.classList.contains('gear-category-rail--more-left'),right:rail.classList.contains('gear-category-rail--more-right')},tabBoxes:tabs.map(box),video:video&&{src:video.currentSrc,paused:video.paused,time:video.currentTime},filtersDisplay:getComputedStyle(filters).display,search:document.querySelector('input[placeholder="Search gear…"]')?.value,resetButtons:[...document.querySelectorAll('button')].filter(b=>/Clear filters|Reset/.test(b.textContent)).map(b=>b.textContent.trim())}})()`);
      assert(geometry.scrollWidth<=width,`The actual catalog component fits ${width}px: ${JSON.stringify(geometry)}`);
      assert(await browser.evaluate(`!!document.querySelector('a[href="/"]')&&!!document.querySelector('button[aria-label="Open menu"]')`),`The mobile header keeps logo and menu controls visible at ${width}px`);
      assert(geometry.cardCount===6,`All real GearCard components render in the actual catalog at ${width}px`);
      if(width<360) assert(geometry.cards.every(card=>card.width>=135),`Very narrow phones retain usable compact listing cards at ${width}px: ${JSON.stringify(geometry.cards)}`);
      else if(width<600) assert(geometry.cards.every(card=>card.width>=140&&card.width<=200),`Wider phones use compact two-column listing cards without squeezing text at ${width}px: ${JSON.stringify(geometry.cards)}`);
      assert.equal(await browser.evaluate(`document.querySelector('.gear-card .font-mono')?.textContent.trim()`),`7-day £${formatRate(quote(listings[0].pricing,7).total)}`,`The FX3 weekly total matches the shared checkout pricing ladder at ${width}px`);
      if(width<640){
        for(let attempt=0;attempt<40&&!await browser.evaluate(`(()=>{const rail=document.querySelector('[role="group"][aria-label="Gear categories"]');return rail?.classList.contains('gear-category-rail--more-right')&&!rail.classList.contains('gear-category-rail--more-left')})()`);attempt++)await wait(20);
        geometry.edgeHints=await browser.evaluate(`(()=>{const rail=document.querySelector('[role="group"][aria-label="Gear categories"]');return{left:rail.classList.contains('gear-category-rail--more-left'),right:rail.classList.contains('gear-category-rail--more-right')}})()`);
        assert(geometry.rail.left>=0&&geometry.rail.right<=width&&geometry.rail.height<=56,`Phone category rail stays inside the viewport and uses one compact row at ${width}px: ${JSON.stringify(geometry.rail)}`);
        assert(geometry.railScroll.scrollWidth>geometry.railScroll.clientWidth,`Phone categories remain horizontally scrollable at ${width}px`);
        assert(!geometry.edgeHints.left&&geometry.edgeHints.right,`The initial row signals more categories at the right edge only at ${width}px: ${JSON.stringify({...geometry.edgeHints,railScroll:geometry.railScroll})}`);
        assert(geometry.tabBoxes.every(box=>box.height>=44),`Every phone category keeps a 44px touch target at ${width}px`);
        assert(geometry.toolbar.height<170,`One category row reduces the phone filter area below 170px at ${width}px: ${geometry.toolbar.height}`);
        assert.equal(geometry.filtersDisplay,"none",`Secondary filters stay in the mobile Filters sheet until opened at ${width}px`);
        const initialShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`catalog-${width}x${height}-initial.png`),Buffer.from(initialShot.data,"base64"));

        const categories=await browser.evaluate(`(()=>{const rail=document.querySelector('[role="group"][aria-label="Gear categories"]'),buttons=[...rail.querySelectorAll('button')],last=buttons.at(-1);rail.scrollLeft=rail.scrollWidth;const end=last.getBoundingClientRect();const box=rail.getBoundingClientRect();return{left:end.left,right:end.right,railLeft:box.left,railRight:box.right,scrollLeft:rail.scrollLeft,maxScroll:rail.scrollWidth-rail.clientWidth}})()`);
        assert(categories.left>=geometry.rail.left-1&&categories.right<=geometry.rail.right+1&&categories.scrollLeft>0,`A touch swipe can reach the final category without page overflow at ${width}px: ${JSON.stringify(categories)}`);
        for(let attempt=0;attempt<30&&!await browser.evaluate(`(()=>{const rail=document.querySelector('[role="group"][aria-label="Gear categories"]');return rail.classList.contains('gear-category-rail--more-left')&&!rail.classList.contains('gear-category-rail--more-right')})()`);attempt++)await wait(20);
        assert.equal(await browser.evaluate(`(()=>{const rail=document.querySelector('[role="group"][aria-label="Gear categories"]');return{left:rail.classList.contains('gear-category-rail--more-left'),right:rail.classList.contains('gear-category-rail--more-right')}})()`).then(state=>state.left&&!state.right),true,`The edge fade moves to the left after scrolling to the final category at ${width}px`);
        const endShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`catalog-${width}-categories-end.png`),Buffer.from(endShot.data,"base64"));
        await browser.evaluate(`(()=>{const rail=document.querySelector('[role="group"][aria-label="Gear categories"]'),buttons=[...rail.querySelectorAll('button')];rail.scrollLeft=0;buttons[0].focus();buttons[0].dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))})()`);
        for(let attempt=0;attempt<80&&!await browser.evaluate(`(()=>{const rail=document.querySelector('[role="group"][aria-label="Gear categories"]'),last=rail.querySelectorAll('button')[5],r=last.getBoundingClientRect(),box=rail.getBoundingClientRect();return document.activeElement===last&&r.left>=box.left+3&&r.right<=box.right-3})()`);attempt++)await wait(20);
        const keyboard=await browser.evaluate(`(()=>{const rail=document.querySelector('[role="group"][aria-label="Gear categories"]'),buttons=[...rail.querySelectorAll('button')],r=buttons.at(-1).getBoundingClientRect(),box=rail.getBoundingClientRect();return{focused:document.activeElement===buttons.at(-1),left:r.left,right:r.right,railLeft:box.left,railRight:box.right,scrollLeft:rail.scrollLeft}})()`);
        assert(keyboard.focused&&keyboard.left>=keyboard.railLeft-1&&keyboard.right<=keyboard.railRight+1,`Keyboard End focuses and reveals the last phone category at ${width}px: ${JSON.stringify(keyboard)}`);
        assert(keyboard.left>=keyboard.railLeft+3&&keyboard.right<=keyboard.railRight-3,`Keyboard focus keeps a visible inset around the last pill at ${width}px: ${JSON.stringify(keyboard)}`);
        const keyboardShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`catalog-${width}-keyboard-end.png`),Buffer.from(keyboardShot.data,"base64"));
        await browser.evaluate(`(()=>{const rail=document.querySelector('[role="group"][aria-label="Gear categories"]'),buttons=[...rail.querySelectorAll('button')];buttons.at(-1).dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))})()`);
        for(let attempt=0;attempt<40&&!await browser.evaluate(`(()=>{const rail=document.querySelector('[role="group"][aria-label="Gear categories"]'),first=rail.querySelector('button'),r=first.getBoundingClientRect(),box=rail.getBoundingClientRect();return document.activeElement===first&&r.left>=box.left-1&&r.right<=box.right+1})()`);attempt++)await wait(20);
        assert.equal(await browser.evaluate(`document.activeElement===document.querySelector('[aria-label="Browse All, 6 items"]')`),true,`Keyboard Home returns focus to All at ${width}px`);
        await browser.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
        assert.equal(await browser.evaluate(`document.activeElement===document.querySelector('[aria-label="Browse Cameras, 1 item"]')`),true,`Keyboard Right moves focus to the next category at ${width}px`);
        assert(geometry.video&&!geometry.video.paused&&geometry.video.time>.2&&geometry.video.src.endsWith("/gear-loop-mobile.mp4"),`Mobile gear video plays inline at ${width}px`);
      } else if(width===768){
        assert.equal(geometry.filtersDisplay,"flex",`Tablet secondary filters retain their existing visible layout`);
        assert(geometry.railScroll.scrollWidth<=geometry.railScroll.clientWidth+1,`The tablet category row preserves its current wrap/fit behavior`);
      } else {
        assert.equal(geometry.filtersDisplay,"flex",`Desktop secondary filters preserve their existing inline layout`);
        assert(geometry.railScroll.scrollWidth<=geometry.railScroll.clientWidth+1,`Desktop category tabs preserve their existing wrap/fit behavior`);
      }
      if(width>=640){const shot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`catalog-${width}x${height}-initial.png`),Buffer.from(shot.data,"base64"));}

      await browser.evaluate(`document.querySelector('.gear-card')?.scrollIntoView({block:'start'})`);
      const cardAudit=await browser.evaluate(`(()=>[...document.querySelectorAll('.gear-card')].map(card=>{const link=card.querySelector('a[data-listing-id]'),image=card.querySelector('img'),listing=window.__listings.find(item=>item._id===link?.dataset.listingId),box=card.getBoundingClientRect(),imageBox=image?.parentElement?.getBoundingClientRect();return{id:link?.dataset.listingId,left:box.left,right:box.right,width:box.width,top:box.top,imageAlt:image?.alt,imagePath:image?new URL(image.src,location.href).pathname:null,expectedImage:listing?.heroImage,expectedAlt:listing?.title,imageWidth:imageBox?.width,imageHeight:imageBox?.height}}))()`);
      const expectedColumns=width<768?2:width<1024?3:width<1280?4:6;
      const minCardWidth=width<768?width*.38:width<1024?width*.28:width<1280?width*.18:width*.12;
      const firstRowCount=cardAudit.filter(card=>Math.abs(card.top-cardAudit[0].top)<1).length;
      assert(cardAudit.every(card=>card.left>=-1&&card.right<=width+1&&card.width>=minCardWidth),`Listing cards use the available grid width without clipping or oversized narrow columns at ${width}px: ${JSON.stringify(cardAudit.map(({left,right,width:cardWidth})=>({left,right,width:cardWidth})))}`);
      assert.equal(firstRowCount,expectedColumns,`Listing cards use ${expectedColumns} columns at ${width}px`);
      const cardControls=await browser.evaluate(`(()=>[...document.querySelectorAll('.gear-card')].map(card=>{const button=card.querySelector('button[aria-label]'),rect=button?.getBoundingClientRect();return{buttonWidth:rect?.width,buttonHeight:rect?.height,overflow:card.scrollWidth>card.clientWidth+1}}))()`);
      assert(cardControls.every(card=>card.buttonWidth>=44&&card.buttonHeight>=44&&!card.overflow),`Compact cards keep full-size favourite targets without horizontal overflow at ${width}px`);
      assert(cardAudit.every(card=>card.imagePath===card.expectedImage&&card.imageAlt===card.expectedAlt&&card.imageWidth>0&&card.imageHeight>0),`Each card shows its listing's real primary photo and descriptive alt text at ${width}px: ${JSON.stringify(cardAudit)}`);
      const imageLoaded=await browser.evaluate(`(()=>{const image=document.querySelector('.gear-card img');return !!image&&image.complete&&image.naturalWidth>0})()`);
      assert(imageLoaded,`A real listing photo loads in the rendered card at ${width}px`);
      const cardShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
      fs.writeFileSync(path.join(out,`catalog-${width}x${height}-cards.png`),Buffer.from(cardShot.data,"base64"));
      await browser.evaluate(`window.scrollTo(0,0)`);

      console.log(`PASS initial catalog ${width}px ${JSON.stringify({scrollWidth:geometry.scrollWidth,banner:geometry.banner,toolbar:geometry.toolbar,cardCount:geometry.cardCount,video:geometry.video})}`);
    }
    // Search/filter state interactions on a phone, with only a synthetic catalog in the isolated fixture.
    await browser.cmd("Emulation.setDeviceMetricsOverride",{width:320,height:844,deviceScaleFactor:1,mobile:true});
    await navigateToFreshDocument(`http://127.0.0.1:${server.address().port}/gear?q=sony`);
    for(let attempt=0;attempt<100&&!await browser.evaluate(`document.querySelectorAll('.gear-card').length===3`);attempt++)await wait(50);
    const searchState=await browser.evaluate(`(()=>{const reset=document.querySelector('[aria-label="Reset gear search and filters"]');return{value:document.querySelector('input[placeholder="Search gear…"]')?.value,count:document.querySelectorAll('.gear-card').length,reset:reset?.textContent.trim(),resetHeight:reset?.getBoundingClientRect().height,titles:[...document.querySelectorAll('.gear-card h3')].map(e=>e.textContent.trim())}})()`);
    assert.equal(searchState.value,"sony");assert.equal(searchState.count,3);assert(searchState.titles.every(title=>/Sony/i.test(title)));
    assert.equal(searchState.reset,"Reset","A search-only state has an explicit clear action");
    assert(searchState.resetHeight>=44,"Reset is a full-height phone touch target");
    const shot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,"catalog-320-search.png"),Buffer.from(shot.data,"base64"));
    console.log(`AUDIT search-only state ${JSON.stringify(searchState)}`);
    await browser.evaluate(`document.querySelector('[aria-label="Reset gear search and filters"]')?.click()`);
    for(let attempt=0;attempt<80&&!await browser.evaluate(`document.querySelectorAll('.gear-card').length===6&&document.querySelector('input[placeholder="Search gear…"]')?.value===''`);attempt++)await wait(50);
    assert.equal(await browser.evaluate(`location.pathname+location.search`),"/gear","Reset also removes stale search parameters from the URL");
    assert.equal(await browser.evaluate(`document.querySelectorAll('.gear-card').length`),6,"Reset restores the full catalogue");
    await browser.evaluate(`document.querySelector('[aria-label="Browse Lenses, 2 items"]').click()`);
    for(let attempt=0;attempt<80&&!await browser.evaluate(`document.querySelectorAll('.gear-card').length===2`);attempt++)await wait(50);
    assert.equal(await browser.evaluate(`document.querySelector('[role="status"]').textContent.trim()`),"2 items in this category","Category-only status describes the active category accurately");
    assert(await browser.evaluate(`!!document.querySelector('[aria-label="Reset gear search and filters"]')`),"Category-only selection also exposes Reset");
    await browser.evaluate(`document.querySelector('[aria-label="Reset gear search and filters"]').click()`);
    for(let attempt=0;attempt<80&&!await browser.evaluate(`document.querySelectorAll('.gear-card').length===6`);attempt++)await wait(50);
    await browser.evaluate(`document.querySelector('button[aria-label="Open menu"]').click()`);
    assert.equal(await browser.evaluate(`document.querySelector('button[aria-label="Open menu"]').getAttribute('aria-expanded')`),"true","Header menu opens from a phone-width tap");
    assert.equal(await browser.evaluate(`document.querySelector('nav[aria-label="Mobile menu"] a[href="/how-it-works"]')?.textContent`),"How it works","The mobile menu exposes its page navigation");
    await browser.evaluate(`document.querySelector('button[aria-label="Open menu"]').click()`);
    await navigateToFreshDocument(`http://127.0.0.1:${server.address().port}/gear?q=sony`);
    for(let attempt=0;attempt<80&&!await browser.evaluate(`document.querySelectorAll('.gear-card').length===3`);attempt++)await wait(50);
    await browser.evaluate(`document.querySelector('[aria-label="Browse Lenses, 2 items"]')?.click()`);
    for(let attempt=0;attempt<80&&!await browser.evaluate(`document.querySelectorAll('.gear-card').length===1&&document.querySelector('.gear-card h3')?.textContent?.includes('lens')`);attempt++)await wait(50);
    assert.equal(await browser.evaluate(`document.querySelectorAll('.gear-card').length`),1,"Lens category combines with search and returns the matching lens listing");
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Browse Lenses, 2 items"]').getAttribute('aria-pressed')`),"true","Selected mobile category exposes its pressed state");
    await browser.evaluate(`document.querySelector('button[aria-controls="gear-refinements"]').click()`);
    assert.equal(await browser.evaluate(`document.querySelector('button[aria-controls="gear-refinements"]').getAttribute('aria-expanded')`),"true","The mobile filter disclosure opens on tap");
    assert.notEqual(await browser.evaluate(`getComputedStyle(document.querySelector('#gear-refinements')).display`),"none","Filter controls become visible after opening");
    await browser.evaluate(`(()=>{const e=document.querySelector('[aria-label="Filter gear by brand"]');e.value='Sony';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    for(let attempt=0;attempt<80&&!await browser.evaluate(`document.querySelector('.gear-card h3')?.textContent?.includes('Sony')`);attempt++)await wait(50);
    const final=await browser.evaluate(`(()=>({count:document.querySelectorAll('.gear-card').length,hrefs:[...document.querySelectorAll('.gear-card')].map(e=>e.querySelector('a[href]')?.getAttribute('href')??null),text:document.querySelector('[role="status"]')?.textContent.trim(),tabWidth:document.querySelector('[aria-label="Gear categories"]')?.getBoundingClientRect().width,resetVisible:[...document.querySelectorAll('button')].some(b=>/Clear filters|Reset/.test(b.textContent)&&getComputedStyle(b).display!=='none')}))()`);

    assert.equal(final.count,1,"Brand and category filters combine without stale results");
    assert.equal(final.hrefs[0],"/gear/sony-24-70-lens","A real GearCard keeps its product detail destination");
    console.log(`PASS category, search, mobile disclosure, brand filter and product navigation ${JSON.stringify(final)}`);
    await browser.cmd("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await browser.evaluate(`document.querySelector('.gear-card')?.scrollIntoView({block:'center'})`);
    const singleCard=await browser.evaluate(`(()=>{const card=document.querySelector('.gear-card'),box=card?.getBoundingClientRect(),image=card?.querySelector('img')?.getBoundingClientRect();return{cardWidth:box?.width,imageWidth:image?.width,viewport:innerWidth}})()`);
    assert(singleCard.cardWidth<=384,`A single desktop result stays compact instead of stretching across the catalogue: ${JSON.stringify(singleCard)}`);
    const singleCardShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    fs.writeFileSync(path.join(out,"catalog-1440-single-result.png"),Buffer.from(singleCardShot.data,"base64"));
    await browser.evaluate(`document.querySelector('[aria-label="Reset gear search and filters"]')?.click()`);
    for(let attempt=0;attempt<80&&!await browser.evaluate(`document.querySelectorAll('.gear-card').length===6`);attempt++)await wait(50);
    await browser.evaluate(`(()=>{window.__listings.push(${JSON.stringify({ _id:"red-marketing-camera",slug:"red-komodo",title:"RED Komodo Cinema Camera",category:"Cameras",itemType:"camera-body",active:true,marketingOnly:true,displayOnly:false,bookable:false,heroImage:"/images/home/maintained-cinema-gear-20261028.webp",imageSources:["/images/home/maintained-cinema-gear-20261028.webp"],pricing:{daily:100},depositAmount:50,minimumRentalDays:1 })},${JSON.stringify({ _id:"red-hidden-camera",slug:"red-hidden",title:"RED Hidden Cinema Camera",category:"Cameras",active:true,suppressed:true,bookable:false,heroImage:"/images/home/maintained-cinema-gear-20261028.webp",pricing:{daily:100} })},${JSON.stringify({ _id:"red-inactive-camera",slug:"red-inactive",title:"RED Inactive Cinema Camera",category:"Cameras",active:false,bookable:false,heroImage:"/images/home/maintained-cinema-gear-20261028.webp",pricing:{daily:100} })});const input=document.querySelector('input[placeholder="Search gear…"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'RED cameras');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    for(let attempt=0;attempt<80&&!await browser.evaluate(`document.querySelectorAll('.gear-card').length===1&&document.querySelector('.gear-card h3')?.textContent?.includes('RED Komodo')`);attempt++)await wait(50);
    const marketingSearch=await browser.evaluate(`(()=>{const card=document.querySelector('.gear-card'),link=card?.querySelector('a[data-listing-id]'),image=card?.querySelector('img'),call=[...window.__catalogCalls].reverse().find(item=>item.key==='catalog.listListings'&&item.args?.search==='red');return{count:document.querySelectorAll('.gear-card').length,title:card?.querySelector('h3')?.textContent.trim(),href:link?.getAttribute('href'),photo:image?.getAttribute('src'),photoAlt:image?.getAttribute('alt'),action:card?.textContent.includes('View details'),bookAction:card?.textContent.includes('Choose dates'),badgeLabels:[...card.querySelectorAll('.gaffer-pick-badge')].map(node=>node.textContent.trim()),displayOnlyBadge:[...card.querySelectorAll('span')].some(node=>node.textContent.trim()==='Display only'),requestToConfirmBadge:/\\brequest\\s+to\\s+confirm\\b/i.test(card?.textContent??''),query:call?.args}})()`);
    assert.equal(marketingSearch.query?.search,"red","Catalog search removes the Cameras category word before querying titles");
    assert.equal(marketingSearch.query?.category,"Cameras","The recognized camera department scopes the catalog query");
    assert.equal(marketingSearch.count,1,"Search reveals only the active marketing-only RED camera, not suppressed or inactive matches");
    assert.equal(marketingSearch.title,"RED Komodo Cinema Camera");
    assert.equal(marketingSearch.href,"/gear/red-komodo","The non-bookable marketing result opens its product details");
    assert.equal(marketingSearch.photo,"/images/home/maintained-cinema-gear-20261028.webp");
    assert.equal(marketingSearch.photoAlt,"RED Komodo Cinema Camera");
    assert(marketingSearch.action&&!marketingSearch.bookAction,"The marketing listing is presented as details-only, never as a date-selection action");
    assert.deepEqual(marketingSearch.badgeLabels,[],"The marketing listing has no Gaffer's pick or Suggested badge unless Gaffer actually assigned one");
    assert.equal(marketingSearch.displayOnlyBadge,false,"A marketing-only item is not mislabeled with the separate inventory display-only badge");
    assert.equal(marketingSearch.requestToConfirmBadge,false,"The public catalog card does not render a request-to-confirm badge");
    const marketingShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync("/tmp/dbc-gear-catalogue-red-cameras.png",Buffer.from(marketingShot.data,"base64"));
    console.log(`PASS catalog search RED cameras discovers the active request-only item and excludes hidden/inactive listings ${JSON.stringify(marketingSearch)}`);
    await browser.evaluate(`(()=>{window.__listings.push(${JSON.stringify({ _id:"display-only-demo",slug:"display-only-demo",title:"Display only reference body",category:"Cameras",itemType:"camera-body",active:true,displayOnly:true,bookable:false,heroImage:"/images/home/maintained-cinema-gear-20261028.webp",imageSources:["/images/home/maintained-cinema-gear-20261028.webp"],pricing:{daily:100},depositAmount:50,minimumRentalDays:1 })});const input=document.querySelector('input[placeholder="Search gear…"]'),setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Display only reference body');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    for(let attempt=0;attempt<80&&!await browser.evaluate(`document.querySelector('.gear-card h3')?.textContent?.includes('Display only reference body')`);attempt++)await wait(50);
    const displayOnlyCard=await browser.evaluate(`(()=>{const card=document.querySelector('.gear-card'),text=card?.innerText??'';return{count:document.querySelectorAll('.gear-card').length,chip:[...card.querySelectorAll('span')].some(node=>node.textContent.trim()==='Display only'),requestCopy:text.includes('Available by request'),interestButton:[...card.querySelectorAll('button')].find(button=>button.textContent.trim()==='Register interest')?.textContent.trim(),rentalAction:/Choose dates|View details/.test(text),dailyPrice:/£\d/.test(text)}})()`);
    assert.equal(displayOnlyCard.count,1);
    assert.equal(displayOnlyCard.chip,true,"display-only state remains visible on the card");
    assert.equal(displayOnlyCard.requestCopy,false,"the redundant request label is removed");
    assert.equal(displayOnlyCard.interestButton,"Register interest","register-interest action remains available");
    assert.equal(displayOnlyCard.rentalAction,false,"display-only equipment is never presented as rentable");
    assert.equal(displayOnlyCard.dailyPrice,false,"display-only pricing is not presented as an online rental quote");
    await browser.evaluate(`[...document.querySelectorAll('.gear-card button')].find(button=>button.textContent.trim()==='Register interest')?.click()`);
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('.gear-card button')].some(button=>button.textContent.includes('Interest noted'))`),true,"register-interest continues to respond");
    console.log(`PASS display-only card keeps its state and working interest action without duplicate request copy ${JSON.stringify(displayOnlyCard)}`);
    for (const width of [390,1440]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:width<768?3:1,mobile:width<768});
      await navigateToFreshDocument(`http://127.0.0.1:${server.address().port}/gear?block-video=1`);
      for(let attempt=0;attempt<100&&!await browser.evaluate(`!!document.querySelector('[data-testid="gear-video-play"]')`);attempt++)await wait(50);
      const fallback=await browser.evaluate(`(()=>{const button=document.querySelector('[data-testid="gear-video-play"]'),video=document.querySelector('video'),rect=button?.getBoundingClientRect();return{visible:!!button&&getComputedStyle(button).display!=='none'&&getComputedStyle(button).visibility!=='hidden',label:button?.getAttribute('aria-label'),height:rect?.height,left:rect?.left,right:rect?.right,top:rect?.top,bottom:rect?.bottom,videoSrc:video?.currentSrc,paused:video?.paused,poster:video?.poster}})()`);
      assert(fallback.visible&&fallback.height>=40&&fallback.left>=0&&fallback.right<=width,`Blocked gear autoplay exposes a reachable Play film control at ${width}px: ${JSON.stringify(fallback)}`);
      assert.equal(fallback.label,"Play the gear page film");
      assert(fallback.videoSrc.endsWith(width<768?"/gear-loop-mobile.mp4":"/gear-loop.mp4"),`Gear fallback selects the viewport-appropriate video at ${width}px: ${JSON.stringify(fallback)}`);
      const shot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(`/tmp/dbc-gear-video-${width}-play-fallback.png`,Buffer.from(shot.data,"base64"));
      await browser.evaluate(`window.__allowGearVideo=true;document.querySelector('[data-testid="gear-video-play"]').click()`);
      for(let attempt=0;attempt<100&&!await browser.evaluate(`(()=>{const video=document.querySelector('video');return video&&!video.paused&&video.currentTime>.1})()`);attempt++)await wait(50);
      assert(await browser.evaluate(`(()=>{const video=document.querySelector('video');return video&&!video.paused&&video.currentTime>.1&&!document.querySelector('[data-testid="gear-video-play"]')})()`),`The gear banner resumes after the user presses Play at ${width}px`);
    }
    console.log("PASS blocked autoplay shows an accessible gear film fallback and resumes from user action at phone and desktop sizes.");
    await browser.cmd("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true});
    await browser.cmd("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
    await navigateToFreshDocument(`http://127.0.0.1:${server.address().port}/gear`);
    for(let attempt=0;attempt<100&&!await browser.evaluate(`(()=>{const video=document.querySelector('video'),button=document.querySelector('[data-testid="gear-video-play"]');return !!video&&video.paused&&!!button})()`);attempt++)await wait(50);
    const reducedMotion=await browser.evaluate(`(()=>{const video=document.querySelector('video'),button=document.querySelector('[data-testid="gear-video-play"]');return{paused:video?.paused,playControl:!!button&&getComputedStyle(button).display!=='none',poster:video?.poster,source:video?.currentSrc}})()`);
    assert(reducedMotion.paused&&reducedMotion.playControl,`Reduced motion pauses the mobile gear film and keeps deliberate playback available: ${JSON.stringify(reducedMotion)}`);
    const reducedShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(`/tmp/dbc-gear-video-390-reduced-motion.png`,Buffer.from(reducedShot.data,"base64"));
    await browser.evaluate(`document.querySelector('[data-testid="gear-video-play"]').click()`);
    for(let attempt=0;attempt<100&&!await browser.evaluate(`(()=>{const video=document.querySelector('video');return video&&!video.paused&&video.currentTime>.1})()`);attempt++)await wait(50);
    assert(await browser.evaluate(`(()=>{const video=document.querySelector('video');return video&&!video.paused&&video.currentTime>.1&&video.currentSrc.endsWith('/gear-loop-mobile.mp4')})()`),"A deliberate tap starts the correct phone-sized gear film under reduced motion");
    await browser.cmd("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
    for(let attempt=0;attempt<40&&!await browser.evaluate(`(()=>{const video=document.querySelector('video');return video&&!video.paused})()`);attempt++)await wait(25);
    await browser.cmd("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
    for(let attempt=0;attempt<40&&!await browser.evaluate(`document.querySelector('video')?.paused`);attempt++)await wait(25);
    assert(await browser.evaluate(`(()=>{const video=document.querySelector('video');return video?.paused&&!!document.querySelector('[data-testid="gear-video-play"]')})()`),"Enabling reduced motion while the mobile gear film is playing pauses it and restores the play control");
    console.log("PASS reduced-motion preference pauses autoplay on the mobile gear page, while explicit play works.");
    console.log(`Screenshots: ${out}`);
  } finally {
    if(browser){browser.close();await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(()=>{})}
    if(chrome.exitCode===null){const done=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill();await done}
    await new Promise(resolve=>server.close(resolve));await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1});
