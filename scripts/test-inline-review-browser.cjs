const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), os = require("node:os"), path = require("node:path"), { spawn } = require("node:child_process");
const esbuild = require("esbuild"), postcss = require("postcss");
const source = fs.readFileSync("scripts/test-membership-browser.cjs", "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + "\nreturn connect;")(require);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const bundle = await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BookingReview} from './src/components/account/BookingReview';createRoot(document.getElementById('root')).render(<main style={{padding:16}}><BookingReview inline token="fixture-renter" bookingId="fixture-rental"/></main>);`, resolveDir: process.cwd(), loader: "jsx" }, alias: { "@": path.join(process.cwd(), "src") }, bundle: true, write: false, plugins: [{ name: "fixture", setup(build) {
    build.onResolve({ filter: /^convex\/react$|_generated\/api$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", contents: args.path === "convex/react" ? `export const useQuery=()=>({eligible:true,reviewed:false,encoreEligible:false});export const useAction=()=>async()=>{};export const useMutation=()=>async args=>{window.calls.push(args)};` : `export const api={reviewInvitations:{eligibility:'eligibility'},reviewActions:{checkEligibility:'check'},reviews:{submitNative:'submit'}};` }));
  } }] });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    response.setHeader("content-type", "text/html"); response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:#111;color:white"><div id="root"></div><script>window.calls=[]</script><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-inline-review-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temporary}`], { stdio: "ignore" });
  let client;
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${temporary}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; client = await connect(); await client.cmd("Page.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=rental-review-form]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=review-eye-glyph]")'), true);
    assert.equal(await client.evaluate('document.querySelectorAll("[aria-label=\\"Rental rating\\"] button").length'), 5);
    assert.equal(await client.evaluate(`[...document.querySelectorAll('[aria-label="Rental rating"] button')].every(button=>{const rect=button.getBoundingClientRect();return rect.width>=44&&rect.height>=44})`), true, 'Every rating has a phone-friendly touch target');
    assert.equal(await client.evaluate(`[...document.querySelectorAll('[data-testid="rental-review-form"] button')].find(button=>button.textContent.includes('Publish review')).disabled`), true);
    const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-inline-review-320.png", Buffer.from(screenshot.data, "base64"));
    await client.evaluate(`document.querySelector('[aria-label="4 stars"]').click();const input=document.querySelector('[aria-label="Your rental review"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Great gear and helpful service.');input.dispatchEvent(new Event('input',{bubbles:true}));`); await wait(80);
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="4 stars"]').getAttribute('aria-pressed')`), "true");
    assert.equal(await client.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
    const filled = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-inline-review-filled-320.png", Buffer.from(filled.data, "base64"));
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Publish review')).click()`); await wait(80);
    assert.deepEqual(await client.evaluate("window.calls"), [{ token: "fixture-renter", bookingId: "fixture-rental", rating: 4, text: "Great gear and helpful service." }]);
    assert.match(await client.evaluate("document.body.textContent"), /Reviewed — thank you/);
    console.log("PASS inline review: eye, rating, text, selected rental and submitted state at 320px; synthetic data only.");
  } finally { if (client) client.close(); if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; } server.close(); await wait(200); await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
