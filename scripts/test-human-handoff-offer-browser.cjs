const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), os = require("node:os"), path = require("node:path"), { spawn } = require("node:child_process");
const esbuild = require("esbuild"), postcss = require("postcss");
const source = fs.readFileSync("scripts/test-membership-browser.cjs", "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + "\nreturn connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const bundle = await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {HumanHandoffOffer} from './src/components/rentals/HumanHandoffOffer';createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:360}}><HumanHandoffOffer onRequest={()=>{window.calls++;return new Promise((resolve,reject)=>{window.finish=resolve;window.fail=reject})}}/></main>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    response.setHeader("content-type", "text/html"); response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:#111;color:white"><div id="root"></div><script>window.calls=0</script><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-handoff-offer-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temporary}`], { stdio: "ignore" });
  let client;
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${temporary}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; client = await connect(); await client.cmd("Page.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=human-handoff-offer]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('window.calls'), 0);
    assert.equal(await client.evaluate('document.documentElement.scrollWidth > innerWidth'), false);
    const image = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-human-handoff-offer-320.png", Buffer.from(image.data, "base64"));
    await client.evaluate(`document.querySelector('button').click();document.querySelector('button').click()`); await wait(80);
    assert.equal(await client.evaluate('window.calls'), 1, 'Repeated clicks cannot duplicate a pending request');
    await client.evaluate(`window.fail(Error('unknown'))`); await wait(80);
    assert.match(await client.evaluate('document.querySelector("[role=alert]").textContent'), /could not be confirmed/);
    await client.evaluate(`document.querySelector('button').click()`); await wait(80);assert.equal(await client.evaluate('window.calls'), 2);
    await client.evaluate(`window.finish()`); await wait(80);
    assert.match(await client.evaluate('document.querySelector("[role=status]").textContent'), /request was recorded/);
    assert.equal(await client.evaluate('document.querySelector("button")'), null, 'An accepted request cannot be sent twice while state catches up');
    console.log("PASS human-handoff offer: explicit request, pending lock, failure retry, accepted state and 320px layout; synthetic data only.");
  } finally { if (client) client.close(); if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; } server.close(); await wait(200); await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
