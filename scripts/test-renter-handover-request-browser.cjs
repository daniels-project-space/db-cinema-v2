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
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {RenterRentalTools} from './src/components/rentals/RenterRentalTools';import {RentalExtensionPanel} from './src/components/rentals/RentalExtensionPanel';import {RentalRequestHistory} from './src/components/rentals/RentalRequestHistory';createRoot(document.getElementById('root')).render(location.search.includes('admin=')?<RentalRequestHistory token="fixture-admin" bookingId="booking-handover" admin/>:<div className="conversation"><RenterRentalTools token="fixture-renter" bookingId="booking-handover"/><RentalExtensionPanel token="fixture-renter" bookingId="booking-handover"/></div>);`;

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-renter-handover-"));
  const moduleStyles = [];
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true, write: false, outdir: "fixture", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_CONVEX_URL": '"https://fixture.invalid"', "process.env": "{}" },
    plugins: [{ name: "renter-handover-fixture", setup(build) {
      build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|@\/components\/SmartImage|@\/lib\/pricing|@\/lib\/site|@\/lib\/rentalPresentation)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path, { paths: [root] }) }));
      build.onLoad({ filter: /\.module\.css$/ }, args => {
        const css = fs.readFileSync(args.path, "utf8"); moduleStyles.push(css);
        const names = [...new Set([...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map(match => match[1]))];
        return { loader: "js", contents: `export default ${JSON.stringify(Object.fromEntries(names.map(name => [name, name])))};` };
      });
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
        if (args.path === "convex/react") return { loader: "jsx", contents: `export const useQuery=(ref,args)=>args==='skip'?undefined:window.fixtureQuery(String(ref),args);export const usePaginatedQuery=(ref,args)=>window.fixturePages(String(ref),args);export const useMutation=ref=>async args=>{window.fixtureCalls.push({ref:String(ref),args});return {ok:true}};export const useAction=ref=>async args=>{window.fixtureCalls.push({ref:String(ref),args});return String(ref)==='rentalRequests.approveAndApply'?{status:'applied',detail:'Updated'}:{ok:true}};` };
        if (args.path === "@cvx/_generated/api") return { loader: "js", contents: `const path=(a)=>new Proxy({}, {get:(_,b)=>a+'.'+String(b)});export const api=new Proxy({}, {get:(_,a)=>path(String(a))});` };
        if (args.path === "@/lib/pricing") return { loader: "js", contents: `export const formatGbp=value=>'£'+Number(value||0).toFixed(2);` };
        if (args.path === "@/lib/site") return { loader: "js", contents: `export const PICKUP_SLOTS=['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];export const HOURS_LABEL='09:00–18:00';` };
        if (args.path === "@/lib/rentalPresentation") return { loader: "js", contents: `export const rentalTitle=value=>value;` };
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
      window.fixtureQuery=(ref,args)=>{const status=new URLSearchParams(location.search).get('status')||'confirmed';if(ref==='rentalRequests.context')return{status,actionReady:status!=='pending_verification',canRequestPaidPendingCancellation:status==='pending_verification',start,end,items,cancellationKind:'full_refund',cancellationFullRefundDays:7,cancellationTermsVersion:'2026-11-v21',direct:true,selfService:true,locked:false};if(ref==='rentalOperations.renterHandoverPreview')return{ok:true,controlsSnapshot:'fixture-snapshot',lineIndexes:[...args.lineIndexes].sort((a,b)=>a-b),kind:args.kind,time:args.time};if(ref==='rentalOperations.details')return{_id:'booking-handover',status:'confirmed',lineItems:items,cancellationKind:'full_refund',cancellationTermsVersion:'2026-11-v21'};if(ref==='rentalExtensions.state')return{status,actionReady:['confirmed','active'].includes(status),locked:false,requests:[],items,start,end,pickupTime:'10:00',returnTime:'18:00',paymentsEnabled:true};if(ref==='rentalExtensions.quote')return{available:true,items:[],priceDelta:15,baseLines:[],benefitSaving:0,unavailableItems:[],selectionConflictItems:[]};if(ref==='cartReplacements.forCart')return{items:[]};return null;};
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
    for(const device of [{width:320,height:760,mobile:true,status:"confirmed"},{width:390,height:844,mobile:true,status:"confirmed"},{width:430,height:932,mobile:true,status:"confirmed"},{width:768,height:1024,mobile:false,status:"confirmed"},{width:1280,height:900,mobile:false,status:"active"},{width:1440,height:960,mobile:false,status:"confirmed"}]){
      await client.cmd("Emulation.setDeviceMetricsOverride",{width:device.width,height:device.height,deviceScaleFactor:1,mobile:device.mobile});
      await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/?status=${device.status}`});
      for(let i=0;i<100&&!await client.evaluate(`!!document.querySelector('[data-testid="renter-request-handover"]')`);i++)await wait(50);
      assert.equal(await client.evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,`No horizontal overflow at ${device.width}px`);
      if(device.width<768){
        assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="renter-actions-toggle"]')).display!=='none'`),true,`One compact Rental actions entry is visible at ${device.width}px`);
        assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('#renter-request-action-list')).display`),"none",`Individual request controls stay tucked away at ${device.width}px`);
        assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="rental-extension-panel"]')).display`),"none",`The standalone extension trigger does not consume phone space at ${device.width}px`);
        const compact=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync(`/tmp/dbc-renter-actions-${device.width}.png`,Buffer.from(compact.data,"base64"));
        await client.evaluate(`document.querySelector('[data-testid="renter-actions-toggle"]').click()`);await wait(50);
        assert.equal(await client.evaluate(`document.querySelector('[data-testid="renter-actions-toggle"]').getAttribute('aria-expanded')`),"true","The Rental actions disclosure exposes its existing choices");
        await client.evaluate(`document.querySelector('[data-testid="renter-request-extension"]').click()`);await wait(100);
        assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="extension-request-form"]')`),true,"Phone extension entry opens the existing extension request form");
        if(device.width===390){const extensionShot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-renter-extension-390.png",Buffer.from(extensionShot.data,"base64"));}
        await client.evaluate(`document.querySelector('[data-testid="request-extension-open"]').click()`);await wait(60);
      } else {
        assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="renter-actions-toggle"]')).display`),"none",`Desktop controls remain in their existing layout at ${device.width}px`);
        assert.equal(await client.evaluate(`document.querySelector('[data-testid="renter-request-handover"]').getClientRects().length>0`),true,`Desktop request controls remain directly visible at ${device.width}px`);
        if(await client.evaluate(`!!document.querySelector('[data-testid="request-extension-open"]')`)){
          await client.evaluate(`document.querySelector('[data-testid="request-extension-open"]').click()`);await wait(100);
          assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="extension-request-form"]')`),true,"Desktop extension trigger opens the existing form");
          await client.evaluate(`document.querySelector('[data-testid="request-extension-open"]').click()`);await wait(60);
        }
        const actionShot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync(`/tmp/dbc-renter-actions-${device.width}.png`,Buffer.from(actionShot.data,"base64"));
      }
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
      if(device.width<768)await client.evaluate(`document.querySelector('[data-testid="renter-actions-toggle"]').click()`);
      await client.evaluate(`document.querySelector('[data-testid="renter-request-items"]').click()`);await wait(80);
      assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="renter-item-change-0"],[data-testid="renter-item-change-1"]').length`),2,"The kit-change form lists each booked item");
      assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="renter-item-change-0"] input:checked,[data-testid="renter-item-change-1"] input:checked').length`),2,"All booked lines start selected");
      assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="renter-item-change-items"] img').length`),2,"Each selected item has its supplied listing photo");
      assert.match(await client.evaluate(`document.querySelector('[data-testid="renter-item-change-items"]').textContent`),/Original return · 2 May · 18:00/);
      assert.match(await client.evaluate(`document.querySelector('[data-testid="renter-item-change-items"]').textContent`),/Return the current items at the original booked time/);
      await client.evaluate(`(()=>{document.querySelector('[data-testid="renter-item-change-1"] input').click();const reason=document.querySelector('[data-testid="renter-item-change-request"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(reason,'Please swap the camera for a lighter body.');reason.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      assert.equal(await client.evaluate(`document.querySelector('form button:not([type="button"])').disabled`),false,"The request can be sent once an item and a reason are supplied");
      const itemChangeScreenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync(`/tmp/dbc-renter-item-change-${device.width}.png`,Buffer.from(itemChangeScreenshot.data,"base64"));
      await client.evaluate(`document.querySelector('form button:not([type="button"])').click()`);await wait(120);
      const itemChangeCall=(await client.evaluate("window.fixtureCalls")).at(-1);assert.equal(itemChangeCall.ref,"rentalRequests.submit");assert.equal(itemChangeCall.args.kind,"items");assert.deepEqual(itemChangeCall.args.itemLineIndexes,[0],"The selected camera line is sent as structured request data");assert.equal(itemChangeCall.args.detail,"Please swap the camera for a lighter body.","The renter’s explanation stays short and free of duplicated listing text");
      assert.match(await client.evaluate(`document.querySelector('[role="status"]')?.textContent||''`),/team will check availability and price.*Nothing changes until you accept/i);
      assert.equal(await client.evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,`Request stays within ${device.width}px`);
      const screenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync(`/tmp/dbc-renter-handover-${device.width}.png`,Buffer.from(screenshot.data,"base64"));
    }
    await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/?status=pending_verification`});
    for(let i=0;i<100&&!await client.evaluate(`!!document.querySelector('[data-testid="renter-request-cancel"]')`);i++)await wait(50);
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="renter-request-items"],[data-testid="renter-request-handover"],[data-testid="renter-request-dates"]')`),false,"Pending Didit exposes cancellation only, not rental-change actions");
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="rental-extension-panel"]')`),false,"The separate extension panel also stays hidden until verification completes");
    await client.evaluate(`document.querySelector('[data-testid="renter-request-cancel"]').click()`);await wait(80);
    assert.match(await client.evaluate(`document.querySelector('form').textContent`),/full refund to the original payment method or 100% account credit/i,"The accepted full-refund options are shown before the renter submits");
    const pendingCancellationShot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-renter-pending-cancellation.png",Buffer.from(pendingCancellationShot.data,"base64"));
    await client.evaluate(`(()=>{const reason=document.querySelector('[aria-label="Cancellation request details"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(reason,'Please cancel my rental under the accepted terms.');reason.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('input[type="radio"]').click();})()`);await wait(60);
    assert.equal(await client.evaluate(`document.querySelector('form button:not([type="button"])').disabled`),false,"The renter can send the cancellation choice and reason for team review");
    await client.evaluate(`document.querySelector('form button:not([type="button"])').click()`);await wait(100);
    const pendingCancellationCall=(await client.evaluate("window.fixtureCalls")).at(-1);assert.equal(pendingCancellationCall.ref,"rentalRequests.submit");assert.equal(pendingCancellationCall.args.kind,"cancel");assert.equal(pendingCancellationCall.args.cancellationChoice,"refund");assert.match(pendingCancellationCall.args.detail,/Please cancel my rental/);
    await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/?admin=pending`});
    for(let i=0;i<100&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent.includes('Review & apply time'))`);i++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Review & apply time')).click()`);await wait(60);
    await client.evaluate(`(()=>{const input=document.querySelector('[aria-label="Reply to request"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Approved for 19:00 return time.');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form button:not([type="button"])').click()})()`);await wait(100);
    let adminCalls=await client.evaluate("window.fixtureCalls");assert.equal(adminCalls.length,1,"One approval action owns the guarded review-and-apply flow");assert.equal(adminCalls[0].ref,"rentalRequests.approveAndApply");assert.equal(adminCalls[0].args.id,"rental_change_requests-browser-1");assert.equal(adminCalls[0].args.note,"Approved for 19:00 return time.");const approvalNotice=await client.evaluate("document.querySelector('[role=\"status\"]')?.textContent||''");assert.match(approvalNotice,/Approved and applied here/i);assert.match(approvalNotice,/Rental Manager sync is shown below/i);assert.doesNotMatch(approvalNotice,/Rental Manager are updated/i);
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
      console.log("PASS renter/admin requests: compact phone Rental actions + existing extension form at 320/390/430px; unchanged controls at 768/1280/1440px; image-backed kit selection, original return guidance, all/selected handover items, live availability, active return-only rule, manual approve/decline, and exact approved application.");
  } finally {
    if(client){client.close();try{await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`)}catch{}}
    if(chrome&&chrome.exitCode===null){const done=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill();await done;}
    await new Promise(resolve=>server.close(resolve));await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
