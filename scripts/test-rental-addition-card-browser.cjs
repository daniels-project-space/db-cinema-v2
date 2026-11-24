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
const image = "https://hygglo.imgix.net/products/73d7d0_sony-fx-3-4k-mirrorless-full-frame-cinema-camera-audio-handle-24-70mm-f28-g-master-zoom-lens-set-gmaster-g-master-sony-fx3-fx3-a7siii-a7s-iii-a7-siii-alpha-camera-cannon-nikon-fuji.jpg?cs=strip&fm=pjpg&q=70";
const addition = { id: "fixture-addition", status: "awaiting_payment", title: "Sony FX3 camera", qty: 1, amount: 90, rentalCharge: 40, benefitSaving: 5, benefitLabel: "Encore · 10%", existingCheckoutBalance: 0, imageSources: [image], securityCharge: 50, requiresAcceptance: true, securityPolicyVersion: "legacy-deposit", savedCardLimit: 50, priorSavedCardLimit: 0, depositAmount: 50, priorDeposit: 0, holdTotal: 50, url: "https://checkout.stripe.com/c/pay/fixture", expiresAt: Date.now() + 3600000 };

(async () => {
  const root = path.resolve(__dirname, "..");
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{RentalAdditionApproval}from'./src/components/rentals/RentalAdditionApproval';createRoot(document.getElementById('root')).render(<RentalAdditionApproval token="fixture-renter" bookingId="fixture-booking"/>);`;
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [{ name: "addition-card-fixture", setup(build) {
    build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|@stripe\/stripe-js|@\/lib\/pricing|@\/lib\/rentalPresentation|@\/lib\/chatLinks|@\/lib\/renterFacingError|@\/components\/SmartImage|\.\.\.\/\.\.\/\.\.\/shared\/rentalSecurity|\.\.\.\/\.\.\/\.\.\/shared\/savedCardSecurity)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", resolveDir: root, contents: args.path === "convex/react"
      ? `export const useQuery=()=>window.addition;export const useAction=()=>async()=>({});`
      : args.path === "@cvx/_generated/api" ? `export const api={rentalAdditionState:{customerState:'customerState'},rentalAdditions:{acceptEquipmentSecurity:'acceptEquipmentSecurity',resumeByCustomer:'resumeByCustomer'}};`
      : args.path === "@stripe/stripe-js" ? `export const loadStripe=async()=>null;`
      : args.path === "@/lib/pricing" ? `export const formatGbp=value=>'£'+Number(value).toFixed(2);`
      : args.path === "@/lib/rentalPresentation" ? `export const rentalTitle=value=>value;`
      : args.path === "@/lib/chatLinks" ? `export const approvedStripeCheckoutUrl=value=>value?.startsWith('https://checkout.stripe.com/')?value:null;`
      : args.path === "@/lib/renterFacingError" ? `export const renterFacingError=(error,fallback)=>error?.message??fallback;`
      : args.path === "@/components/SmartImage" ? `import{createElement}from'react';export function SmartImage({src,alt,className}){return createElement('img',{src,alt,className})}`
      : args.path.endsWith("rentalSecurity") ? `export const ASSESSMENT_SECURITY_POLICY_VERSION='assessment-v1';export const isSetupIntentSecurityPolicy=()=>false;`
      : `export const securityAmendmentConsentText=()=> 'Fixture terms';` }));
  } }] });
  const css = await postcss([require("@tailwindcss/postcss")({ base: root })]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    response.setHeader("content-type", "text/html");
    const requiresAcceptance = !request.url.includes("after-consent");
    response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="background:#151515;color:#eee"><div id="root"></div><script>window.addition=${JSON.stringify({ ...addition, requiresAcceptance })};</script><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-addition-card-"));
  const chrome = spawn(process.env.CHROME_BIN || "/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let client;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port);
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect();
    await client.cmd("Page.enable");
    await client.cmd("Page.addScriptToEvaluateOnNewDocument", { source: "window.errors=[];window.addEventListener('error',event=>window.errors.push(event.message));" });
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="addition-charge-breakdown"]')`); attempt++) await wait(50);
    const renderedImages = await client.evaluate(`Array.from(document.querySelectorAll('img[alt$="listing photo"]')).map(node=>node.getAttribute('src'))`);
    assert.deepEqual(renderedImages, [image], `the addition card shows its actual listing photo; rendered ${JSON.stringify(await client.evaluate(`({body:document.body.textContent,fixture:window.addition,html:document.querySelector('#root')?.innerHTML,errors:window.errors,scripts:[...document.scripts].map(script=>({src:script.src,text:script.textContent.slice(0,80)})),resources:performance.getEntriesByType('resource').map(resource=>resource.name).filter(name=>name.includes('bundle'))})`))}`);
    assert.match(await client.evaluate("document.body.textContent"), /Added rental charge/);
    assert.match(await client.evaluate("document.body.textContent"), /£40\.00/);
    assert.match(await client.evaluate("document.body.textContent"), /Encore · 10% · £5\.00 already applied/);
    assert.match(await client.evaluate("document.body.textContent"), /Additional refundable security/);
    assert.match(await client.evaluate("document.body.textContent"), /£50\.00/);
    assert.match(await client.evaluate("document.querySelector('[data-testid=addition-total-due]').textContent"), /£90\.00/);
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="addition-payment-link"]')`), false, "payment stays locked until the required security terms are accepted");
    assert.match(await client.evaluate(`document.querySelector('[data-testid="addition-payment-locked"]').textContent`), /Accept the updated security terms/);
    assert.equal(await client.evaluate("document.documentElement.scrollWidth>innerWidth"), false, "the addition quote fits a 320px phone");
    fs.writeFileSync("/tmp/dbc-rental-addition-card-320.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.equal(await client.evaluate("document.documentElement.scrollWidth>innerWidth"), false, "the addition quote fits desktop");
    fs.writeFileSync("/tmp/dbc-rental-addition-card-desktop.png", Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/after-consent` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-testid="addition-payment-link"]')`); attempt++) await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="addition-payment-link"]').getAttribute('href')`), "https://checkout.stripe.com/c/pay/fixture");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="addition-payment-link"]').getBoundingClientRect().height>=44`), true, "the payment action is comfortably tappable on mobile");
    console.log("PASS rental addition card: real listing photo, itemized amount, payment blocked until required terms are accepted, 44px payment action, and mobile/desktop fit; synthetic renter quote only.");
  } finally {
    if (client) client.close();
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    server.close();
    await wait(100);
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
