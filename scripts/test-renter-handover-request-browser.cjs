const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");

const root = path.resolve(__dirname, "..");
const helper = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", `${helper.slice(0, helper.indexOf("const { ConvexHttpClient }"))};return connect;`)(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {RenterRentalTools} from './src/components/rentals/RenterRentalTools';import {RentalRequestHistory} from './src/components/rentals/RentalRequestHistory';createRoot(document.getElementById('root')).render(location.search.includes('admin=')?<RentalRequestHistory token="fixture-admin" bookingId="booking-handover" admin/>:<RenterRentalTools token="fixture-renter" bookingId="booking-handover"/>);`;

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-renter-handover-"));
  const moduleStyles = [];
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true, write: false, outdir: "fixture", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_CONVEX_URL": '"https://fixture.invalid"', "process.env": "{}" },
    plugins: [{ name: "renter-handover-fixture", setup(build) {
      build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|@\/components\/SmartImage)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path, { paths: [root] }) }));
      build.onLoad({ filter: /\.module\.css$/ }, args => {
        const css = fs.readFileSync(args.path, "utf8"); moduleStyles.push(css);
        const names = [...new Set([...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map(match => match[1]))];
        return { loader: "js", contents: `export default ${JSON.stringify(Object.fromEntries(names.map(name => [name, name])))};` };
      });
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
        if (args.path === "convex/react") return { loader: "jsx", contents: `export const useQuery=(ref,args)=>args==='skip'?undefined:window.fixtureQuery(String(ref),args);export const usePaginatedQuery=(ref,args)=>window.fixturePages(String(ref),args);export const useMutation=ref=>async args=>{window.fixtureCalls.push({ref:String(ref),args});return {ok:true}};export const useAction=ref=>async args=>{window.fixtureCalls.push({ref:String(ref),args});return {ok:true}};` };
        if (args.path === "@cvx/_generated/api") return { loader: "js", contents: `const path=(a)=>new Proxy({}, {get:(_,b)=>a+'.'+String(b)});export const api=new Proxy({}, {get:(_,a)=>path(String(a))});` };
        return { loader: "jsx", contents: `import React from 'react';export function SmartImage({src,alt,className}){return <img src={src||''} alt={alt||''} className={className||''}/>} ` };
      });
    }}],
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  assert(script, "Renter handover fixture bundle contains JavaScript");
  const globalCss = (await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") })).css;
  const photo = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='60'%3E%3Crect width='80' height='60' fill='%23b98c66'/%3E%3C/svg%3E";
  const server = http.createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("content-type", "application/javascript"); return res.end(script); }
    if (req.url === "/fixture.css") { res.setHeader("content-type", "text/css"); return res.end(`${globalCss}\n${moduleStyles.join("\n")}`); }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>html,body,#root{margin:0;min-height:100%;background:#101111;color:#f2ede4;font-family:Arial,sans-serif}*{box-sizing:border-box}#root{max-width:720px;margin:0 auto;padding:12px}</style></head><body><div id="root"></div><script>
      window.fixtureCalls=[];const photo=${JSON.stringify(photo)},start=Date.UTC(2030,4,1,15),end=start+86400000;
      const items=[{index:0,listingId:'camera',title:'Sony FX3 camera',qty:1,start,end,pickupTime:'10:00',returnTime:'18:00',heroImage:photo,imageSources:[photo]},{index:1,listingId:'lens',title:'Sony 24–70mm lens',qty:2,start,end,pickupTime:'10:00',returnTime:'18:00',heroImage:photo,imageSources:[photo]}];
      window.fixtureQuery=(ref,args)=>{if(ref==='rentalRequests.context')return{status:new URLSearchParams(location.search).get('status')||'confirmed',actionReady:true,start,end,items,cancellationKind:'full_refund',cancellationFullRefundDays:7,cancellationTermsVersion:'2026-11-v21',direct:true,selfService:true,locked:false};if(ref==='rentalOperations.renterHandoverPreview')return{ok:true,controlsSnapshot:'fixture-snapshot',lineIndexes:[...args.lineIndexes].sort((a,b)=>a-b),kind:args.kind,time:args.time};if(ref==='rentalOperations.details')return{_id:'booking-handover',status:'confirmed',lineItems:items,cancellationKind:'full_refund',cancellationTermsVersion:'2026-11-v21'};return null;};
      window.fixturePages=(ref,args)=>{const admin=new URLSearchParams(location.search).get('admin');if(ref==='rentalRequests.list'&&args.admin){const status=admin==='approved'?'approved':'pending';return{results:[{_id:'rental_change_requests-browser-1',requestId:'browser-handover-request-01',kind:'handover',detail:'The shoot is running late.',createdAt:Date.UTC(2030,4,1),requestedSnapshot:'fixture-snapshot',requestedHandover:{lineIndexes:[1],kind:'return',time:'19:00'},handoverItems:[{lineIndex:1,title:'Sony 24–70mm lens',qty:2}],status,decisionNote:status==='approved'?'Approved for 19:00 return.':undefined}],status:'Exhausted',loadMore:()=>{}};}return{results:[],status:'Exhausted',loadMore:()=>{}};};
    </script><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(temp, "chrome-"));
  const attached = !!process.env.DBC_CDP_URL;
  const chrome = attached ? null : spawn(process.env.CHROME_BIN || "/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let client;
  try {
    let port = attached ? new URL(process.env.DBC_CDP_URL).port : undefined;
    for (let i=0; !port && i<100; i++) { try { port=fs.readFileSync(path.join(profile,"DevToolsActivePort"),"utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port,"Headless Chrome starts for the isolated renter fixture");
    if(!attached)process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;
    client=await connect(); await client.cmd("Page.enable");
    for(const device of [{width:390,height:844,mobile:true,status:"confirmed"},{width:1280,height:900,mobile:false,status:"active"}]){
      await client.cmd("Emulation.setDeviceMetricsOverride",{width:device.width,height:device.height,deviceScaleFactor:1,mobile:device.mobile});
      await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/?status=${device.status}`});
      for(let i=0;i<100&&!await client.evaluate(`!!document.querySelector('[data-testid="renter-request-handover"]')`);i++)await wait(50);
      assert.equal(await client.evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,`No horizontal overflow at ${device.width}px`);
      await client.evaluate(`document.querySelector('[data-testid="renter-request-handover"]').click()`); await wait(80);
      assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid^="renter-handover-item-"]').length`),2);
      assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid^="renter-handover-item-"]:checked').length`),2,"All lines are selected by default");
      assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="renter-handover-items"] img').length`),2,"Selected listings use their real supplied photos");
      const kinds=await client.evaluate(`Array.from(document.querySelector('[data-testid="renter-handover-kind"]').options).map(option=>option.value)`);
      assert(device.status==="confirmed"?kinds.includes("pickup")&&kinds.includes("return"):!kinds.includes("pickup")&&kinds.includes("return"),"Confirmed rentals can request pickup or return; active rentals can request return only");
      await client.evaluate(`(()=>{const select=document.querySelector('[data-testid="renter-handover-kind"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'return');select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-testid="renter-handover-item-0"]').click();const time=document.querySelector('[data-testid="renter-handover-time"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(time,'19:00');time.dispatchEvent(new Event('change',{bubbles:true}));const reason=document.querySelector('[data-testid="renter-handover-reason"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(reason,'The shoot is running late.');reason.dispatchEvent(new Event('input',{bubbles:true}));})()`); await wait(100);
      assert.match(await client.evaluate(`document.querySelector('[role="status"]')?.textContent||''`),/available for the selected items/i);
      await client.evaluate(`document.querySelector('[data-testid="renter-handover-reason"]').closest('form').querySelector('button:not([type="button"])').click()`); await wait(120);
      const call=(await client.evaluate("window.fixtureCalls")).at(-1);
      assert.equal(call.ref,"rentalRequests.submit");assert.equal(call.args.kind,"handover");assert.equal(call.args.handoverKind,"return");assert.equal(call.args.handoverTime,"19:00");assert.deepEqual(call.args.handoverLineIndexes,[1]);assert.equal(call.args.detail,"The shoot is running late.");
      assert.equal(await client.evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,`Request stays within ${device.width}px`);
      const screenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync(`/tmp/dbc-renter-handover-${device.width}.png`,Buffer.from(screenshot.data,"base64"));
    }
    await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/?admin=pending`});
    for(let i=0;i<100&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent.includes('Review & apply time'))`);i++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Review & apply time')).click()`);await wait(60);
    await client.evaluate(`(()=>{const input=document.querySelector('[aria-label="Reply to request"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Approved for 19:00 return time.');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form button:not([type="button"])').click()})()`);await wait(100);
    let adminCalls=await client.evaluate("window.fixtureCalls");assert.equal(adminCalls.at(-2).ref,"rentalRequests.review");assert.equal(adminCalls.at(-2).args.decision,"approved");assert.equal(adminCalls.at(-1).ref,"rentalOperations.changeHandoverTimes");assert.equal(adminCalls.at(-1).args.requestId,"browser-handover-request-01");assert.equal(adminCalls.at(-1).args.changeRequestId,"rental_change_requests-browser-1");assert.deepEqual(adminCalls.at(-1).args.lineIndexes,[1]);assert.equal(adminCalls.at(-1).args.kind,"return");assert.equal(adminCalls.at(-1).args.time,"19:00");assert.equal(adminCalls.at(-1).args.expectedSnapshot,"fixture-snapshot");
    await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/?admin=pending`});
    for(let i=0;i<100&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent.includes('Decline request'))`);i++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Decline request')).click()`);await wait(60);
    await client.evaluate(`(()=>{const input=document.querySelector('[aria-label="Reply to request"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'The 19:00 slot is not available.');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form button:not([type="button"])').click()})()`);await wait(100);
    let adminCall=(await client.evaluate("window.fixtureCalls")).at(-1);assert.equal(adminCall.ref,"rentalRequests.review");assert.equal(adminCall.args.decision,"declined");
    await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/?admin=approved`});
    for(let i=0;i<100&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Apply approved time')`);i++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Apply approved time').click()`);await wait(100);
    await client.evaluate(`document.querySelector('form button:not([type="button"])').click()`);await wait(100);
    adminCall=(await client.evaluate("window.fixtureCalls")).at(-1);assert.equal(adminCall.ref,"rentalOperations.changeHandoverTimes");assert.equal(adminCall.args.requestId,"browser-handover-request-01");assert.equal(adminCall.args.changeRequestId,"rental_change_requests-browser-1");assert.deepEqual(adminCall.args.lineIndexes,[1]);assert.equal(adminCall.args.kind,"return");assert.equal(adminCall.args.time,"19:00");assert.equal(adminCall.args.expectedSnapshot,"fixture-snapshot");
    console.log("PASS renter/admin handover request flow: real listing photos, all/selected items, live availability, active return-only rule, manual approve/decline, and exact approved change application at 390px/1280px.");
  } finally {
    if(client){client.close();try{await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`)}catch{}}
    if(chrome&&chrome.exitCode===null){const done=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill();await done;}
    await new Promise(resolve=>server.close(resolve));await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
