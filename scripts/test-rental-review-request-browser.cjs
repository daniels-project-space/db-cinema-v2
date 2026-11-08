const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), os = require("node:os"), path = require("node:path"), { spawn } = require("node:child_process");
const esbuild = require("esbuild"), postcss = require("postcss");
const source = fs.readFileSync("scripts/test-membership-browser.cjs", "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + "\nreturn connect;")(require);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const bundle = await esbuild.build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {RentalReviewRequest} from './src/components/admin/RentalReviewRequest';function Fixture(){const [booking,setBooking]=useState('rental-one');const [token,setToken]=useState('fixture-admin');const [state,setState]=useState('ready');window.fixture={setBooking,setState,setToken};return <main style={{padding:16}}><RentalReviewRequest token={token} bookingId={booking}/></main>}createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, plugins: [{ name: "mock-convex", setup(build) {
    build.onResolve({ filter: /^convex\/react$|_generated\/api$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", contents: args.path === "convex/react" ? `export const useQuery=(_ref,args)=>({state:window.fixtureState??'ready',bookingId:args.bookingId});export const useMutation=()=>async(args)=>{window.calls.push(args);return {state:'sent'}};` : `export const api={reviewInvitations:{adminStatus:'adminStatus',sendByAdmin:'sendByAdmin'}};` }));
  } }] });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    response.setHeader("content-type", "text/html"); response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:#111;color:white"><div id="root"></div><script>window.calls=[]</script><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-review-request-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temporary}`], { stdio: "ignore" });
  let client;
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${temporary}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; client = await connect(); await client.cmd("Page.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=admin-review-request]")'); attempt++) await wait(100);
    const click = async text => { const found = await client.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(element=>element.textContent.trim()===${JSON.stringify(text)});if(!button)return false;button.click();return true})()`); assert(found, `Missing button: ${text}`); await wait(80); };
    await client.evaluate('document.querySelector("summary").click()'); await wait(80);
    assert.equal(await client.evaluate("window.calls.length"), 0);
    await click("Send review request"); assert.equal(await client.evaluate("window.calls.length"), 0, "opening confirmation must not send");
    assert.match(await client.evaluate('document.querySelector("[role=group]").textContent'), /receive the review form in this rental chat/i);
    const reviewPreview = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-review-request-confirm-320.png", Buffer.from(reviewPreview.data, "base64"));
    await click("Cancel"); assert.equal(await client.evaluate("window.calls.length"), 0, "cancellation must not send");
    await click("Send review request"); await click("Confirm and send");
    assert.deepEqual(await client.evaluate("window.calls"), [{ token: "fixture-admin", bookingId: "rental-one" }]);
    assert.match(await client.evaluate('document.querySelector("[role=status]").textContent'), /review request is in this rental conversation/i);
    await client.evaluate("window.fixtureState='sent';window.fixture.setState('sent')"); await wait(80);
    assert.match(await client.evaluate('document.querySelector("[data-testid=admin-review-request]").textContent'), /already in this rental conversation/i);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-review-request] button").length'), 0);
    await client.evaluate("window.fixtureState='not_settled';window.fixture.setState('not_settled')"); await wait(80);
    assert.match(await client.evaluate('document.querySelector("[data-testid=admin-review-request]").textContent'), /settlement must be complete/i);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-review-request] button").length'), 0);
    await client.evaluate("window.fixtureState='ready';window.fixture.setState('ready')"); await wait(80);
    await click("Send review request");
    await client.evaluate("window.fixture.setBooking('rental-two')"); await wait(80);
    assert.equal(await client.evaluate(`[...document.querySelectorAll('button')].some(element=>element.textContent.trim()==='Confirm and send')`), false, "changing rental must discard the previous confirmation");
    await client.evaluate('document.querySelector("summary").click()'); await wait(80);
    await click("Send review request"); await click("Confirm and send");
    assert.deepEqual(await client.evaluate("window.calls[1]"), { token: "fixture-admin", bookingId: "rental-two" });
    assert.equal(await client.evaluate(`[...document.querySelectorAll('button')].some(element=>element.textContent.trim()==='Send review request')`), false, "A completed send cannot be repeated while status catches up");
    await client.evaluate("window.fixtureState='sent';window.fixture.setState('sent')"); await wait(80);
    await client.evaluate("window.fixtureState='ready';window.fixture.setState('ready')"); await wait(80);
    await click("Send review request");
    await client.evaluate("window.fixture.setToken('different-admin')"); await wait(80);
    assert.equal(await client.evaluate(`[...document.querySelectorAll('button')].some(element=>element.textContent.trim()==='Confirm and send')`), false, "changing admin must discard the previous confirmation");
    await client.evaluate('document.querySelector("summary").click()'); await wait(80);
    await click("Send review request"); await click("Confirm and send");
    assert.deepEqual(await client.evaluate("window.calls[2]"), { token: "different-admin", bookingId: "rental-two" });
    assert.equal(await client.evaluate("document.documentElement.scrollWidth > innerWidth"), false, "320px must not overflow horizontally");
    const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-review-request-320.png", Buffer.from(screenshot.data, "base64"));
    console.log("PASS review-request confirmation, cancellation, rental selection, eligibility, sent state and 320px layout; synthetic data only.");
  } finally { if (client) client.close(); if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; } server.close(); await wait(200); await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
