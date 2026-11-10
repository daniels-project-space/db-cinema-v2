const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), os = require("node:os"), path = require("node:path"), { spawn } = require("node:child_process");
const esbuild = require("esbuild"), postcss = require("postcss");
const source = fs.readFileSync("scripts/test-membership-browser.cjs", "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + "\nreturn connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const bundle = await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {RentalVerificationSummary} from './src/components/rentals/RentalVerificationSummary';const admin=!new URLSearchParams(location.search).has('renter');createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:440}}><RentalVerificationSummary token="admin-fixture" bookingId="synthetic-rental" admin={admin}/></main>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, plugins: [{ name: "verification-fixture", setup(build) {
    build.onResolve({ filter: /^next\/link$|^convex\/react$|_generated\/api$|^\.\/VerificationProgress$|^\.\/useVerificationRefresh$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "convex/react" ? `export const useQuery=()=>({status:'pending_verification',idVerifyStatus:'manual_review',verificationProvider:'didit',verificationNote:'A required check needs review.',diditSessionId:'synthetic-session-123',verificationChecks:{identity:'approved',selfie:'approved',address:'review'}});export const useAction=action=>async args=>{if(action==='refresh'){window.refreshCalls.push(args);return {status:'unchanged',providerStatus:'In Review'}}if(action==='link'){window.linkCalls.push(args);return {url:'https://verify.didit.me/session/synthetic-session-123',issues:[{feature:'POA',risk:'ADDRESS_MISMATCH',summary:'The address differs from proof of address.',detail:'Didit found a mismatch.'}]}}window.reviewCalls.push(args);return {status:'verified',providerStatus:'Approved'}};` : args.path.endsWith("api") ? `export const api={rentalOperations:{details:'details'},bookings:{verificationProgress:'progress'},didit:{refreshProgress:'refresh',adminReview:'review',adminVerificationLink:'link'}};` : args.path === "next/link" ? `import React from 'react';export default function Link({href,children,...rest}){return <a href={href} {...rest}>{children}</a>}` : args.path.includes("useVerificationRefresh") ? `export const useVerificationRefresh=()=>null;` : `import React from 'react';export const VerificationBar=()=> <div>Verification progress</div>;` }));
  } }] });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    response.setHeader("content-type", "text/html"); response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:#111;color:white"><div id="root"></div><script>window.refreshCalls=[];window.reviewCalls=[];window.linkCalls=[];window.copyCalls=[];window.openedUrls=[];window.openCalls=[];window.open=(url,target)=>{window.openCalls.push({url,target});return{opener:{},location:{replace:next=>window.openedUrls.push(next)},close:()=>window.popupClosed=true}};Object.defineProperty(navigator,"clipboard",{value:{writeText:async value=>window.copyCalls.push(value)}})</script><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-verification-review-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temporary}`], { stdio: "ignore" });
  let client;
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${temporary}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; client = await connect(); await client.cmd("Page.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Rental verification progress\\"]")'); attempt++) await wait(100);
    assert.match(await client.evaluate('document.body.textContent'), /Action needed/);
    assert.match(await client.evaluate('document.body.textContent'), /synthetic-session-123/);
    assert.match(await client.evaluate('document.body.textContent'), /Decision reason/);
    assert.ok(await client.evaluate(`!!document.querySelector('[aria-label="Open Didit verification"]')`), "admins can open the provider case");
    await client.evaluate(`document.querySelector('[aria-label="Open Didit verification"]').click()`); await wait(80);
    assert.deepEqual(await client.evaluate("window.linkCalls"), [{bookingId:"synthetic-rental",token:"admin-fixture"}], "the secure action looks up the session bound to this booking");
    assert.deepEqual(await client.evaluate("window.openedUrls"), ["https://verify.didit.me/session/synthetic-session-123"], "the UI opens the exact provider-returned verification URL");
    assert.deepEqual(await client.evaluate("window.openCalls"), [{url:"about:blank",target:"_blank"}]);
    assert.match(await client.evaluate("document.body.textContent"), /Didit returned 1 finding/);
    assert.match(await client.evaluate("document.body.textContent"), /Didit findings/);
    assert.match(await client.evaluate("document.body.textContent"), /The address differs from proof of address/);
    assert.match(await client.evaluate("document.body.textContent"), /Didit found a mismatch/);
    await client.evaluate(`document.querySelector('[aria-label="Copy Didit case ID"]').click()`); await wait(30);
    assert.deepEqual(await client.evaluate('window.copyCalls'), ["synthetic-session-123"], "Copy ID saves the exact Didit session ID for its User verifications search");
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Copy Didit case ID"]').textContent`), "Copied");
    assert.equal(await client.evaluate(`[...document.querySelectorAll("button")].some(button => button.getAttribute('aria-label')==='Approve Didit review')`), true, "admin can approve a Didit manual review");
    assert.equal(await client.evaluate(`[...document.querySelectorAll("button")].some(button => button.getAttribute('aria-label')==='Request Didit resubmission')`), true, "admin can request a Didit resubmission");
    assert.equal(await client.evaluate(`[...document.querySelectorAll("button")].some(button => button.getAttribute('aria-label')==='Decline Didit review')`), true, "admin can decline a Didit manual review");
    assert.equal(await client.evaluate('document.documentElement.scrollWidth > innerWidth'), false);
    assert.equal(await client.evaluate(`(()=>{const labels=[...document.querySelectorAll('[aria-label="Document checks"] span:first-child')].map(node=>node.textContent);return labels.includes('Selfie & face match')&&labels.includes('Proof of address')})()`), true, 'Long check labels remain fully visible');
    assert.equal(await client.evaluate(`(()=>[...document.querySelectorAll('[aria-label="Document checks"] > div')].every(node=>node.scrollWidth<=node.clientWidth))()`), true, 'Check chips do not clip at 320px');
    const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-verification-review-320.png", Buffer.from(screenshot.data, "base64"));
    await client.evaluate(`document.querySelector('[aria-label="Refresh Didit decision"]').click()`); await wait(80);
    assert.deepEqual(await client.evaluate('window.refreshCalls'), [{ bookingId: "synthetic-rental", accountToken: "admin-fixture", admin: true }]);
    assert.match(await client.evaluate('document.body.textContent'), /No change yet/);
    await client.evaluate(`document.querySelector('textarea').focus()`);
    await client.cmd("Input.insertText", { text: "Evidence checked by the team" });
    await client.evaluate(`document.querySelector('[aria-label="Approve Didit review"]').click()`); await wait(100);
    assert.equal(await client.evaluate('window.reviewCalls.length'),1,"approve control calls the admin action");
    assert.equal(await client.evaluate('window.reviewCalls[0].decision'),"approve");
    assert.equal(await client.evaluate('window.reviewCalls[0].note'),"Evidence checked by the team");
    assert.match(await client.evaluate('document.body.textContent'),/Approved · rental updated/);
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Rental verification progress\\"]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\\"Didit review\\"]")'),false,"renters do not see the manual-review decision panel");
    assert.equal(await client.evaluate(`[...document.querySelectorAll("button")].some(button => /^Approve|^Decline|^Request Didit resubmission/.test(button.getAttribute('aria-label')||''))`),false,"renters do not receive Didit decision controls");
    console.log("PASS verification review visual, refresh, admin decisions, and renter visibility at 320px; synthetic data only.");
  } finally { if (client) client.close(); if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; } server.close(); await wait(200); await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
