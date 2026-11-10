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
  ["convex/react", `export function useQuery(ref,args){const key=String(ref),items=window.__listings??[];if(key==='catalog.categories')return window.__categories;if(key==='catalog.bestSellers')return[];if(key==='catalog.listingsByIds')return args==='skip'?undefined:items.filter(item=>args?.ids?.includes(item._id));if(key==='catalog.listListings'){if(args==='skip')return undefined;return items.filter(item=>(!args?.category||item.category===args.category)&&(!args?.search||item.title.toLowerCase().includes(args.search.toLowerCase())))}return undefined}const track=async value=>{window.__analytics.push(value)};export function useMutation(){return track}`],
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
  ["@/lib/pricing", `export function money(value){return Number(value).toFixed(2)}`],
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
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><style>html,body,#root{margin:0;min-height:100%;background:#08090a;color:#eee}button,input,select{font:inherit}</style></head><body><div id="root"></div><script>window.__listings=${JSON.stringify(listings)};window.__categories=${JSON.stringify(categories)};window.__analytics=[];</script><script src="/bundle.js"></script></body></html>`;
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
    browser.on(event=>{if(event.method==="Runtime.exceptionThrown")console.error("BROWSER",JSON.stringify(event.params).slice(0,700))});
    const out="/tmp/dbc-gear-catalogue-mobile";fs.mkdirSync(out,{recursive:true});
    for(const width of [320,390,430,768]){
      await browser.cmd("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:width<768});
      await browser.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/gear`});
      for(let attempt=0;attempt<100&&!await browser.evaluate(`!!document.querySelector('[data-gaffer-ready="true"]')`);attempt++)await wait(50);
      for(let attempt=0;attempt<40&&!await browser.evaluate(`(()=>{const v=document.querySelector('video');return v&&v.readyState>=2&&v.currentTime>.2&&!v.paused})()`);attempt++)await wait(50);
      const geometry=await browser.evaluate(`(()=>{const banner=document.querySelector('main')?.previousElementSibling,toolbar=document.querySelector('#gear-toolbar'),cards=[...document.querySelectorAll('.gear-card')],filters=document.querySelector('#gear-refinements'),tabs=[...document.querySelectorAll('[role="group"][aria-label="Gear categories"] button')],video=document.querySelector('video');const box=e=>{const r=e?.getBoundingClientRect();return r&&{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,banner:box(banner),toolbar:box(toolbar),cardCount:cards.length,cards:cards.map(box),tabBoxes:tabs.map(box),video:video&&{src:video.currentSrc,paused:video.paused,time:video.currentTime},filtersDisplay:getComputedStyle(filters).display,search:document.querySelector('input[placeholder="Search gear…"]')?.value,resetButtons:[...document.querySelectorAll('button')].filter(b=>/Clear filters|Reset/.test(b.textContent)).map(b=>b.textContent.trim())}})()`);
      assert(geometry.scrollWidth<=width,`The actual catalog component fits ${width}px: ${JSON.stringify(geometry)}`);
      assert(await browser.evaluate(`!!document.querySelector('a[href="/"]')&&!!document.querySelector('button[aria-label="Open menu"]')`),`The mobile header keeps logo and menu controls visible at ${width}px`);
      assert(geometry.cardCount===6,`All real GearCard components render in the actual catalog at ${width}px`);
      if(width<768){assert(geometry.tabBoxes.every(box=>box.left>=0&&box.right<=width&&box.height>=44),`Phone category tabs remain visible, tappable and inside ${width}px: ${JSON.stringify(geometry.tabBoxes)}`);assert(geometry.video&&!geometry.video.paused&&geometry.video.time>.2&&geometry.video.src.endsWith("/gear-loop-mobile.mp4"),`Mobile gear video plays inline at ${width}px`)}
      const shot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`catalog-${width}-initial.png`),Buffer.from(shot.data,"base64"));
      console.log(`PASS initial catalog ${width}px ${JSON.stringify({scrollWidth:geometry.scrollWidth,banner:geometry.banner,toolbar:geometry.toolbar,cardCount:geometry.cardCount,video:geometry.video})}`);
    }
    // Search/filter state interactions on a phone, with only a synthetic catalog in the isolated fixture.
    await browser.cmd("Emulation.setDeviceMetricsOverride",{width:320,height:844,deviceScaleFactor:1,mobile:true});
    await browser.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/gear?q=sony`});
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
    await browser.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/gear?q=sony`});
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
    const final=await browser.evaluate(`(()=>({count:document.querySelectorAll('.gear-card').length,hrefs:[...document.querySelectorAll('.gear-card')].map(e=>e.getAttribute('href')),text:document.querySelector('[role="status"]')?.textContent.trim(),tabWidth:document.querySelector('[aria-label="Gear categories"]')?.getBoundingClientRect().width,resetVisible:[...document.querySelectorAll('button')].some(b=>/Clear filters|Reset/.test(b.textContent)&&getComputedStyle(b).display!=='none')}))()`);
    assert.equal(final.count,1,"Brand and category filters combine without stale results");
    assert.equal(final.hrefs[0],"/gear/sony-24-70-lens","A real GearCard keeps its product detail destination");
    console.log(`PASS category, search, mobile disclosure, brand filter and product navigation ${JSON.stringify(final)}`);
    console.log(`Screenshots: ${out}`);
  } finally {
    if(browser){browser.close();await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(()=>{})}
    if(chrome.exitCode===null){const done=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill();await done}
    await new Promise(resolve=>server.close(resolve));await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1});
