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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-cancellation-policy-"));
  const entry = path.join(directory, "fixture.tsx");
  fs.writeFileSync(entry, `import React from "react";import{createRoot}from"react-dom/client";import{CancellationPolicyQuickGuide}from${JSON.stringify(path.join(root,"src/components/CancellationPolicyQuickGuide.tsx"))};const root=createRoot(document.getElementById("root")!);window.renderPolicy=version=>root.render(<CancellationPolicyQuickGuide version={version}/>);window.renderPolicy("2026-11-v31");`);
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
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main id="root"></main><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-cancellation-chrome-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore", detached: true });
  let browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
      try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; }
      catch { await wait(100); }
    }
    assert(port, "Temporary Chromium starts for the cancellation policy visual test");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect("about:blank");
    await browser.cmd("Page.enable");
    await browser.cmd("Runtime.enable");
    for (const [width, height, expectedColumns] of [[320, 800, 1], [390, 844, 1], [768, 900, 1], [1024, 900, 3], [1440, 980, 3]]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
      await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
      for (let attempt = 0; attempt < 80 && !await browser.evaluate(`document.querySelectorAll('ol[aria-label] > li').length===3`); attempt++) await wait(40);
      const layout = await browser.evaluate(`(()=>{const root=document.querySelector('.cancel-policy-quick-guide');const list=root?.querySelector('ol');const cards=[...root.querySelectorAll('ol>li')];const rule=root?.querySelector('.cancel-policy-timeline-rule')?.getBoundingClientRect();const markers=[...root.querySelectorAll('.cancel-policy-timeline-marker')].map(marker=>{const box=marker.getBoundingClientRect();return{visible:getComputedStyle(marker).display!=='none',center:box.top+box.height/2}});const stageRows=cards.map(card=>Object.fromEntries(['range','timing','amount','outcome'].map(name=>{const box=card.querySelector('[data-testid="cancellation-stage-'+name+'"]')?.getBoundingClientRect();return[name,box?.top]})));return{title:root?.querySelector('h2')?.textContent,columns:getComputedStyle(list).gridTemplateColumns.split(' ').length,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,cardWidths:cards.map(card=>({client:card.clientWidth,scroll:card.scrollWidth})),amounts:cards.map(card=>[...card.querySelectorAll('[role="progressbar"]')].map(bar=>Number(bar.getAttribute('aria-valuenow')))),ruleCenter:rule?.top+rule?.height/2,markers,stageRows,text:root?.innerText}})()`);
      assert.equal(layout.title, "If plans change", `The policy heading stays clear at ${width}px`);
      assert.equal(layout.columns, expectedColumns, `Policy stages use the intended responsive column count at ${width}px`);
      assert(layout.scrollWidth <= layout.viewport, `The policy has no horizontal page overflow at ${width}px: ${JSON.stringify(layout)}`);
      assert(layout.cardWidths.every(card => card.scroll <= card.client + 1), `No timeline card clips text at ${width}px: ${JSON.stringify(layout.cardWidths)}`);
      assert.deepEqual(layout.amounts, [[100], [100], [0]], `One non-additive return-value bar preserves the agreed current amounts at ${width}px`);
      if (width >= 1024) {
        assert(layout.markers.every(marker => marker.visible), "The desktop timeline shows one node per cancellation window");
        assert(layout.markers.every(marker => Math.abs(marker.center - layout.ruleCenter) < 1), `Timeline nodes align exactly with the connector at ${width}px`);
        for (const row of ["range", "timing", "amount", "outcome"]) {
          const tops = layout.stageRows.map(stage => stage[row]);
          assert(tops.every(top => Math.abs(top - tops[0]) < 1), `Desktop ${row} rows align across all three cancellation windows at ${width}px: ${JSON.stringify(tops)}`);
        }
      } else {
        assert(layout.markers.every(marker => !marker.visible), "Mobile cards do not show a detached desktop timeline");
      }
      assert(layout.text.toUpperCase().includes("SEPARATE PROTECTION") && layout.text.includes("130%"), `Company-cancellation protection remains visually distinct at ${width}px`);
      for (const phrase of ["7+ days before first item starts", "Full refund", "or 100% account credit", "More than 48 hours before pickup", "But fewer than 7 days before the first item starts", "100% account credit", "No cash refund", "48 hours or less before pickup", "No account credit", "scheduled London pickup"]) {
        assert(layout.text.includes(phrase), `The current policy clearly shows “${phrase}” at ${width}px`);
      }
      const screenshot = `/tmp/dbc-cancellation-policy-${width}.png`;
      const screenshotResult = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(screenshot, Buffer.from(screenshotResult.data, "base64"));
      console.log(`PASS: ${width}px policy timeline visual; screenshot ${screenshot}`);
      if (width === 320) {
        const bars = await browser.evaluate(`document.querySelectorAll('.cancel-policy-quick-guide [role="progressbar"]').length`);
        assert.equal(bars, 3, "Each current-policy window exposes one non-additive return amount on narrow phones");
      }
      if (width === 390) {
        await browser.evaluate(`window.renderPolicy("2026-11-v28")`);
        const v28 = await browser.evaluate(`document.querySelector('.cancel-policy-quick-guide')?.innerText`);
        assert(v28.includes("48 hours or more before pickup") && v28.includes("Less than 48 hours before pickup"), "v28 keeps exactly 48 hours in the credit-only window");
        await browser.evaluate(`window.renderPolicy("2026-11-v18")`);
        const historic = await browser.evaluate(`document.querySelector('.cancel-policy-quick-guide')?.innerText`);
        assert(historic.includes("100% of the remaining rental value · valid 365 days"), "Historical credit duration remains visible");
        assert.equal(await browser.evaluate(`document.querySelectorAll('.cancel-policy-quick-guide ol>li').length`), 2, "Historical terms retain their original two cancellation windows");
        assert.deepEqual(await browser.evaluate(` [...document.querySelectorAll('.cancel-policy-quick-guide ol>li')].map(card=>[...card.querySelectorAll('[role="progressbar"]')].map(bar=>Number(bar.getAttribute('aria-valuenow'))))`), [[100], [100]], "Historical refund/credit options remain unchanged in the non-additive amount visualization");
      }
    }
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
