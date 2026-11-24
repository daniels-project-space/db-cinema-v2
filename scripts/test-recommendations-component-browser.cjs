const assert=require("node:assert/strict");
const fs=require("node:fs");
const http=require("node:http");
const os=require("node:os");
const path=require("node:path");
const {spawn}=require("node:child_process");
const esbuild=require("esbuild");
const postcss=require("postcss");
const root=path.resolve(__dirname,"..");
const connectSource=fs.readFileSync(path.join(__dirname,"test-membership-browser.cjs"),"utf8");
const connect=new Function("require",connectSource.slice(0,connectSource.indexOf("const { ConvexHttpClient"))+";return connect;")(require);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
 const entry=`import React,{useState} from'react';import{createRoot}from'react-dom/client';import{Recommendations}from'./src/components/Recommendations';import{CartProvider,useCart}from'@/components/cart/CartProvider';function Stage(){const cart=useCart(),[end,setEnd]=useState('2030-01-02'),[show,setShow]=useState(true);window.__setEnd=setEnd;window.__setShow=setShow;return <><div data-testid="basket-count">{cart.items.length}</div><main>{show&&<Recommendations start="2030-01-01" end={end} days={2}/>}</main></>}createRoot(document.getElementById('root')).render(<CartProvider><Stage/></CartProvider>);`;
 const aliases=new Map([
  ["convex/react",`export const useQuery=(ref,args)=>window.__query(ref,args);export const useAction=()=>async args=>window.__quote(args);export const useConvex=()=>({query:async(ref,args)=>window.__query(ref,args)});`],
  ["@cvx/_generated/api",`const ns=name=>new Proxy({}, {get:(_,key)=>String(name)+'.'+String(key)});export const api=new Proxy({}, {get:(_,name)=>ns(name)});`],
  ["@/components/useLiveRecommendations",`export function useLiveRecommendations(){return window.__live}`],
  ["@/components/SmartImage",`import React from'react';export function SmartImage({src,fallbackSources,alt,...props}){return <img src={src||fallbackSources?.[0]} alt={alt} {...props}/>} `],
  ["@/components/cart/CartProvider",`import React,{createContext,useContext,useState}from'react';const Cart=createContext(null);export function CartProvider({children}){const[items,setItems]=useState([]);const value={items,add(item){window.__addedItems.push(item);setItems(previous=>[...previous,item])}};return <Cart.Provider value={value}>{children}</Cart.Provider>}export function useCart(){return useContext(Cart)}`],
  ["@/components/account/AccountProvider",`export function useAccount(){return{me:null,token:null}}`],
  ["@/lib/pricing",`export const formatGbp=value=>'£'+Number(value).toFixed(2);export const formatRate=value=>'£'+Number(value).toFixed(2)`],
  ["@/lib/dates",`export const dayMs=value=>new Date(value+'T00:00:00Z').getTime();export const addDaysIso=(value,days)=>{const date=new Date(value+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}`],
  ["@/lib/liveRecommendations",`export const liveWindow=()=>({start:0,end:1});export const stockLines=()=>[]`],
  ["../../shared/recommendationPolicy",`export const automaticRecommendation=()=>true`],
  ["../../shared/rentalDuration",`export const rentalPricingDays=(start,end)=>Math.max(1,Math.round((end-start)/86400000)+1)`],
  ["@/components/icons",`import React from'react';export const IconCheck=props=><span {...props}>✓</span>;export const IconPlus=props=><span {...props}>+</span>`],
 ]);
 const plugin={name:"recommendations-component-fixture",setup(build){for(const[specifier,contents]of aliases){const escaped=specifier.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");build.onResolve({filter:new RegExp("^"+escaped+"$")},()=>({path:specifier,namespace:"fixture"}));build.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"tsx",resolveDir:root,contents:aliases.get(args.path)}));}}};
 const bundle=await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",tsconfig:path.join(root,"tsconfig.json"),plugins:[plugin],define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"}});
 const css=await postcss([require("@tailwindcss/postcss")({base:root})]).process(fs.readFileSync(path.join(root,"src/app/globals.css"),"utf8"),{from:path.join(root,"src/app/globals.css")});
 const server=http.createServer((req,res)=>{if(req.url==="/bundle.js"){res.setHeader("content-type","text/javascript");return res.end(bundle.outputFiles[0].text)}if(req.url==="/style.css"){res.setHeader("content-type","text/css");return res.end(css.css)}if(req.url==="/gear.webp"){res.setHeader("content-type","image/webp");return res.end(fs.readFileSync(path.join(root,"public/images/management/documents-kit-spotlight.webp")))}res.setHeader("content-type","text/html");res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="margin:0;padding:16px;background:#111;color:#eee;font:14px Arial"><div id="root"></div><script>window.__addedItems=[];window.__catalog=[{_id:'sony-fx3',title:'Sony FX3 cinema camera',slug:'sony-fx3',itemType:'camera-body',heroImage:'/gear.webp',imageSources:[],pricing:{daily:40},depositAmount:0,available:true,automaticEligible:true}];window.__live={groups:{'camera-body':{options:window.__catalog}},basket:[],selected:[],compatibilityKits:[]};window.__query=(ref,args)=>{if(ref==='recommendations.forContext')return window.__catalog;if(ref==='catalog.getListingBySlug')return undefined;if(ref==='availability.forCart')return Object.fromEntries((args?.items||[]).map(item=>[String(item.listingId),{ok:true}]));return undefined};window.__quote=async args=>{window.__quotes=(window.__quotes||[]).concat([args]);return{items:args.items.map(item=>{const days=Math.max(1,Math.round((item.end-item.start)/86400000)+1),rate=40;return{dailyRate:rate,total:rate*days*(days>=3?.8:1)}})}};window.__cartContext=null;</script><script src="/bundle.js"></script>`)});
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),"dbc-recommendations-chrome-"));
 const chrome=spawn("/opt/google/chrome/chrome",["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${profile}`],{stdio:"ignore"});
 let browser;
 try{
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));let port;
  for(let attempt=0;attempt<100;attempt++){try{port=fs.readFileSync(path.join(profile,"DevToolsActivePort"),"utf8").split("\n")[0];break}catch{await wait(100)}}assert(port,"Chromium exposes a local inspection port");process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;browser=await connect();await browser.cmd("Page.enable");await browser.cmd("Runtime.enable");
  for(const width of [390,1280]){
   await browser.cmd("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});await browser.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/`});
   const until=async(expression,label)=>{for(let attempt=0;attempt<100;attempt++){if(await browser.evaluate(expression))return;await wait(50)}throw Error(label)};
   await until(`!!document.querySelector('section button.group')`,"Live recommendation photo cards render");
   assert.equal(await browser.evaluate(`document.querySelector('[data-testid="basket-count"]').textContent`),"0","A recommendation is not added before the renter selects and confirms it");
   await until(`(()=>{const img=document.querySelector('section button.group img');return img?.complete&&img.naturalWidth>0})()`,"The real equipment photograph loads");
   await browser.evaluate(`document.querySelector('section button.group').click()`);
   await until(`document.querySelector('section button.btn-primary')?.textContent.includes('Add 1 to kit')&&!document.querySelector('section button.btn-primary').disabled`,"Selecting a recommendation produces an authoritative live quote");
   await browser.evaluate(`document.querySelector('[data-testid="recommendation-day-plus"]').click()`);
   await until(`document.querySelector('[data-testid="recommendation-rental-days"]')?.textContent.includes('3 days')&&document.querySelector('[data-testid="recommendation-duration-quote"]')?.textContent.includes('Save £24.00')`,"The multi-day arrow refreshes the total and shows its saving");
   const quote=await browser.evaluate(`document.querySelector('[data-testid="recommendation-duration-quote"]').innerText`);assert.match(quote,/3-day gear subtotal · £96\.00/);assert.match(quote,/Save £24\.00/);assert.match(quote,/Basket discounts and fees are calculated at checkout/);
   assert.equal(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,`Recommendation layout does not overflow at ${width}px`);
   const selectedShot=await browser.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync(`/tmp/dbc-recommendations-${width}-selected.png`,Buffer.from(selectedShot.data,"base64"));
   await browser.evaluate(`document.querySelector('section button.btn-primary').click()`);
   await until(`document.querySelector('[data-testid="basket-count"]')?.textContent==='1'`,"Confirmed recommendation enters the basket");
   const added=await browser.evaluate(`window.__addedItems[0]`);
   assert.equal(added.listingId,"sony-fx3");assert.equal(added.start,"2030-01-01");assert.equal(added.end,"2030-01-03");assert.equal(added.days,3);assert.equal(added.total,96);assert.equal(added.perDay,40);assert.equal(added.title,"Sony FX3 cinema camera");
   assert.equal(await browser.evaluate(`document.querySelectorAll('section input[type="time"]').length`),0,"Exact pickup and return times remain for checkout");
   const screenshot=await browser.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync(`/tmp/dbc-recommendations-${width}-added.png`,Buffer.from(screenshot.data,"base64"));
   console.log(`PASS recommendation selection, refreshed 3-day savings, real image, cart add and ${width}px layout`);
  }
  await browser.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?race=1`});
  const untilRace=async(expression,label)=>{for(let attempt=0;attempt<120;attempt++){if(await browser.evaluate(expression))return;await wait(50)}throw Error(label)};
  await untilRace(`!!document.querySelector('section button.group')`,'Race fixture renders');
  await browser.evaluate(`document.querySelector('section button.group').click()`);
  await untilRace(`document.querySelector('section button.btn-primary')?.textContent.includes('Add 1 to kit')&&!document.querySelector('section button.btn-primary').disabled`,'Race fixture quote is ready');
  await browser.evaluate(`window.__originalQuote=window.__quote;window.__quote=async args=>{await new Promise(resolve=>{window.__resumeQuote=resolve});return window.__originalQuote(args)};document.querySelector('section button.btn-primary').click()`);
  await untilRace(`!!window.__resumeQuote`,'Final add quote is pending');
  await browser.evaluate(`window.__setEnd('2030-01-04')`);await wait(100);
  await browser.evaluate(`window.__resumeQuote()`);await wait(500);
  assert.equal(await browser.evaluate(`window.__addedItems.length`),0,'A changed rental window cannot add a stale quote');
  await browser.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?unmount=1`});
  await untilRace(`!!document.querySelector('section button.group')`,'Unmount fixture renders');
  await browser.evaluate(`document.querySelector('section button.group').click()`);
  await untilRace(`document.querySelector('section button.btn-primary')?.textContent.includes('Add 1 to kit')&&!document.querySelector('section button.btn-primary').disabled`,'Unmount fixture quote is ready');
  await browser.evaluate(`window.__originalQuote=window.__quote;window.__quote=async args=>{await new Promise(resolve=>{window.__resumeQuote=resolve});return window.__originalQuote(args)};document.querySelector('section button.btn-primary').click()`);
  await untilRace(`!!window.__resumeQuote`,'Unmount fixture final quote is pending');
  await browser.evaluate(`window.__setShow(false)`);await wait(100);await browser.evaluate(`window.__resumeQuote()`);await wait(300);
  assert.equal(await browser.evaluate(`window.__addedItems.length`),0,'A quote cannot add equipment after the recommendation view unmounts');
 }finally{if(browser){browser.close();await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(()=>{})}if(chrome.exitCode===null){const done=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill();await done}await new Promise(resolve=>server.close(resolve));await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1});
