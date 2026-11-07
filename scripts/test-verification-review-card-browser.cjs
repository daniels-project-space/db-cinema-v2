const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), os = require("node:os"), path = require("node:path"), { spawn } = require("node:child_process");
const esbuild = require("esbuild"), postcss = require("postcss");
const source = fs.readFileSync("scripts/test-membership-browser.cjs", "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + "\nreturn connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const bundle = await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {RentalVerificationSummary} from './src/components/rentals/RentalVerificationSummary';createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:440}}><RentalVerificationSummary token="admin-fixture" bookingId="synthetic-rental" admin/></main>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, plugins: [{ name: "verification-fixture", setup(build) {
    build.onResolve({ filter: /^next\/link$|^convex\/react$|_generated\/api$|^\.\/VerificationProgress$|^\.\/useVerificationRefresh$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "convex/react" ? `export const useQuery=()=>({status:'pending_verification',idVerifyStatus:'manual_review',verificationProvider:'didit',verificationNote:'A required check did not pass.',diditSessionId:'synthetic-session-123',verificationChecks:{identity:'approved',selfie:'approved',address:'review'}});export const useAction=()=>async args=>{window.refreshCalls.push(args);return {status:'unchanged'}};` : args.path.endsWith("api") ? `export const api={rentalOperations:{details:'details'},bookings:{verificationProgress:'progress'},didit:{refreshProgress:'refresh'}};` : args.path === "next/link" ? `import React from 'react';export default function Link({href,children,...rest}){return <a href={href} {...rest}>{children}</a>}` : args.path.includes("useVerificationRefresh") ? `export const useVerificationRefresh=()=>null;` : `import React from 'react';export const VerificationBar=()=> <div>Verification progress</div>;` }));
  } }] });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    response.setHeader("content-type", "text/html"); response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:#111;color:white"><div id="root"></div><script>window.refreshCalls=[]</script><script src="/bundle.js"></script>');
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
    assert.match(await client.evaluate('document.body.textContent'), /Verification needs review/);
    assert.match(await client.evaluate('document.body.textContent'), /synthetic-session-123/);
    assert.match(await client.evaluate('document.body.textContent'), /Do not approve until Didit confirms it/);
    assert.equal(await client.evaluate('document.documentElement.scrollWidth > innerWidth'), false);
    const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-verification-review-320.png", Buffer.from(screenshot.data, "base64"));
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Refresh Didit decision')).click()`); await wait(80);
    assert.deepEqual(await client.evaluate('window.refreshCalls'), [{ bookingId: "synthetic-rental", accountToken: "admin-fixture", admin: true }]);
    assert.match(await client.evaluate('document.body.textContent'), /No update recorded/);
    assert.equal(await client.evaluate('document.querySelector("a[href=\\"https://business.didit.me\\"]").getAttribute("rel")'), "noopener noreferrer");
    console.log("PASS verification review visual and refresh control at 320px; synthetic data only.");
  } finally { if (client) client.close(); if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; } server.close(); await wait(200); await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
