const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");
const source = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = path.resolve(__dirname, "..");
  const fixturePhotos = {
    "/fixture-camera.webp": path.join(root, "public/images/home/ready-to-shoot-kit-20261028.webp"),
    "/fixture-lens.webp": path.join(root, "public/images/home/maintained-cinema-gear-20261028.webp"),
  };
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{RentalDeliveryQuoteApproval}from'./src/components/rentals/RentalDeliveryQuoteApproval';createRoot(document.getElementById('root')).render(<RentalDeliveryQuoteApproval token="fixture-renter" quoteId="fixture-quote"/>);`;
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    plugins: [{ name: "delivery-quote-fixture", setup(build) {
      build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|@\/lib\/pricing|@\/lib\/chatLinks|@\/lib\/renterFacingError|@\/components\/SmartImage)$/ }, args => args.path === "@/components/SmartImage" ? ({ path: path.join(root, "src/components/SmartImage.tsx") }) : ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents:
        args.path === "convex/react" ? `export const useQuery=()=>window.quote;export const useAction=ref=>async args=>{window.actions.push({ref:String(ref),args});return String(ref).endsWith('.accept')?{paid:true}:{ok:true}};` :
        args.path === "@cvx/_generated/api" ? `const path=a=>new Proxy({}, {get:(_,b)=>a+'.'+String(b)});export const api=new Proxy({}, {get:(_,a)=>path(String(a))});` :
        args.path === "@/lib/pricing" ? `export const formatGbp=value=>'£'+value.toFixed(2);` :
        args.path === "@/lib/chatLinks" ? `export const approvedStripeCheckoutUrl=value=>typeof value==='string'&&value.startsWith('https://checkout.stripe.com/')?value:null;` :
        `export const renterFacingError=(_,fallback)=>fallback;`
      }));
    }}],
  });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    if (fixturePhotos[request.url]) { response.setHeader("content-type", "image/webp"); return response.end(fs.readFileSync(fixturePhotos[request.url])); }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="margin:0;padding:8px;background:#141616;color:#eee;font:14px Arial"><div id="root"></div><script>window.actions=[];const params=new URLSearchParams(location.search),checkout=params.has('checkout'),expireSoon=params.has('expire'),deliveryLegs=params.has('roundtrip')?'round_trip':'one_way';window.quote={id:'fixture-quote',status:checkout?'checkout_open':'awaiting_acceptance',expiresAt:Date.now()+60000,checkoutExpiresAt:checkout?Date.now()+(expireSoon?250:60000):undefined,deliveryLegs,amountPence:2500,deliveryAddress:'Trafalgar Square, London',discountPence:500,isStudioBenefit:false,termsText:deliveryLegs==='one_way'?'Return outside Waterstones bookstore in Trafalgar Square.':'Courier collection at the agreed return time.',items:[{title:'Sony FX3 camera',qty:1,imageSources:['/fixture-camera.webp']},{title:'Sony 24–70mm lens',qty:2,imageSources:['/fixture-lens.webp']}],paymentUrl:checkout?'https://checkout.stripe.com/c/pay/cs_test_quote':undefined}</script><script src="/bundle.js"></script>`);
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-delivery-quote-card-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let client;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    let port;
    for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "Headless Chrome exposes its local inspection port");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect();
    await client.cmd("Page.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate("!!document.querySelector('[data-testid=\\\"rental-delivery-quote-card\\\"]')"); attempt++) await wait(50);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="delivery-quote-listings"] img')).length===2&&Array.from(document.querySelectorAll('[data-testid="delivery-quote-listings"] img')).every(image=>image.complete&&image.naturalWidth>100&&image.naturalHeight>50)`); attempt++) await wait(50);
    const mobile = await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="rental-delivery-quote-card"]'),measure=selector=>card?.querySelector(selector)?.getBoundingClientRect().height;return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,card:card?.getBoundingClientRect().toJSON(),stage:card?.querySelector('[data-testid="delivery-quote-stage"]')?.textContent,termsHeight:measure('[data-testid="delivery-quote-terms"]'),acceptHeight:measure('[data-testid="delivery-quote-accept"]'),declineHeight:measure('[data-testid="delivery-quote-decline"]'),copy:card?.innerText}})()`);
    assert.equal(mobile.stage, "Your action");
    assert(mobile.documentWidth <= 320 && mobile.card?.right <= 320, `The quote card fits a 320px phone without horizontal overflow: ${JSON.stringify(mobile)}`);
    assert(mobile.termsHeight >= 44 && mobile.acceptHeight >= 44 && mobile.declineHeight >= 44, `Terms and decisions meet the touch target: ${JSON.stringify(mobile)}`);
    assert(mobile.copy.includes("Collection stays in place until delivery is accepted and paid.") && mobile.copy.includes("Trafalgar Square"));
    const listingPhotos = await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="rental-delivery-quote-card"]'),rail=card?.querySelector('[data-testid="delivery-quote-listings"]'),images=[...(rail?.querySelectorAll('img')??[])];return{count:images.length,titles:[...(rail?.querySelectorAll('article')??[])].map(item=>item.innerText),sources:images.map(image=>image.getAttribute('src')),dimensions:images.map(image=>[image.naturalWidth,image.naturalHeight]),loaded:images.map(image=>image.complete&&image.naturalWidth>100&&image.naturalHeight>50),outside:[...document.querySelectorAll('img')].filter(image=>!card?.contains(image)).length,copy:card?.innerText}})()`);
    assert.equal(listingPhotos.count, 2, `The delivery quote card shows the actual booked listings: ${JSON.stringify(listingPhotos)}`);
    assert.deepEqual(listingPhotos.titles, ["1× Sony FX3 camera", "2× Sony 24–70mm lens"]);
    assert.deepEqual(listingPhotos.sources, ["/fixture-camera.webp", "/fixture-lens.webp"]);
    assert(listingPhotos.loaded.every(Boolean), `Photographic WebP fixtures decode at full image dimensions inside the chat card: ${JSON.stringify(listingPhotos)}`);
    assert.match(listingPhotos.copy, /£25\.00/);
    assert.match(listingPhotos.copy, /Member saving: £5\.00/);
    assert.equal(listingPhotos.outside, 0, "listing photos stay inside the chat card and are not attached to its header");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="delivery-quote-accept"]').disabled`), true, "Delivery requires terms acceptance");
    const termsLink = await client.evaluate(`(()=>{const link=document.querySelector('[data-testid="delivery-terms-link"]');return {href:link?.getAttribute('href'),target:link?.target,rel:link?.rel,visible:link?.getBoundingClientRect().height>0}})()`);
    assert.deepEqual(termsLink, {href:"/legal/delivery-disclaimer?version=2026-10-delivery-v2",target:"_blank",rel:"noopener noreferrer",visible:true}, "The highlighted link opens the versioned delivery terms without leaving the quote");
    await client.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="rental-delivery-quote-card"] svg[viewBox="0 0 100 100"]')).animationName`),'none','decorative aperture respects reduced motion');
    await client.cmd('Emulation.setEmulatedMedia',{features:[]});
    fs.writeFileSync("/tmp/dbc-delivery-quote-card-320.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobile390 = await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="rental-delivery-quote-card"]'),rail=card?.querySelector('[data-testid="delivery-quote-listings"]'),images=[...(rail?.querySelectorAll('img')??[])];return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,card:card?.getBoundingClientRect().toJSON(),photos:images.map(image=>({src:image.getAttribute('src'),loaded:image.complete&&image.naturalWidth>100&&image.naturalHeight>50})),copy:card?.innerText}})()`);
    assert(mobile390.documentWidth <= 390 && mobile390.card?.right <= 390, `The delivery card fits at 390px: ${JSON.stringify(mobile390)}`);
    assert.equal(mobile390.photos.length, 2);
    assert(mobile390.photos.every(photo => photo.loaded));
    assert.match(mobile390.copy, /£25\.00/);
    assert.match(mobile390.copy, /Member saving: £5\.00/);
    fs.writeFileSync("/tmp/dbc-delivery-quote-card-390.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?roundtrip=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate("!!document.querySelector('[data-testid=\\\"rental-delivery-quote-card\\\"]')"); attempt++) await wait(50);
    const roundTripCopy = await client.evaluate(`(()=>({copy:document.querySelector('[data-testid="rental-delivery-quote-card"]')?.innerText,returnPoint:!!document.querySelector('[data-testid="delivery-quote-return-point"]')}))()`);
    assert.match(roundTripCopy.copy, /Delivery and collection/);
    assert.equal(roundTripCopy.returnPoint, false, "a courier return leg does not show the in-person Waterstones return point");
    assert.doesNotMatch(roundTripCopy.copy, /Waterstones|Return point:/, "round-trip copy is specific to courier collection");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate("!!document.querySelector('[data-testid=\\\"rental-delivery-quote-card\\\"]')"); attempt++) await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="delivery-quote-terms"] input').click()`);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="delivery-quote-accept"]').disabled`), false);
    await client.evaluate(`document.querySelector('[data-testid="delivery-quote-terms"] input').focus()`);
    await client.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await client.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    assert(await client.evaluate(`(()=>{const button=document.querySelector('[data-testid="delivery-quote-accept"]');return document.activeElement===button&&button.matches(':focus-visible')&&getComputedStyle(button).outlineStyle!=='none'})()`),'keyboard users can see focus on acceptance');
    await client.evaluate(`document.querySelector('[data-testid="delivery-quote-accept"]').click()`);
    await wait(50);
    assert.deepEqual(await client.evaluate("window.actions[0]"), { ref: "rentalDelivery.accept", args: { token: "fixture-renter", id: "fixture-quote", accepted: true, useAccountCredit: false } });
    assert.match(await client.evaluate("document.body.innerText"), /delivery is confirmed/i);

    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?checkout=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate("!!document.querySelector('[data-testid=\\\"delivery-quote-payment-link\\\"]')"); attempt++) await wait(50);
    const desktop = await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="rental-delivery-quote-card"]'),link=card?.querySelector('[data-testid="delivery-quote-payment-link"]');return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,stage:card?.querySelector('[data-testid="delivery-quote-stage"]')?.textContent,linkHeight:link?.getBoundingClientRect().height,href:link?.href,target:link?.target,rel:link?.rel}})()`);
    assert.equal(desktop.stage, "Payment due");
    assert(desktop.documentWidth <= 1280 && desktop.linkHeight >= 44 && desktop.href === "https://checkout.stripe.com/c/pay/cs_test_quote" && desktop.target === "_blank" && desktop.rel === "noopener noreferrer", `Secure payment remains clear, safe, and touch sized: ${JSON.stringify(desktop)}`);
    fs.writeFileSync("/tmp/dbc-delivery-quote-card-desktop.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?checkout=1&expire=1` });
    await wait(500);
    const expiredCheckout = await client.evaluate(`(()=>({stage:document.querySelector('[data-testid="delivery-quote-stage"]')?.textContent,paymentLink:!!document.querySelector('[data-testid="delivery-quote-payment-link"]'),copy:document.body.innerText}))()`);
    assert.equal(expiredCheckout.stage, "Quote expired", `The card updates at Stripe's checkout deadline: ${JSON.stringify(expiredCheckout)}`);
    assert.equal(expiredCheckout.paymentLink, false, "an expired Stripe link is no longer actionable even if quote reconciliation has not run yet");
    console.log("PASS renter delivery quote card: 320px fit, short stage status, 44px controls, required terms acceptance, successful action, verified Stripe button, desktop fit and checkout-link expiry; synthetic quote only.");
  } finally {
    if (client) client.close();
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    server.close();
    await wait(100);
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
