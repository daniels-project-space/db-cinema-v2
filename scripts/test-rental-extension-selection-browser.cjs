const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const esbuild = require("esbuild");
const { spawn } = require("node:child_process");
const source = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = path.resolve(__dirname, "..");
  const entry = `import React from 'react';
import { createRoot } from 'react-dom/client';
import { RentalExtensionPanel } from './src/components/rentals/RentalExtensionPanel';
const root=createRoot(document.getElementById('root'));
window.renderFixture=()=>root.render(<RentalExtensionPanel token="renter-token" bookingId="fixture-booking"/>);
window.renderFixture();`;
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    plugins: [{
      name: "rental-extension-fixture",
      setup(build) {
        build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|@\/lib\/pricing|@\/lib\/site|@\/lib\/rentalPresentation|@\/components\/SmartImage)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
          loader: "js",
          resolveDir: root,
          contents: args.path === "convex/react"
            ? `export const useQuery=(ref,args)=>ref==='rentalExtensions.state'?window.fixture.state:args==='skip'?undefined:window.fixture.quote(args);
               export const useMutation=ref=>async args=>{window.requests.push(args);return {ok:true}};
               export const useAction=()=>async args=>({ok:true});`
            : args.path === "@/lib/pricing"
              ? `export const formatGbp=value=>'£'+Number(value).toFixed(2);`
              : args.path === "@/lib/site"
                ? `export const PICKUP_SLOTS=['10:00','12:00','16:00','17:00'];export const HOURS_LABEL='10:00–18:00';`
                : args.path === "@/lib/rentalPresentation"
                  ? `export const rentalTitle=value=>value;`
                  : args.path === "@/components/SmartImage"
                    ? `import{createElement}from'react';export function SmartImage({src,alt,className}){return createElement('img',{src,alt,className})}`
                    : `export const api={rentalExtensions:{state:'rentalExtensions.state',quote:'rentalExtensions.quote',request:'request',decline:'decline'},rentalExtensionPayments:{approve:'approve',withdraw:'withdraw'},cartReplacements:{forCart:'replacements'}};`,
        }));
      },
    }],
  });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") {
      response.setHeader("content-type", "text/javascript");
      return response.end(bundle.outputFiles[0].text);
    }
    response.setHeader("content-type", "text/html");
    response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#151515;color:#eee"><div id="root"></div><script>window.requests=[];window.quoteCalls=[];window.fixture={state:{status:"active",locked:false,pickupTime:"10:00",returnTime:"17:00",items:[{index:0,listingId:"body",title:"Camera body",qty:1,start:1896048000000,end:1896134400000,returnTime:"17:00",imageSources:["https://hygglo.imgix.net/products/73d7d0_sony-fx-3-4k-mirrorless-full-frame-cinema-camera-audio-handle-24-70mm-f28-g-master-zoom-lens-set-gmaster-g-master-sony-fx3-fx3-a7siii-a7s-iii-a7-siii-alpha-camera-cannon-nikon-fuji.jpg?cs=strip&fm=pjpg&q=70"]},{index:1,listingId:"lens",title:"Lens kit",qty:1,start:1896048000000,end:1896134400000,returnTime:"17:00",imageSources:["https://hygglo.imgix.net/fat-llama/products/gmaster-lens-sony-2470mm-f28-21919134.jpeg?cs=strip&fm=pjpg&q=70"]}],requests:[],paymentsEnabled:true},quote(args){const indexes=args.lineItemIndexes??[0,1];window.quoteCalls.push(indexes);const conflict=indexes.length===2;const index=conflict?0:indexes[0];return {available:true,partialAvailability:conflict,availableIndexes:conflict?[0]:indexes,individuallyAvailableIndexes:conflict?[0,1]:indexes,selectionConflictItems:conflict?[{lineIndex:1,title:"Lens kit",qty:1,reason:"This item can be extended on its own."}]:[],unavailableItems:[],items:[{lineIndex:index,title:index===0?"Camera body":"Lens kit",qty:1,start:1896220800000,end:1896307200000,lineTotal:index===0?12.34:24.68}],priceDelta:index===0?12.34:24.68,baseLines:"fixture-base",benefitSaving:0}}};</script><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-extension-selection-"));
  const attachedBrowser = !!process.env.DBC_CDP_URL;
  const chrome = attachedBrowser ? null : spawn(process.env.CHROME_BIN || "/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${process.env.CHROME_DEBUG_PORT || "0"}`, `--user-data-dir=${profile}`], { stdio: "ignore" });
  let client;
  try {
    let port = process.env.CHROME_DEBUG_PORT || (attachedBrowser ? new URL(process.env.DBC_CDP_URL).port : undefined);
    for (let attempt = 0; !port && attempt < 100; attempt++) {
      try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); }
    }
    assert(port);
    if (!attachedBrowser) process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect();
    await client.cmd("Page.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.addScriptToEvaluateOnNewDocument", { source: "window.errors=[];window.addEventListener('error',event=>window.errors.push(event.message));" });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="request-extension-open"]')`); attempt++) await wait(50);
    const hasEntry = await client.evaluate(`!!document.querySelector('[data-testid="request-extension-open"]')`);
    const diagnostics = await client.evaluate(`JSON.stringify({errors:window.errors,fixture:!!window.fixture,root:!!document.getElementById('root'),body:document.body.textContent.slice(-200)})`);
    assert.equal(hasEntry, true, `extension entry point should render; ${diagnostics}`);
    await client.evaluate(`document.querySelector('[data-testid="request-extension-open"]').click()`);
    await client.evaluate(`(()=>{const select=document.querySelector('[data-testid="extension-return-time"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'16:00');select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="extension-selection-conflicts"]')`); attempt++) await wait(50);
    assert.match(await client.evaluate("document.body.textContent"), /Available individually · not together/);
    assert.match(await client.evaluate("document.body.textContent"), /Can extend alone · selection conflict/);
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="extension-unavailable-items"]')`), false, "an individually available line is not placed in the unavailable section");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="extension-send-request"]').disabled`), true, "a conflicted selection cannot submit an underquoted subset");
    assert.equal(await client.evaluate(`document.querySelectorAll('fieldset input[type="checkbox"]')[1].disabled`), false, "the individually available conflict line remains toggleable");
    fs.writeFileSync("/tmp/dbc-extension-selection-conflict.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.evaluate(`document.querySelector('[data-testid="extension-quote-line-1"]').click()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`document.querySelector('[data-testid="extension-send-request"]')&&!document.querySelector('[data-testid="extension-send-request"]').disabled`); attempt++) await wait(50);
    assert.equal(await client.evaluate(`document.querySelectorAll('fieldset input[type="checkbox"]')[0].checked`), false);
    assert.equal(await client.evaluate(`document.querySelectorAll('fieldset input[type="checkbox"]')[1].checked`), true);
    assert.match(await client.evaluate("document.body.textContent"), /£24\.68/);
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="extension-selection-conflicts"]')`), false, "the re-quote now prices the selected line by itself");
    fs.writeFileSync("/tmp/dbc-extension-selection-quoted.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.evaluate(`document.querySelector('[data-testid="extension-send-request"]').click()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate("window.requests.length"); attempt++) await wait(50);
    const request = await client.evaluate("window.requests[0]");
    assert.deepEqual(request.lineItemIndexes, [1], "only the renter-selected, re-quoted line is submitted");
    assert.equal(request.expectedAmount, 24.68);
    assert.equal(await client.evaluate("window.fixture.state.items[0].end"), 1896134400000, "the other line retains its original deadline");
    assert.equal(await client.evaluate("window.fixture.state.items[1].end"), 1896134400000, "selection changes do not mutate booking deadlines");
    console.log("PASS rental extension selection: individually available conflict stays toggleable, re-quotes, and submits only the selected line; synthetic fixtures only.");
  } finally {
    if (client) { client.close(); try { await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`); } catch {} }
    if (chrome && chrome.exitCode === null) {
      const done = new Promise(resolve => chrome.once("exit", resolve));
      chrome.kill();
      await done;
    }
    server.close();
    await wait(100);
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
