const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const esbuild = require("esbuild");
const postcss = require("postcss");
const { spawn } = require("node:child_process");
const source = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = path.resolve(__dirname, "..");
  const css = await postcss([require("@tailwindcss/postcss")({ base: root })])
    .process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const entry = `import React from 'react';
import { createRoot } from 'react-dom/client';
import { RentalExtensionPanel } from './src/components/rentals/RentalExtensionPanel';
import { GafferExtensionOfferCard } from './src/components/rentals/GafferExtensionOfferCard';
const root=createRoot(document.getElementById('root'));
const offerHost=document.createElement('div');offerHost.id='offer';offerHost.style.cssText='max-width:480px;margin:16px auto';document.body.insertBefore(offerHost,document.getElementById('root'));
const offerRoot=createRoot(offerHost);
window.renderFixture=()=>root.render(<RentalExtensionPanel token="renter-token" bookingId="fixture-booking"/>);
window.renderAdminFixture=()=>root.render(<RentalExtensionPanel token="admin-token" bookingId="fixture-booking" admin={true}/>);
window.renderOfferFixture=()=>offerRoot.render(<GafferExtensionOfferCard offer={{quoteStatus:'partial',extraDays:2,total:12.34,availableIndexes:[0],items:[{lineIndex:0,title:'Camera body',qty:1,originalEnd:1896134400000,proposedEnd:1896307200000,returnTime:'16:00',days:2,lineTotal:12.34}],unavailableItems:[{lineIndex:1,title:'Lens kit',qty:1,originalEnd:1896134400000,originalReturnTime:'17:00',reason:'Already reserved for the requested dates.'}]}} bookingItems={[{index:0,title:'Camera body',imageSources:['https://hygglo.imgix.net/products/73d7d0_sony-fx-3-4k-mirrorless-full-frame-cinema-camera-audio-handle-24-70mm-f28-g-master-zoom-lens-set-gmaster-g-master-sony-fx3-fx3-a7siii-a7s-iii-a7-siii-alpha-camera-cannon-nikon-fuji.jpg?cs=strip&fm=pjpg&q=70']},{index:1,title:'Lens kit',imageSources:['https://hygglo.imgix.net/fat-llama/products/gmaster-lens-sony-2470mm-f28-21919134.jpeg?cs=strip&fm=pjpg&q=70']}]}/>);
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
               export const useAction=ref=>async args=>{window.actionCalls.push({ref,args});return {ok:true}};`
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
    if (request.url === "/style.css") {
      response.setHeader("content-type", "text/css");
      return response.end(css.css);
    }
    if (request.url === "/bundle.js") {
      response.setHeader("content-type", "text/javascript");
      return response.end(bundle.outputFiles[0].text);
    }
    response.setHeader("content-type", "text/html");
  response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="background:#151515;color:#eee"><div id="root"></div><script>window.requests=[];window.actionCalls=[];window.quoteCalls=[];window.fixture={state:{status:"active",actionReady:true,locked:false,pickupTime:"10:00",returnTime:"17:00",items:[{index:0,listingId:"body",title:"Camera body",qty:1,start:1896048000000,end:1896134400000,returnTime:"17:00",imageSources:["https://hygglo.imgix.net/products/73d7d0_sony-fx-3-4k-mirrorless-full-frame-cinema-camera-audio-handle-24-70mm-f28-g-master-zoom-lens-set-gmaster-g-master-sony-fx3-fx3-a7siii-a7s-iii-a7-siii-alpha-camera-cannon-nikon-fuji.jpg?cs=strip&fm=pjpg&q=70"]},{index:1,listingId:"lens",title:"Lens kit",qty:1,start:1896048000000,end:1896134400000,returnTime:"17:00",imageSources:["https://hygglo.imgix.net/fat-llama/products/gmaster-lens-sony-2470mm-f28-21919134.jpeg?cs=strip&fm=pjpg&q=70"]}],requests:[],paymentsEnabled:true},quote(args){const indexes=args.lineItemIndexes??[0,1];window.quoteCalls.push({indexes,requestedReturnTime:args.requestedReturnTime});const conflict=indexes.length===2;const index=conflict?0:indexes[0];return {available:true,requestedReturnTime:args.requestedReturnTime,partialAvailability:conflict,availableIndexes:conflict?[0]:indexes,individuallyAvailableIndexes:conflict?[0,1]:indexes,selectionConflictItems:conflict?[{lineIndex:1,title:"Lens kit",qty:1,reason:"This item can be extended on its own."}]:[],unavailableItems:[],items:[{lineIndex:index,title:index===0?"Camera body":"Lens kit",qty:1,start:1896220800000,end:1896307200000,lineTotal:index===0?12.34:24.68}],priceDelta:index===0?12.34:24.68,baseLines:"fixture-base",benefitSaving:0}}};</script><script src="/bundle.js"></script>');
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
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.addScriptToEvaluateOnNewDocument", { source: "window.errors=[];window.addEventListener('error',event=>window.errors.push(event.message));" });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="request-extension-open"]')`); attempt++) await wait(50);
    const hasEntry = await client.evaluate(`!!document.querySelector('[data-testid="request-extension-open"]')`);
    const diagnostics = await client.evaluate(`JSON.stringify({errors:window.errors,fixture:!!window.fixture,root:!!document.getElementById('root'),body:document.body.textContent.slice(-200)})`);
    assert.equal(hasEntry, true, `extension entry point should render; ${diagnostics}`);
    await client.evaluate("window.renderOfferFixture()");
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="gaffer-extension-card"]')`); attempt++) await wait(50);
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="gaffer-extension-card"] img').length`), 2, "chat extension cards reuse the real catalog photos from the booking summary when an older offer has no image payload");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="gaffer-extension-card"] img[alt="Camera body listing photo"]').getAttribute('src')`), "https://hygglo.imgix.net/products/73d7d0_sony-fx-3-4k-mirrorless-full-frame-cinema-camera-audio-handle-24-70mm-f28-g-master-zoom-lens-set-gmaster-g-master-sony-fx3-fx3-a7siii-a7s-iii-a7-siii-alpha-camera-cannon-nikon-fuji.jpg?cs=strip&fm=pjpg&q=70");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="gaffer-extension-card"] img[alt="Lens kit listing photo"]').getAttribute('src')`), "https://hygglo.imgix.net/fat-llama/products/gmaster-lens-sony-2470mm-f28-21919134.jpeg?cs=strip&fm=pjpg&q=70");
    const offerMobile = await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="gaffer-extension-card"]'),rect=card.getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,cardWidth:rect.width,cardHeight:rect.height,x:rect.x,y:rect.y}})()`);
    assert.equal(offerMobile.scrollWidth <= offerMobile.width, true, `the Gaffer extension card fits a 320px phone: ${JSON.stringify(offerMobile)}`);
    assert.match(await client.evaluate("document.querySelector('[data-testid=\"gaffer-extension-card\"]').textContent"), /Keep these on the original schedule/);
    assert.match(await client.evaluate("document.querySelector('[data-testid=\"extension-offer-unavailable-items\"]').textContent"), /17:00/);
    assert.match(await client.evaluate("document.querySelector('[data-testid=\"gaffer-extension-card\"]').textContent"), /£12\.34/);
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="gaffer-extension-card"] a[href*="checkout.stripe.com"]')`), false, "a Gaffer estimate never exposes a payment action before team approval");
    fs.writeFileSync("/tmp/dbc-gaffer-extension-card-mobile.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png", clip: { x: offerMobile.x, y: offerMobile.y, width: offerMobile.cardWidth, height: offerMobile.cardHeight, scale: 1 }, captureBeyondViewport: true })).data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const offerDesktop = await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="gaffer-extension-card"]'),rect=card.getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,cardWidth:rect.width,cardHeight:rect.height,x:rect.x,y:rect.y}})()`);
    assert.equal(offerDesktop.scrollWidth <= offerDesktop.width, true, `the Gaffer extension card fits desktop: ${JSON.stringify(offerDesktop)}`);
    fs.writeFileSync("/tmp/dbc-gaffer-extension-card-desktop.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png", clip: { x: offerDesktop.x, y: offerDesktop.y, width: offerDesktop.cardWidth, height: offerDesktop.cardHeight, scale: 1 }, captureBeyondViewport: true })).data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
    await client.evaluate(`document.querySelector('[data-testid="gaffer-extension-open"]').click()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`document.querySelector('[data-testid="rental-extension-panel"]').getAttribute('data-open')==='true'`); attempt++) await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="rental-extension-panel"]').getAttribute('data-open')`), "true", "the Gaffer chat action opens the real renter extension request form");
    assert.match(await client.evaluate("document.querySelector('[data-testid=extension-request-form]').textContent"), /Choose a return time to check live availability and price/);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="extension-extra-days"]').value`), "2", "the request form keeps the duration from Gaffer's live quote");
    assert.deepEqual(await client.evaluate(`Array.from(document.querySelectorAll('fieldset input[type="checkbox"]')).map(input=>input.checked)`), [true, false], "the form preselects only Gaffer's available line while leaving the unavailable line out");
    assert.equal(await client.evaluate("window.quoteCalls.length"), 0, "the form does not claim a live availability result before the renter chooses a return time");
    const extensionTargets = await client.evaluate(`(()=>{const height=selector=>document.querySelector(selector)?.getBoundingClientRect().height;return{days:height('[data-testid="extension-extra-days"]'),returnTime:height('[data-testid="extension-return-time"]'),submit:height('[data-testid="extension-send-request"]')}})()`);
    assert(extensionTargets.days >= 44 && extensionTargets.returnTime >= 44 && extensionTargets.submit >= 44, `The renter extension form has comfortable 44px date, time, and submit targets: ${JSON.stringify(extensionTargets)}`);
    await client.evaluate(`(()=>{const select=document.querySelector('[data-testid="extension-return-time"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'16:00');select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="extension-live-quote"]')`); attempt++) await wait(50);
    assert.equal(await client.evaluate("window.quoteCalls.at(-1)?.requestedReturnTime"), "16:00", "the live availability query includes the renter's selected return time");
    assert.deepEqual(await client.evaluate("window.quoteCalls.at(-1)?.indexes"), [0], "the first availability recheck uses the quoted available subset only");
    await client.evaluate(`document.querySelectorAll('fieldset input[type="checkbox"]')[1].click()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="extension-selection-conflicts"]')`); attempt++) await wait(50);
    assert.match(await client.evaluate("document.body.textContent"), /These items conflict on the new dates/);
    assert.match(await client.evaluate("document.body.textContent"), /Can extend alone · selection conflict/);
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="extension-unavailable-items"]')`), false, "an individually available line is not placed in the unavailable section");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="extension-send-request"]').disabled`), true, "a conflicted selection cannot submit an underquoted subset");
    assert.equal(await client.evaluate(`document.querySelectorAll('fieldset input[type="checkbox"]')[1].disabled`), false, "the individually available conflict line remains toggleable");
    assert(await client.evaluate(`document.querySelector('[data-testid="extension-quote-line-1"]').getBoundingClientRect().height >= 44`), "the select-this-item-only quote action is touch sized");
    const conflictLayout = await client.evaluate(`(()=>{const panel=document.querySelector('[data-testid="rental-extension-panel"]'),form=document.querySelector('[data-testid="extension-request-form"]'),r=panel.getBoundingClientRect(),f=form.getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,panelHeight:r.height,formHeight:f.height}})()`);
    assert.equal(conflictLayout.scrollWidth<=conflictLayout.width,true,`The 320px extension request stays within the screen: ${JSON.stringify(conflictLayout)}`);
    assert(conflictLayout.formHeight < 680, `The quote stays concise enough for a phone: ${JSON.stringify(conflictLayout)}`);
    fs.writeFileSync("/tmp/dbc-extension-selection-conflict.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.evaluate(`document.querySelector('[data-testid="extension-quote-line-1"]').click()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`document.querySelector('[data-testid="extension-send-request"]')&&!document.querySelector('[data-testid="extension-send-request"]').disabled`); attempt++) await wait(50);
    assert.equal(await client.evaluate(`document.querySelectorAll('fieldset input[type="checkbox"]')[0].checked`), false);
    assert.equal(await client.evaluate(`document.querySelectorAll('fieldset input[type="checkbox"]')[1].checked`), true);
    assert.match(await client.evaluate("document.body.textContent"), /£24\.68/);
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="extension-selection-conflicts"]')`), false, "the re-quote now prices the selected line by itself");
    assert.equal(await client.evaluate(`document.documentElement.scrollWidth<=innerWidth`), true, "the selected-line quote has no phone-width overflow");
    fs.writeFileSync("/tmp/dbc-extension-selection-quoted.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.evaluate(`document.querySelector('[data-testid="extension-send-request"]').click()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate("window.requests.length"); attempt++) await wait(50);
    const request = await client.evaluate("window.requests[0]");
    assert.deepEqual(request.lineItemIndexes, [1], "only the renter-selected, re-quoted line is submitted");
    assert.equal(request.expectedAmount, 24.68);
    assert.equal(await client.evaluate("window.fixture.state.items[0].end"), 1896134400000, "the other line retains its original deadline");
    assert.equal(await client.evaluate("window.fixture.state.items[1].end"), 1896134400000, "selection changes do not mutate booking deadlines");
    await client.evaluate(`(()=>{window.fixture.state={...window.fixture.state,requests:[{id:'pending-extension-credit',status:'pending',items:[{lineIndex:0,title:'Camera body',qty:1,end:1896134400000}],amount:26,requestedReturnTime:'17:00',benefitSaving:0,creditAppliedPence:500,cardDuePence:2100}],paymentsEnabled:true};window.renderFixture()})()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="extension-credit-summary"]')`); attempt++) await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="extension-credit-summary"]').textContent`), "£5.00 credit reserved · £21.00 if approved", "a pending request explains credit is reserved, not spent, and payment is conditional on approval");
    await client.evaluate(`(()=>{window.fixture.state={...window.fixture.state,requests:[{...window.fixture.state.requests[0],status:'applied'}]};window.renderFixture()})()`);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="extension-credit-summary"]').textContent`), "£5.00 credit used · £21.00 paid by card", "a settled request distinguishes spent credit and captured card payment");
    await client.evaluate(`(()=>{window.fixture.state={...window.fixture.state,requests:[{id:'zero-extension-request',status:'pending',items:[{lineIndex:0,title:'Camera body',qty:1,end:1896134400000}],amount:0,requestedReturnTime:'17:00',benefitSaving:0}],paymentsEnabled:false};window.renderAdminFixture()})()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="extension-review"]')`); attempt++) await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="extension-review"]').click()`);
    await client.evaluate(`(()=>{const select=document.querySelector('[data-testid="extension-approved-time"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'17:00');select.dispatchEvent(new Event('change',{bubbles:true}));const reason=document.querySelector('[data-testid="extension-decision-reason"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(reason,'Approved at zero balance');reason.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="extension-approve"]').disabled`), false, "a zero-balance extension remains manually approvable when rental payment links are disabled");
    assert.match(await client.evaluate(`document.querySelector('[data-testid="extension-approve"]').textContent`), /Approve & confirm extension/);
    assert.equal(await client.evaluate(`document.body.textContent.includes('Live rental payments have not been enabled yet.')`), false, "zero-balance approval does not show an irrelevant Stripe/payment warning");
    await client.evaluate(`document.querySelector('[data-testid="extension-approve"]').click()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`window.actionCalls.length`); attempt++) await wait(50);
    assert.deepEqual(await client.evaluate(`window.actionCalls[0]`), { ref: "approve", args: { token: "admin-token", requestId: "zero-extension-request", reason: "Approved at zero balance", approvedReturnTime: "17:00" } }, "the enabled zero-balance control calls the existing authenticated admin approval action");
    await client.evaluate(`(()=>{window.actionCalls=[];window.fixture.state={...window.fixture.state,requests:[{id:'paid-extension-request',status:'pending',items:[{lineIndex:0,title:'Camera body',qty:1,end:1896134400000}],amount:12.34,requestedReturnTime:'17:00',benefitSaving:0}],paymentsEnabled:false};window.renderAdminFixture()})()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="extension-review"]')`); attempt++) await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="extension-review"]').click()`);
    await client.evaluate(`(()=>{const select=document.querySelector('[data-testid="extension-approved-time"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'17:00');select.dispatchEvent(new Event('change',{bubbles:true}));const reason=document.querySelector('[data-testid="extension-decision-reason"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(reason,'Approved paid extension');reason.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="extension-approve"]').disabled`), true, "a positive-balance extension remains gated while payment configuration is unavailable");
    assert.match(await client.evaluate(`document.querySelector('[data-testid="extension-approve"]').textContent`), /Approve & send payment link/);
    assert.match(await client.evaluate(`document.body.textContent`), /Payments are unavailable for this extension/);
    assert.equal(await client.evaluate(`window.actionCalls.length`), 0, "the payment-disabled positive quote cannot call the approval action");
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
