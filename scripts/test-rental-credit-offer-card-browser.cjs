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
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{RentalCreditOffer}from'./src/components/rentals/RentalCreditOffer';createRoot(document.getElementById('root')).render(<RentalCreditOffer token="fixture-renter" offerId="fixture-offer"/>);`;
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    plugins: [{ name: "credit-offer-fixture", setup(build) {
      build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|@\/lib\/pricing|\.\.\/\.\.\/shared\/rentalSecurity)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents:
        args.path === "convex/react" ? `export const useQuery=()=>window.offer;` :
        args.path === "@cvx/_generated/api" ? `const path=a=>new Proxy({}, {get:(_,b)=>a+'.'+String(b)});export const api=new Proxy({}, {get:(_,a)=>path(String(a))});` :
        args.path === "@/lib/pricing" ? `export const formatGbp=value=>'£'+value.toFixed(2);` :
        `export const isSetupIntentSecurityPolicy=version=>['2026-11-setup-intent-v1','2026-11-immediate-claim-v2','2026-11-immediate-claim-v3'].includes(version);`
      }));
    }}],
  });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="margin:0;padding:8px;background:#141616;color:#eee;font:14px Arial"><div id="root"></div><script>window.events=[];window.addEventListener('dbc:open-rental-cancellation',event=>window.events.push(event.detail));window.offer={status:'open',eligible:true,enabled:true,bookingId:'fixture-booking',amountPence:2500,securityPolicyVersion:new URLSearchParams(location.search).get('policy')||'2026-11-setup-intent-v1'}</script><script src="/bundle.js"></script>`);
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-credit-offer-card-"));
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
    for (let attempt = 0; attempt < 100 && !await client.evaluate("!!document.querySelector('[data-testid=\\\"rental-credit-offer\\\"]')"); attempt++) await wait(50);
    const mobile = await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="rental-credit-offer"]'),button=card?.querySelector('[data-testid="rental-credit-offer-request-review"]');return{viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,card:card?.getBoundingClientRect().toJSON(),buttonHeight:button?.getBoundingClientRect().height,copy:card?.innerText,disabled:button?.disabled}})()`);
    assert(mobile.documentWidth <= 320 && mobile.card?.right <= 320, `The account-credit choice fits a 320px phone: ${JSON.stringify(mobile)}`);
    assert(mobile.buttonHeight >= 44, `The review action is touch sized: ${JSON.stringify(mobile)}`);
    assert(/proposed cancellation credit/i.test(mobile.copy) && mobile.copy.includes("£25.00") && mobile.copy.includes("Saved-card terms still apply") && mobile.copy.includes("does not cancel your rental or issue credit"), mobile.copy);
    assert.equal(mobile.disabled, false, "A review request must be available without implying acceptance");
    await client.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="rental-credit-offer"] svg[viewBox="0 0 100 100"]')).animationName`),'none','decorative aperture respects reduced motion');
    await client.cmd('Emulation.setEmulatedMedia',{features:[]});
    fs.writeFileSync("/tmp/dbc-rental-credit-offer-320.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await wait(50);
    assert(await client.evaluate('document.documentElement.scrollWidth<=innerWidth'),'desktop card fits the viewport');
    fs.writeFileSync('/tmp/dbc-rental-credit-offer-desktop.png',Buffer.from((await client.cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await client.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await client.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    assert(await client.evaluate(`(()=>{const button=document.querySelector('[data-testid="rental-credit-offer-request-review"]');return document.activeElement===button&&button.matches(':focus-visible')&&getComputedStyle(button).outlineStyle!=='none'})()`),'review action has visible keyboard focus');
    await client.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await client.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
    await wait(50);
    assert.deepEqual(await client.evaluate("window.events[0]"), { bookingId: "fixture-booking", offerId: "fixture-offer", proposedCreditPence: 2500 });

    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?policy=2026-10-saved-card-v1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate("!!document.querySelector('[data-testid=\\\"rental-credit-offer\\\"]')"); attempt++) await wait(50);
    const oldTerms = await client.evaluate(`document.querySelector('[data-testid="rental-credit-offer"]').innerText`);
    assert.match(oldTerms, /remaining security payment/);
    assert.match(oldTerms, /unused holds are released on approval/);
    console.log("PASS renter credit offer card: proposed-only wording, 44px team-review action, booking-bound cancellation handoff, and no direct acceptance call; synthetic offer only.");
  } finally {
    if (client) client.close();
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    server.close();
    await wait(100);
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
