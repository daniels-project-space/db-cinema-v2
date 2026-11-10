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

const photos = {
  camera: "https://hygglo.imgix.net/products/73d7d0_sony-fx-3-4k-mirrorless-full-frame-cinema-camera-audio-handle-24-70mm-f28-g-master-zoom-lens-set-gmaster-g-master-sony-fx3-fx3-a7siii-a7s-iii-a7-siii-alpha-camera-cannon-nikon-fuji.jpg?cs=strip&fm=pjpg&q=70",
  lens: "https://hygglo.imgix.net/fat-llama/products/gmaster-lens-sony-2470mm-f28-21919134.jpeg?cs=strip&fm=pjpg&q=70",
  alternative: "https://hygglo.imgix.net/products/73d7d0_sony-fx-3-4k-mirrorless-full-frame-cinema-camera-audio-handle-24-70mm-f28-g-master-zoom-lens-set-gmaster-g-master-sony-fx3-fx3-a7siii-a7s-iii-a7-siii-alpha-camera-cannon-nikon-fuji.jpg?cs=strip&fm=pjpg&q=70",
};

(async () => {
  const root = path.resolve(__dirname, "..");
const entry = `import React,{useState}from'react';
import{createRoot}from'react-dom/client';
import{GafferExtensionOfferCard}from'./src/components/rentals/GafferExtensionOfferCard';
const root=createRoot(document.getElementById('root'));
function Fixture(){const[offer,setOffer]=useState(window.fixture.offer);window.renderOffer=setOffer;return <GafferExtensionOfferCard offer={offer} bookingItems={window.fixture.bookingItems} legacy={!offer.quoteStatus&&!offer.availableIndexes&&!offer.unavailableItems} />}
root.render(<Fixture/>);`;
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    outdir: path.join(root, ".tmp-gaffer-extension-offer-test"),
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "local-css" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "offer-image-fixture", setup(build) {
      build.onResolve({ filter: /^@\/components\/SmartImage$/ }, () => ({ path: "SmartImage", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "jsx", resolveDir: root, contents: `import React from 'react';export function SmartImage({src,alt,className}){return <img src={src} alt={alt} className={className}/>} ` }));
    } }],
  });
  const offer = {
    version: 1,
    bookingId: "fixture-booking",
    quoteStatus: "partial",
    extraDays: 2,
    total: 24.68,
    benefit: { label: "Encore member saving", saving: 2.74 },
    availableIndexes: [0],
    items: [{ index: 0, listingId: "camera-listing", slug: "sony-fx3", title: "Sony FX3 camera", qty: 1, originalEnd: Date.UTC(2030, 0, 4), originalReturnTime: "17:00", proposedEnd: Date.UTC(2030, 0, 6), days: 2, dailyRate: 13.71, lineTotal: 24.68, imageSources: [photos.camera], availability: "available" }],
    unavailableItems: [{ index: 1, title: "Sony 24–70mm lens", qty: 1, originalEnd: Date.UTC(2030, 0, 4), originalReturnTime: "17:00", reason: "Already booked for the extra dates", alternatives: [{ listingId: "fx6-listing", slug: "sony-fx6", title: "Sony FX6 camera", qty: 1, imageSources: [photos.alternative], days: 2, dailyRate: 40, total: 80, availability: "available", informationalOnly: true }] }],
    approvalRequired: true,
    paymentLinkAfterApprovalOnly: true,
    datesChanged: false,
  };
  const globalCss = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const css = `${globalCss.css}\n${bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}`;
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  assert(script, "the real Gaffer offer card bundles");
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(script); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css); }
    response.setHeader("content-type", "text/html");
    response.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="margin:0;background:#101112;color:#eee;font:14px system-ui"><main style="max-width:760px;margin:24px auto;padding:12px"><div id="root"></div></main><script>window.fixture={offer:${JSON.stringify(offer)},bookingItems:[{index:0,title:'Sony FX3 camera',imageSources:[${JSON.stringify(photos.camera)}]},{index:1,title:'Sony 24–70mm lens',imageSources:[${JSON.stringify(photos.lens)}]}]};window.requests=0;window.prefill='';window.addEventListener('dbc:open-rental-extension',()=>window.requests++);window.addEventListener('dbc:prefill-rental-message',event=>window.prefill=event.detail?.text??'');window.addEventListener('error',event=>(window.errors??=[]).push(event.message))</script><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-gaffer-extension-offer-"));
  const attachedBrowser = !!process.env.DBC_CDP_URL;
  const chrome = attachedBrowser ? null : spawn(process.env.CHROME_BIN || "/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${process.env.CHROME_DEBUG_PORT || "0"}`, `--user-data-dir=${profile}`], { stdio: "ignore" });
  let client;
  try {
    let port = process.env.CHROME_DEBUG_PORT || (attachedBrowser ? new URL(process.env.DBC_CDP_URL).port : undefined);
    for (let attempt = 0; !port && attempt < 100; attempt++) { try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port);
    if (!attachedBrowser) process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect();
    await client.cmd("Page.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="gaffer-extension-card"]')`); attempt++) await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="gaffer-extension-card"]')?.textContent.includes('£24.68')`), true, "the extension estimate shows the server-priced total");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="gaffer-extension-card"]')?.textContent.includes('Encore member saving')&&document.querySelector('[data-testid="gaffer-extension-card"]')?.textContent.includes('£2.74')`), true, "the server-computed member benefit is visible");
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="extension-offer-available-items"] [data-offer-status="available"]').length`), 1, "only the available listing is presented as extendable");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="extension-offer-unavailable-items"]')?.textContent.includes('Return as planned · 4 Jan 2030 · 17:00')`), true, "the unavailable item keeps its original return deadline explicit");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="extension-offer-unavailable-items"]')?.textContent.includes('Sony FX6 camera')`), true, "a checked alternative is presented as a suggestion");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="extension-offer-unavailable-items"]')?.textContent.includes('Available when checked · not reserved')`), true, "an alternative is clearly marked as a timed suggestion rather than a reservation");
    assert.deepEqual(await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="gaffer-extension-card"] img')).map(image=>image.getAttribute('src'))`), [photos.camera, photos.lens, photos.alternative], "available, unavailable, and alternative cards use the exact listing images");
    for (let attempt = 0; attempt < 80 && !await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="gaffer-extension-card"] img')).every(image=>image.complete&&image.naturalWidth>0)`); attempt++) await wait(100);
    assert.equal(await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="gaffer-extension-card"] img')).every(image=>image.complete&&image.naturalWidth>0)`), true, "all real listing photos load in the offer card");
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="gaffer-extension-card"] a[href*="stripe"], [data-testid="gaffer-extension-card"] a[href*="checkout"]').length`), 0, "the informational offer has no payment link");
    assert.equal(await client.evaluate(`window.requests`), 0, "rendering a Gaffer offer does not submit a rental request");
    await client.evaluate(`document.querySelector('[data-testid="extension-offer-ask-alt-0"]').click()`);
    const prefetched = await client.evaluate(`window.prefill`);
    assert.match(prefetched, /Sony FX6 camera/);assert.match(prefetched, /Sony 24–70mm lens/);assert.match(prefetched, /not reserved/i);assert.match(prefetched, /original return deadline/i);
    assert.equal(await client.evaluate(`window.requests`), 0, "asking about an alternative only prefills the chat; it does not submit a change");
    fs.writeFileSync("/tmp/dbc-gaffer-extension-offer-desktop.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 844, deviceScaleFactor: 1, mobile: true }); await wait(100);
    assert.equal(await client.evaluate(`document.documentElement.scrollWidth<=innerWidth`), true, "the renter extension card does not overflow a phone viewport");
    const narrowTitle = await client.evaluate(`(()=>{const title=document.querySelector('[data-testid="extension-offer-available-items"] strong');return title?{text:title.textContent.trim(),textOverflow:getComputedStyle(title).textOverflow,overflow:getComputedStyle(title).overflow,whiteSpace:getComputedStyle(title).whiteSpace,rect:{left:title.getBoundingClientRect().left,right:title.getBoundingClientRect().right,width:title.getBoundingClientRect().width,height:title.getBoundingClientRect().height}}:null})()`);
    assert(narrowTitle?.text.includes("Sony FX3 camera"), `The narrow renter card keeps the whole listing name available: ${JSON.stringify(narrowTitle)}`);
    assert.notEqual(narrowTitle?.textOverflow, "ellipsis", `The 320px listing name wraps instead of disappearing behind an ellipsis: ${JSON.stringify(narrowTitle)}`);
    assert(narrowTitle.rect.left >= 0 && narrowTitle.rect.right <= 320, `The complete listing title stays within the narrow phone card: ${JSON.stringify(narrowTitle)}`);
    fs.writeFileSync("/tmp/dbc-gaffer-extension-offer-320.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await wait(100);
    fs.writeFileSync("/tmp/dbc-gaffer-extension-offer-mobile.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.evaluate(`document.querySelector('[data-testid="gaffer-extension-open"]').click()`);
    assert.equal(await client.evaluate(`window.requests`), 1, "the card only opens the existing regular request form; it does not submit one");
    await client.evaluate(`window.renderOffer({version:1,bookingId:'fixture-booking',quoteStatus:'duration_required',availableIndexes:[],items:[{index:0,title:'Sony FX3 camera',qty:1,originalEnd:${Date.UTC(2030,0,4)},originalReturnTime:'17:00',imageSources:[${JSON.stringify(photos.camera)}],availability:'unchecked'}],unavailableItems:[],approvalRequired:true,paymentLinkAfterApprovalOnly:true,datesChanged:false})`);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="extension-offer-unchecked-items"]')?.textContent.includes('Choose days')&&document.querySelector('[data-testid="extension-offer-unchecked-items"]')?.textContent.includes('Original return · 4 Jan 2030 · 17:00')`), true, "duration-required offers show original dates without claiming a quote or availability");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="gaffer-extension-card"]')?.textContent.includes('Proposed total')`), false, "duration-required offers do not show a price");
    console.log("PASS Gaffer extension offer browser: real item and alternative photos, quoted available subset, original deadline for unavailable item, duration-required state, and request-form-only action. Synthetic data only.");
  } finally {
    if (client) { client.close(); try { await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`); } catch {} }
    if (chrome && chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    server.close(); await wait(100); await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
