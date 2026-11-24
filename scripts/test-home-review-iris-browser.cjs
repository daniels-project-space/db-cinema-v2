const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const browserSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", browserSource.slice(0, browserSource.indexOf("const { ConvexHttpClient")) + "\nreturn connect;")(require);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(browser, expression, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await browser.evaluate(expression).catch(() => false)) return;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function screenshot(browser, name) {
  const result = await browser.cmd("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`/tmp/dbc-home-aperture-${name}.png`, Buffer.from(result.data, "base64"));
}

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-home-aperture-"));
  const entry = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { HomeApertureTransitionProvider } from "${path.join(root, "src/components/HomeApertureTransition.tsx")}";
    import { HomeClosingAperture } from "${path.join(root, "src/components/HomeClosingAperture.tsx")}";
    import { usePathname } from "next/navigation";
    function Scene() {
      const pathname = usePathname();
      return <div id="main-content" tabIndex={-1}>
        {pathname === "/gear" ? <main data-testid="gear-page" style={{ minHeight: "100vh", display: "grid", placeItems: "center", textAlign: "center", background: "radial-gradient(ellipse at center,#30251d,#090909 62%)" }}><div><h1>Real gear catalogue</h1><p>Camera, lens, lighting and audio listings.</p></div></main> : <HomeClosingAperture />}
      </div>;
    }
    createRoot(document.getElementById("root")).render(<HomeApertureTransitionProvider><Scene /></HomeApertureTransitionProvider>);
  `;
  await esbuild.build({
    absWorkingDir: root,
    nodePaths: [path.join(root, "node_modules")],
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    outfile: path.join(directory, "fixture.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    loader: { ".module.css": "local-css" },
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{
      name: "isolated-next-navigation",
      setup(build) {
        build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          loader: "tsx",
          resolveDir: root,
          contents: `
            import React, { useEffect, useState } from "react";
            const calls = { prefetch: [], push: [] };
            const router = {
              prefetch(path) { calls.prefetch.push(path); window.__apertureRouterCalls = calls; },
              push(path) { calls.push.push(path); window.__apertureRouterCalls = calls; history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); }
            };
            window.__apertureRouterCalls = calls;
            export function useRouter() { return router; }
            export function usePathname() {
              const [pathname, setPathname] = useState(() => location.pathname);
              useEffect(() => { const update = () => setPathname(location.pathname); addEventListener("popstate", update); return () => removeEventListener("popstate", update); }, []);
              return pathname;
            }
          `,
        }));
      },
    }],
  });

  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "application/javascript");
      return response.end(fs.readFileSync(path.join(directory, "fixture.js")));
    }
    if (request.url === "/fixture.css") {
      response.setHeader("Content-Type", "text/css");
      return response.end(fs.readFileSync(path.join(directory, "fixture.css")));
    }
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      *{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;background:#080809;color:#f5f1ec;font-family:Arial,sans-serif}#main-content{position:relative;z-index:10;min-height:100vh}
      [data-testid="gear-page"]{min-height:100vh;padding:4rem 2rem;background:linear-gradient(145deg,#1a1715,#080809)}
      body[data-aperture-transition="navigating"] #main-content{visibility:hidden}
      body[data-aperture-transition="revealing"] #main-content{position:relative;z-index:10001;pointer-events:none;animation:aperture-page-reveal 2.6s cubic-bezier(.33,0,.45,1) both,aperture-page-fade 1.4s ease-in-out both}
      @keyframes aperture-page-reveal{from{clip-path:circle(var(--aperture-reveal-start) at var(--aperture-main-x) var(--aperture-main-y))}to{clip-path:circle(var(--aperture-reveal-end) at var(--aperture-main-x) var(--aperture-main-y))}}
      @keyframes aperture-page-fade{from{opacity:0}to{opacity:1}}
    </style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const cdpPort = await availablePort();
  const chrome = spawn("/usr/bin/google-chrome", ["--headless=new", "--no-sandbox", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${path.join(directory, "chrome")}`, "about:blank"], { stdio: "ignore", detached: true });
  process.env.DBC_CDP_URL = `http://localhost:${cdpPort}`;
  let browser;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await fetch(`${process.env.DBC_CDP_URL}/json/version`); break; } catch { await delay(100); }
    }
    browser = await connect("about:blank");
    await browser.cmd("Page.enable");
    await browser.cmd("Runtime.enable");

    for (const width of [390, 1280]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await browser.cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
      const url = `http://127.0.0.1:${server.address().port}/`;
      await browser.cmd("Page.navigate", { url });
      await waitFor(browser, `!!document.querySelector('[data-testid="home-aperture-button"]')`, "the home aperture control");
      await browser.evaluate(`document.documentElement.style.scrollBehavior="auto";document.querySelector('[data-testid="home-aperture-button"]').scrollIntoView({block:"center",behavior:"instant"})`);
      await delay(120);
      let point = await browser.evaluate(`(()=>{const r=document.querySelector('[data-testid="home-aperture-button"]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);

      await browser.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      await delay(1500);
      assert(await browser.evaluate(`!!document.querySelector('[role="progressbar"]')`), `The hold progress appears at ${width}px`);
      await browser.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
      await delay(500);
      assert.equal(await browser.evaluate(`location.pathname`), "/", `Leaving early does not navigate at ${width}px`);
      assert.equal(await browser.evaluate(`document.querySelector('[data-testid="home-aperture-portal"]')`), null, `Early cancellation removes the transition portal at ${width}px`);
      assert.equal(await browser.evaluate(`document.body.dataset.apertureTransition || ''`), "", `Early cancellation restores the page at ${width}px`);

      await browser.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      await delay(2750);
      const committed = await browser.evaluate(`(()=>({phase:document.querySelector('[data-testid="home-aperture-portal"]')?.dataset.transitionPhase,progress:document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),route:location.pathname,pushes:window.__apertureRouterCalls.push.length,prefetches:window.__apertureRouterCalls.prefetch.slice(),letterAnimations:[...document.querySelectorAll('[data-portal-letter]')].filter(el=>el.getAnimations().length>0).length}))()`);
      assert.equal(committed.phase, "committed", `The 2.5-second hold commits at ${width}px`);
      assert.equal(committed.progress, "100", `The progress indicator completes at ${width}px`);
      assert.equal(committed.route, "/", `The route waits for the iris expansion at ${width}px`);
      assert.equal(committed.pushes, 0, `The route has not navigated before the large-hole phase at ${width}px`);
      assert(committed.letterAnimations > 20, `Headline and supporting copy animate letter by letter at ${width}px`);
      await screenshot(browser, `committed-${width}`);

      await waitFor(browser, `document.body.dataset.apertureTransition === 'revealing'`, "the circular page reveal", 6500);
      const firstFrame = await browser.evaluate(`(()=>({path:location.pathname,clip:getComputedStyle(document.querySelector('#main-content')).clipPath,main:document.querySelectorAll('#main-content').length,gear:document.querySelectorAll('[data-testid="gear-page"]').length,iframes:document.querySelectorAll('iframe').length,pushes:window.__apertureRouterCalls.push.slice()}))()`);
      const firstRadius = Number(firstFrame.clip.match(/circle\(([\d.]+)px/)?.[1]);
      assert.equal(firstFrame.path, "/gear", `The single router transition reaches the real gear route at ${width}px`);
      assert(firstFrame.clip.includes("circle("), `The page is clipped to an expanding circle at ${width}px`);
      assert(firstRadius > 0, `The gear reveal starts from a finite circular aperture at ${width}px`);
      assert.equal(firstFrame.main, 1, `Only one main page tree is mounted at ${width}px`);
      assert.equal(firstFrame.gear, 1, `The gear route appears exactly once at ${width}px`);
      assert.equal(firstFrame.iframes, 0, `The transition does not embed or duplicate the site in an iframe at ${width}px`);
      assert.deepEqual(firstFrame.pushes, ["/gear"], `The route is pushed exactly once at ${width}px`);
      await screenshot(browser, `reveal-start-${width}`);
      await delay(500);
      const laterRadius = Number((await browser.evaluate(`getComputedStyle(document.querySelector('#main-content')).clipPath`)).match(/circle\(([\d.]+)px/)?.[1]);
      assert(laterRadius > firstRadius, `The page reveal expands progressively, not in a single jump, at ${width}px`);
      await screenshot(browser, `reveal-500ms-${width}`);
      await waitFor(browser, `!document.body.dataset.apertureTransition`, "the reveal cleanup", 4000);
      const settled = await browser.evaluate(`(()=>({path:location.pathname,clip:getComputedStyle(document.querySelector('#main-content')).clipPath,portal:!!document.querySelector('[data-testid="home-aperture-portal"]'),pages:document.querySelectorAll('[data-testid="gear-page"]').length,pushes:window.__apertureRouterCalls.push.length}))()`);
      assert.equal(settled.path, "/gear", `The gear route remains after the transition at ${width}px`);
      assert.equal(settled.clip, "none", `The temporary circle mask is removed after completion at ${width}px`);
      assert.equal(settled.portal, false, `The transition overlay is cleaned up at ${width}px`);
      assert.equal(settled.pages, 1, `The final page is not duplicated at ${width}px`);
      assert.equal(settled.pushes, 1, `Only one route navigation occurred at ${width}px`);
      await screenshot(browser, `settled-${width}`);
    }

    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    await waitFor(browser, `!!document.querySelector('[data-testid="home-aperture-button"]')`, "the shortcut control");
    const button = await browser.evaluate(`(()=>{const control=document.querySelector('[data-testid="home-aperture-button"]'),r=control.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await browser.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: button.x, y: button.y });
    await delay(120);
    await browser.evaluate(`document.querySelector('[data-testid="home-aperture-button"]').click()`);
    await waitFor(browser, `location.pathname === '/gear'`, "the click shortcut", 3000);
    assert.equal(await browser.evaluate(`window.__apertureRouterCalls.push.length`), 1, "Clicking shortcuts directly to gear with one route transition");
    assert.equal(await browser.evaluate(`window.__apertureRouterCalls.prefetch.length`), 1, "Clicking during the hover hold reuses its in-flight gear prefetch");
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid="gear-page"]').length`), 1, "The shortcut does not duplicate the gear page");

    await browser.cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    await waitFor(browser, `!!document.querySelector('[data-testid="home-aperture-button"]')`, "the reduced-motion aperture control");
    const reducedMotionButton = await browser.evaluate(`(()=>{const r=document.querySelector('[data-testid="home-aperture-button"]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await browser.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: reducedMotionButton.x, y: reducedMotionButton.y });
    await delay(250);
    assert.equal(await browser.evaluate(`location.pathname`), "/", "Reduced-motion hover never navigates without explicit activation");
    assert.equal(await browser.evaluate(`window.__apertureRouterCalls.push.length`), 0, "Reduced-motion hover does not push a route");
    await browser.evaluate(`(()=>{const button=document.querySelector('[data-testid="home-aperture-button"]');button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:1}));button.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch',pointerId:1}));button.dispatchEvent(new MouseEvent('click',{bubbles:true}))})()`);
    await waitFor(browser, `location.pathname === '/gear'`, "reduced-motion explicit activation", 1000);
    assert.deepEqual(await browser.evaluate(`window.__apertureRouterCalls.push`), ["/gear"], "Reduced-motion touch activation navigates exactly once");
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid="gear-page"]').length`), 1, "Reduced-motion activation still renders a single gear page");
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid="home-aperture-portal"]')`), false, "Reduced-motion activation skips the animated overlay");
    console.log("PASS isolated aperture browser fixture: cancellable hold, progressive circle reveal, single gear navigation, letter motion and click shortcut.");
  } finally {
    if (browser) {
      browser.close();
      await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(() => {});
    }
    try { process.kill(-chrome.pid, "SIGTERM"); } catch {}
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => {
      if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
      chrome.once("exit", resolve);
      setTimeout(resolve, 3000).unref();
    });
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
