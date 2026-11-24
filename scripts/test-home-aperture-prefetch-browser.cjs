const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const helper = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", helper.slice(0, helper.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-aperture-prefetch-"));
  const entry = path.join(dir, "fixture.tsx");
  fs.writeFileSync(entry, `import React from "react";import{createRoot}from"react-dom/client";import{HomeApertureTransitionProvider,useHomeApertureTransition}from${JSON.stringify(path.join(root, "src/components/HomeApertureTransition.tsx"))};function Driver(){const{phase,begin}=useHomeApertureTransition();return <><button id="start" data-testid="start" onClick={event=>begin(event.currentTarget)}>Open catalogue</button><output data-testid="phase">{phase}</output></>}createRoot(document.getElementById("root")).render(<HomeApertureTransitionProvider><Driver/></HomeApertureTransitionProvider>);`);
  const modules = {
    "next/navigation": `export function useRouter(){return window.__mockRouter}export function usePathname(){return window.location.pathname}`,
    "./HomeApertureArt": `import React from "react";export function HomeApertureArt(){return <svg viewBox="0 0 1 1"/>}`,
    "./HomeClosingAperture.module.css": `export default new Proxy({}, {get:(_target,key)=>String(key)})`,
    "./HomeApertureTransition.module.css": `export default new Proxy({}, {get:(_target,key)=>String(key)})`,
  };
  const plugin = {
    name: "aperture-prefetch-fixture",
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => modules[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: args.path.endsWith(".css") ? "js" : "jsx", resolveDir: root, contents: modules[args.path] }));
    },
  };
  let browser;
  let chrome;
  let server;
  let profile;
  try {
    await require("esbuild").build({
      absWorkingDir: root,
      nodePaths: [path.join(root, "node_modules")],
      entryPoints: [entry],
      outfile: path.join(dir, "fixture.js"),
      bundle: true,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      tsconfig: path.join(root, "tsconfig.json"),
      plugins: [plugin],
      define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    });
    server = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/fixture.js") {
        response.setHeader("Content-Type", "application/javascript");
        return response.end(fs.readFileSync(path.join(dir, "fixture.js")));
      }
      if (pathname === "/gear-loop-poster.jpg") {
        response.setHeader("Content-Type", "image/jpeg");
        response.setHeader("Cache-Control", "public, max-age=600");
        return fs.createReadStream(path.join(root, "public/gear-loop-poster.jpg")).pipe(response);
      }
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#090a0b;color:#f6f0e7;font:16px Arial}#root{min-height:100vh;display:grid;place-items:center}button{padding:14px 24px;border:1px solid #c08f62;border-radius:999px;background:#171513;color:#fff}</style></head><body><div id="root"></div><script>window.__prefetches=[];window.__mockRouter={prefetch:path=>window.__prefetches.push(path),push:path=>window.__pushes=(window.__pushes||[]).concat(path)}</script><script src="/fixture.js"></script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-aperture-prefetch-chrome-"));
    chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore", detached: true });
    let port;
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
      try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; }
      catch { await wait(100); }
    }
    assert(port, "A temporary Chromium process starts for the local aperture fixture");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect("about:blank");
    await browser.cmd("Page.enable");
    await browser.cmd("Runtime.enable");
    await browser.cmd("Network.enable");
    const posterResponse = new Promise(resolve => {
      browser.on(message => {
        if (message.method === "Network.responseReceived" && message.params.response.url.endsWith("/gear-loop-poster.jpg")) resolve(message.params.response);
      });
    });
    await browser.cmd("Page.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 60 && !await browser.evaluate(`!!document.querySelector('[data-testid="start"]')`); attempt++) await wait(50);
    await browser.evaluate(`document.querySelector('[data-testid="start"]').click()`);
    for (let attempt = 0; attempt < 60 && !await browser.evaluate(`!!document.querySelector('[data-testid="home-aperture-portal"]')`); attempt++) await wait(50);
    const preload = await browser.evaluate(`(()=>{const link=document.querySelector('link[data-home-gear-preload="poster"]');return{path:window.__prefetches[0],count:document.querySelectorAll('link[data-home-gear-preload="poster"]').length,href:link?.getAttribute('href'),as:link?.as,priority:link?.getAttribute('fetchpriority'),phase:document.querySelector('[data-testid="home-aperture-portal"]')?.dataset.transitionPhase}})()`);
    assert.equal(preload.path, "/gear", "The actual hover transition asks Next to prefetch the gear route before navigation");
    assert.equal(preload.count, 1, "Hover preloading inserts a single gear poster hint");
    assert.equal(preload.href, "/gear-loop-poster.jpg", "The reveal poster is the asset warmed on hover");
    assert.equal(preload.as, "image", "The browser gives the gear poster the correct image fetch destination");
    assert.equal(preload.priority, "high", "The small reveal poster is prioritized ahead of the lazy hero film");
    assert.equal(preload.phase, "charging", "Route and poster preloading begin while the aperture is charging");
    const response = await Promise.race([posterResponse, wait(5000).then(() => null)]);
    assert(response && response.status === 200, "The hover-triggered poster preload completes successfully from the local asset server");
    const screenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbc-home-aperture-gear-prefetch.png", Buffer.from(screenshot.data, "base64"));
    console.log("PASS gear-route and poster prefetch on aperture hover; poster response=200. Screenshot: /tmp/dbc-home-aperture-gear-prefetch.png");
  } finally {
    browser?.close();
    if (chrome?.exitCode === null) {
      try { process.kill(-chrome.pid, "SIGTERM"); } catch { chrome.kill("SIGTERM"); }
      await Promise.race([new Promise(resolve => chrome.once("exit", resolve)), wait(2000)]);
    }
    if (server) await new Promise(resolve => server.close(resolve));
    if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
