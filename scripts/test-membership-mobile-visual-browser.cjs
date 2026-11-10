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
const aliases = new Map([
  ["next/link", `import React from "react";export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`],
  ["next/navigation", `export function useRouter(){return{push(){},replace(){}}}`],
  ["convex/react", `export function useAction(){return async()=>({url:"/fixture-checkout"})}`],
  ["@cvx/_generated/api", `export const api=new Proxy({}, {get:(_,namespace)=>new Proxy({}, {get:(_,name)=>String(namespace)+"."+String(name)})})`],
  ["@/components/cart/CheckoutStatus", `import React from "react";export function useCheckoutStatus(){return{enabled:true,loading:false}}export function CheckoutPauseNotice(){return null}`],
  ["@/components/account/AccountProvider", `export function useAccount(){return{me:null,token:null}}`],
  ["@/components/SiteHeader", `import React from "react";export function SiteHeader(){return <header className="sticky top-0 z-40 flex min-h-14 items-center justify-between border-b border-white/10 bg-black px-4 text-sm text-white"><a href="/">DB CINEMA</a><a href="/gear" className="hidden md:inline">Gear</a></header>}`],
  ["@/components/MembershipHero", `import React from "react";export function MembershipHero(){return <section className="mx-auto max-w-3xl py-5 text-center sm:py-8"><p className="hud-label text-accent-300">Make room for more stories</p><h1 className="mt-3 font-display text-3xl font-semibold text-white sm:text-5xl">Membership for your next shoot</h1><p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/60">Monthly credit for the kit you use to make your next project.</p></section>}`],
  ["@/components/Reveal", `import React from "react";export function Reveal({children,className=""}){return <div className={className}>{children}</div>}`],
  ["@/components/Tilt", `import React from "react";export function Tilt({children,className=""}){return <div className={className}>{children}</div>}`],
  ["@/components/icons", `import React from "react";export function IconCheck(props){return <svg {...props} viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6" fill="none" stroke="currentColor" strokeWidth="2"/></svg>}`],
]);
const plugin={name:"membership-mobile-fixture",setup(build){for(const[specifier,contents]of aliases){const escaped=specifier.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");build.onResolve({filter:new RegExp("^"+escaped+"$")},()=>({path:specifier,namespace:"membership-fixture"}));build.onLoad({filter:/.*/,namespace:"membership-fixture"},args=>({loader:"tsx",resolveDir:root,contents:aliases.get(args.path)}));}}};

async function main(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"dbc-membership-mobile-"));
  const result=await esbuild.build({entryPoints:[path.join(root,"scripts/fixtures/membership-mobile-route.tsx")],outfile:path.join(temp,"bundle.js"),bundle:true,platform:"browser",format:"iife",jsx:"automatic",tsconfig:path.join(root,"tsconfig.json"),plugins:[plugin],define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"}});
  const js=fs.readFileSync(path.join(temp,"bundle.js"),"utf8");assert(js.length>20_000,"The real membership page and plan cards are bundled");
  const css=await require("postcss")([require("@tailwindcss/postcss")({base:root})]).process(fs.readFileSync(path.join(root,"src/app/globals.css"),"utf8"),{from:path.join(root,"src/app/globals.css")});
  const server=http.createServer((req,res)=>{if(req.url==="/bundle.js"){res.setHeader("content-type","text/javascript");return res.end(js)}if(req.url==="/style.css"){res.setHeader("content-type","text/css");return res.end(css.css)}res.setHeader("content-type","text/html");res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><style>html,body,#root{margin:0;min-height:100%;background:#08090a;color:#eee}button,input{font:inherit}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`)});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),"dbc-membership-chrome-"));const chrome=spawn("/opt/google/chrome/chrome",["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${profile}`],{stdio:"ignore"});let browser;
  try{
    let port;for(let attempt=0;attempt<100&&!port;attempt++){try{port=fs.readFileSync(path.join(profile,"DevToolsActivePort"),"utf8").split("\n")[0]}catch{await wait(100)}}assert(port);process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;browser=await connect("about:blank");await browser.cmd("Page.enable");await browser.cmd("Runtime.enable");browser.on(event=>{if(event.method==="Runtime.exceptionThrown")console.error("BROWSER",JSON.stringify(event.params).slice(0,800))});const out="/tmp/dbc-membership-mobile-audit";fs.mkdirSync(out,{recursive:true});
    for(const width of [320,390,430,768]){
      await browser.cmd("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:width<768});await browser.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/membership`});
      for(let attempt=0;attempt<100&&!await browser.evaluate(`document.querySelectorAll('[data-membership-plan]').length===3`);attempt++)await wait(50);
      const m=await browser.evaluate(`(()=>{const r=e=>{const b=e?.getBoundingClientRect();return b&&{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,plans:[...document.querySelectorAll('[data-membership-plan]')].map(r),offers:[...document.querySelectorAll('button[aria-pressed]')].map(e=>({label:e.querySelector('span')?.textContent.trim(),box:r(e),pressed:e.getAttribute('aria-pressed')})),table:r(document.querySelector('table')),tableScroll:r(document.querySelector('table')?.parentElement),subscribe:[...document.querySelectorAll('[data-membership-plan] button')].map(e=>({disabled:e.disabled,label:e.textContent.trim(),box:r(e)})),texts:[...document.querySelectorAll('h1,h2,p,button')].filter(e=>getComputedStyle(e).display!=='none').map(e=>({text:e.textContent.trim().slice(0,55),box:r(e)})).filter(x=>x.box.left < -1 || x.box.right>innerWidth+1)}})()`);
      assert(m.scrollWidth<=width,`Membership page has no page-level horizontal scroll at ${width}px: ${JSON.stringify(m)}`);assert.equal(m.plans.length,3);assert(m.plans.every(p=>p.left>=0&&p.right<=width),`Every plan card is inside ${width}px`);assert.deepEqual(m.texts,[],`No membership text clips at ${width}px`);assert(m.subscribe.every(x=>x.disabled),"Subscribe stays gated until the renter accepts terms");
      const shot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`membership-${width}-top.png`),Buffer.from(shot.data,"base64"));
      if(width===320){await browser.evaluate(`document.querySelector('button[aria-pressed="false"]')?.click()`);assert(await browser.evaluate(`document.querySelectorAll('button[aria-pressed="true"]').length===1`),"Welcome offer selection is tappable");await browser.evaluate(`document.querySelector('input[type="checkbox"]').click()`);assert(await browser.evaluate(`![...document.querySelectorAll('[data-membership-plan] button')].some(e=>e.disabled)`),"Accepting terms enables plan selection");await browser.evaluate(`document.querySelector('#membership-plans').scrollIntoView({block:'start'})`);await wait(500);const plans=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,"membership-320-plans.png"),Buffer.from(plans.data,"base64"));}
      console.log(`PASS membership layout ${width}px ${JSON.stringify({scrollWidth:m.scrollWidth,plans:m.plans.map(x=>({left:x.left,right:x.right,height:x.height})),table:m.table,subscribeDisabled:m.subscribe.every(x=>x.disabled)})}`);
    }
    console.log(`Screenshots: ${out}`);
  }finally{if(browser){browser.close();await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(()=>{})}if(chrome.exitCode===null){const done=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill();await done}await new Promise(resolve=>server.close(resolve));await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1});
