const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const helper = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", helper.slice(0, helper.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-cancellation-explainer-"));
  const entry = path.join(directory, "fixture.tsx");
  fs.writeFileSync(entry, `import React from "react";import{createRoot}from"react-dom/client";import{CancellationExplainerPage}from${JSON.stringify(path.join(root,"src/components/legal/CancellationExplainerPage.tsx"))};const root=createRoot(document.getElementById("root")!);const current={title:"Cancellation & Refund Policy",updated:"November 2026",sections:[{h:"Your cancellation",p:"For a rental accepted under this version, cancelling seven or more London calendar days before the earliest equipment start gives you a choice: a full refund of the remaining eligible rental payment to its original payment method, or 100% of that remaining rental value as account credit valid for 365 days."},{h:"Free cancellation protection",p:"If DB cancels before pickup because equipment is unexpectedly unavailable, every renter can receive a full refund of the remaining eligible rental payment to the original payment method."}]};const old={...current,sections:[{h:"Your cancellation",p:"Historical accepted terms remain unchanged."}]};window.renderPage=(historical=false)=>root.render(<CancellationExplainerPage doc={historical?old:current} version={historical?"2026-11-v20":"2026-11-v34"} showQuickGuide={!historical}/>);window.renderPage();`);
  await require("esbuild").build({
    absWorkingDir: root,
    nodePaths: [path.join(root, "node_modules")],
    entryPoints: [entry],
    outfile: path.join(directory, "fixture.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const globalCss = await require("postcss")([require("@tailwindcss/postcss")({ base: root })])
    .process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "application/javascript");
      return response.end(fs.readFileSync(path.join(directory, "fixture.js")));
    }
    if (request.url === "/fixture.css") {
      response.setHeader("Content-Type", "text/css");
      return response.end(`${globalCss.css}\nbody{margin:0;background:#08080a;color:#fff}`);
    }
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-cancellation-explainer-chrome-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore", detached: true });
  let browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
      try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; }
      catch { await wait(100); }
    }
    assert(port, "Temporary Chromium starts for the cancellation explainer visual test");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect("about:blank");
    await browser.cmd("Page.enable");
    await browser.cmd("Runtime.enable");
    for (const [width, height] of [[320, 800], [390, 844], [768, 900], [1024, 900], [1440, 1000]]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
      await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
      for (let attempt = 0; attempt < 80 && !await browser.evaluate(`!!document.querySelector('#full-policy-wording')`); attempt++) await wait(40);
      const layout = await browser.evaluate(`(()=>{const main=document.querySelector('main');const hero=main?.querySelector('header');const title=hero?.querySelector('h1');const details=hero?.querySelector('aside');const cards=[...main.querySelectorAll('article')];const nav=main.querySelector('nav');const anchors=[...main.querySelectorAll('nav a')];const guide=main.querySelector('.cancel-policy-quick-guide');const rect=(node)=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return{title:title?.textContent.trim(),version:details?.innerText,sections:cards.map(card=>({heading:card.querySelector('h3')?.textContent,copy:card.querySelector('p')?.textContent,rect:rect(card)})),anchorCount:anchors.length,anchorRects:anchors.map(rect),nav:nav?{client:nav.clientWidth,scroll:nav.scrollWidth}:null,guide:!!guide,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,hero:rect(hero),titleRect:rect(title),detailsRect:rect(details),fullText:main?.innerText}})()`);
      assert.equal(layout.title, "Cancellation & Refund Policy", `The real document title remains visible at ${width}px`);
      assert.equal(layout.sections.length, 2, `All policy sections render in the explainer at ${width}px`);
      assert.equal(layout.anchorCount, 2, `Section navigation matches the source document at ${width}px`);
      assert(layout.anchorRects.every(anchor => anchor.x >= -1 && anchor.right <= width + 1), `Section links remain visible without sideways scrolling at ${width}px`);
      assert(!layout.nav || layout.nav.scroll <= layout.nav.client + 1, `Section navigation wraps instead of clipping at ${width}px`);
      assert(layout.guide, `Current agreements retain the shared policy guide at ${width}px`);
      assert(layout.scrollWidth <= layout.viewport, `No horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
      assert(layout.sections.every(section => section.rect.x >= -1 && section.rect.right <= width + 1), `Full-wording cards fit the viewport at ${width}px`);
      assert(layout.fullText.includes("seven or more London calendar days") && layout.fullText.includes("every renter can receive a full refund"), `The supplied legal wording is not rewritten at ${width}px`);
      const screenshot = `/tmp/dbc-cancellation-explainer-${width}.png`;
      const screenshotResult = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(screenshot, Buffer.from(screenshotResult.data, "base64"));
      console.log(`PASS: ${width}px cancellation explainer; screenshot ${screenshot}`);
    }
    await browser.evaluate("window.renderPage(true)");
    const historical = await browser.evaluate(`({guide:!!document.querySelector('.cancel-policy-quick-guide'),version:document.querySelector('aside')?.innerText,copy:document.querySelector('article p')?.textContent})`);
    assert.equal(historical.guide, false, "Historical terms do not inherit the current cancellation guide");
    assert(historical.version.includes("2026-11-v20") && historical.copy === "Historical accepted terms remain unchanged.", "Historical version metadata and wording remain intact");
    console.log("PASS: historical agreement keeps its own wording and does not display the current guide");
  } finally {
    browser?.close();
    if (chrome.exitCode === null) {
      try { process.kill(-chrome.pid, "SIGTERM"); } catch { chrome.kill("SIGTERM"); }
      await Promise.race([new Promise(resolve => chrome.once("exit", resolve)), wait(2000)]);
    }
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
