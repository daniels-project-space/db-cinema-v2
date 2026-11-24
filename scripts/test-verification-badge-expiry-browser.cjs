const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-verification-badge-expiry-"));
const helper = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", helper.slice(0, helper.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, chrome, browser;

async function main() {
  const entry = 'import React from "react";import{createRoot}from"react-dom/client";import{useFreshVerification}from"./src/components/account/useFreshVerification";function Probe(){const fresh=useFreshVerification(window.__expiry);return <output id="fresh">{String(fresh)}</output>}createRoot(document.getElementById("root")).render(<Probe/>);';
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
  });
  server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(bundle.outputFiles[0].text);
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end('<meta name="viewport" content="width=device-width"><div id="root"></div><script>window.__verificationTimers=new Map();window.__verificationTimerId=0;window.__now=Date.now();window.__expiry=window.__now+90*86400000;const nativeSetTimeout=window.setTimeout.bind(window),nativeClearTimeout=window.clearTimeout.bind(window);Date.now=()=>window.__now;window.setTimeout=(callback,delay=0,...args)=>{if(delay>1000000){const id=++window.__verificationTimerId;window.__verificationTimers.set(id,{callback,delay});return id}return nativeSetTimeout(callback,delay,...args)};window.clearTimeout=id=>{if(window.__verificationTimers.has(id))window.__verificationTimers.delete(id);else nativeClearTimeout(id)};window.__advanceVerificationTimer=()=>{const [id,timer]=window.__verificationTimers.entries().next().value||[];if(!timer)return false;window.__verificationTimers.delete(id);window.__now+=timer.delay;timer.callback();return timer.delay}</script><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = path.join(directory, "chrome");
  chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", "--user-data-dir=" + profile], { stdio: "ignore" });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; break; }
    catch { await sleep(100); }
  }
  assert.ok(port, "Chrome starts for the local expiry fixture");
  process.env.DBC_CDP_URL = "http://127.0.0.1:" + port;
  browser = await connect();
  await browser.cmd("Page.enable");
  await browser.cmd("Runtime.enable");
  await browser.cmd("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/" });
  for (let attempt = 0; attempt < 100 && !await browser.evaluate('document.querySelector("#fresh")?.textContent'); attempt++) await sleep(50);
  assert.equal(await browser.evaluate('document.querySelector("#fresh").textContent'), "true", "A fresh account pass initially displays as verified");
  const maximumTimeout = 2147483647;
  const expiryDelay = 90 * 86400000;
  let elapsed = 0;
  while (expiryDelay - elapsed > maximumTimeout) {
    assert.equal(await browser.evaluate('[...window.__verificationTimers.values()][0]?.delay'), maximumTimeout, "Long validity windows use the maximum safe browser timeout");
    assert.equal(await browser.evaluate("window.__advanceVerificationTimer()"), maximumTimeout, "Each bounded timer advances to the next expiry check");
    elapsed += maximumTimeout;
    for (let attempt = 0; attempt < 100 && await browser.evaluate("window.__verificationTimers.size") === 0; attempt++) await sleep(10);
    assert.equal(await browser.evaluate('document.querySelector("#fresh").textContent'), "true", "The badge remains active before expiry");
  }
  const remaining = expiryDelay - elapsed;
  assert.equal(await browser.evaluate('[...window.__verificationTimers.values()][0]?.delay'), remaining, "The hook rearms for the remainder of the 90-day window");
  assert.equal(await browser.evaluate("window.__advanceVerificationTimer()"), remaining, "The final timer reaches the exact 90-day boundary");
  for (let attempt = 0; attempt < 100 && await browser.evaluate('document.querySelector("#fresh")?.textContent') !== "false"; attempt++) await sleep(10);
  assert.equal(await browser.evaluate('document.querySelector("#fresh").textContent'), "false", "The badge turns off exactly at 90 days without unrelated page activity");
  assert.equal(await browser.evaluate("window.__verificationTimers.size"), 0, "An expired pass does not keep scheduling timers");
  console.log("PASS verification badge expiry: bounded long timer rearms and the renter badge turns off exactly at 90 days. Synthetic browser clock only.");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) { try { await Promise.race([browser.cmd("Browser.close"), sleep(1000)]); } catch {} try { browser.close(); } catch {} }
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await Promise.race([done, sleep(2000)]); }
  if (server) { server.closeAllConnections(); await Promise.race([new Promise(resolve => server.close(resolve)), sleep(1000)]); }
  try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch {}
  process.exit(process.exitCode ?? 0);
});
