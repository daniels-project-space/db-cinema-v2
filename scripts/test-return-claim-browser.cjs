const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const assert = require("node:assert/strict");
const esbuild = require("esbuild");
const postcss = require("postcss");
const root = path.resolve(__dirname, "..");
const helper = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", `${helper.slice(0, helper.indexOf("const { ConvexHttpClient }"))};return connect;`)(require);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-return-claim-ui-"));
  let server;
  let client;
  try {
    const booking = {
      _id: "booking-fixture", status: "active", securityPolicyVersion: "2026-11-immediate-claim-v2",
      guestEmail: "fixture@example.invalid", fulfilment: "pickup", total: 100, depositAmount: 0,
      depositHoldAmount: 0, savedCardLimit: 50, replacementValues: [{ listingId: "lens", unitPence: 100000 }],
      returnTime: "20:00", returnDecision: null,
      lineItems: [{ listingId: "lens", title: "Fixture lens", qty: 1, start: Date.now() - 86400000, end: Date.now() - 86400000, lineTotal: 100, dailyRate: 100 }],
    };
    const moduleStyles = [];
    const schedule = { legacy: true, items: [{ key: "legacy:0:0", title: "Fixture lens", imageSources: [], sku: "FX-01" }] };
    const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {ReturnRentalForm} from './src/components/admin/ReturnRentalForm';createRoot(document.getElementById('root')).render(<ReturnRentalForm booking={${JSON.stringify(booking)}} token="fixture-token" onClose={()=>{}}/>);`;
    await esbuild.build({
      stdin: { contents: entry, resolveDir: root, loader: "tsx" },
      outfile: path.join(directory, "fixture.js"),
      bundle: true, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
      plugins: [{
        name: "return-claim-fixtures",
        setup(build) {
          build.onLoad({ filter: /\.module\.css$/ }, (args) => {
            const css = fs.readFileSync(args.path, "utf8");
            moduleStyles.push(css);
            const names = [...new Set([...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]))];
            return { loader: "js", contents: `export default ${JSON.stringify(Object.fromEntries(names.map((name) => [name, name])))};` };
          });
          build.onResolve({ filter: /(@cvx\/_generated\/api|convex\/react|ReturnSettlementReview|ReturnInspectionHistory|DepositRefundStatus|DepositSettlementControl|\.\.\/SmartImage|@\/lib\/pricing|@cvx\/lib\/lateFee)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
            let contents;
            if (args.path.endsWith("_generated/api")) contents = `const refs=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>String(group)+'.'+String(method)})});export const api=refs;`;
            else if (args.path === "convex/react") contents = `export const useQuery=ref=>ref==='returnInspections.schedule'?${JSON.stringify(schedule)}:null;export const useAction=()=>async()=>({});`;
            else if (args.path.includes("ReturnSettlementReview")) contents = `import React from 'react';export const ReturnSettlementReview=({enabled,onReview,paymentSummary})=><section>{paymentSummary}<button type="button" disabled={!enabled} onClick={onReview}>Review return</button></section>;`;
            else if (args.path.includes("SmartImage")) contents = `import React from 'react';export const SmartImage=({alt})=><span role="img" aria-label={alt}/>;`;
            else if (args.path.includes("pricing")) contents = `export const formatGbp=value=>'£'+Number(value).toFixed(2);`;
            else if (args.path.includes("lateFee")) contents = `export const lateFeeQuote=()=>({amount:100,breakdown:[{title:'Fixture lens',days:1,dailyRate:100,amount:100}]});`;
            else contents = `import React from 'react';export const ReturnInspectionHistory=()=>null,DepositRefundStatus=()=>null,DepositSettlementControl=()=>null;`;
            return { loader: "tsx", resolveDir: root, contents };
          });
        },
      }],
    });
    const globalCss = (await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") })).css;
    server = http.createServer((req, res) => {
      if (req.url === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); res.end(fs.readFileSync(path.join(directory, "fixture.js"))); }
      else if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(`html,body{margin:0;background:#000;color:#eee}\n${globalCss}\n${moduleStyles.join("\n")}`); }
      else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body class="bg-black text-white"><div id="root"></div><script src="/fixture.js"></script>'); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    client = await connect();
    await client.cmd("Page.enable");
    for (const width of [390, 1280]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: width === 390 });
      await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
      for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[aria-label="Return equipment inspection"]')`); attempt++) await wait(100);
      await client.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Mark all good'));button?.click()})()`);
      await client.evaluate(`(()=>{const summary=[...document.querySelectorAll('summary')].find(x=>x.textContent.includes('Return time'));summary?.click()})()`);
      const initial = await client.evaluate(`(()=>{const late=[...document.querySelectorAll('label')].find(x=>x.textContent.includes('I am claiming this late amount'));const input=late?.querySelector('input[type=checkbox]');return {checked:input?.checked,text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
      assert.equal(initial.checked, false, "late claim must be opt-in");
      assert.match(initial.text, /No late fee will be claimed/);
      assert.match(initial.text, /No claim means no card charge\./, "The renter-facing no-claim summary reflects the saved-card flow");
      assert.doesNotMatch(initial.text, /active card hold is released|remaining authorisations are released/, "SetupIntent rentals must not be described as holding funds");
      assert.doesNotMatch(initial.text, /Reason for waiving late time/);
      assert.equal(initial.overflow, false, `${width}px layout should not overflow`);
      const defaultScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(`/tmp/dbc-return-unclaimed-${width}.png`, Buffer.from(defaultScreenshot.data, "base64"));
      await client.evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(x=>x.textContent.includes('I am claiming this late amount'));label?.querySelector('input').click()})()`);
      const claim = await client.evaluate(`(()=>({reason:!![...document.querySelectorAll('label')].find(x=>x.textContent.includes('Reason for your claim')),button:[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Review return'))?.disabled}))()`);
      assert.equal(claim.reason, true, "a reason field must appear only after an explicit claim");
      assert.equal(claim.button, true, "a claim without its reason must not proceed");
      assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Owner return claim code"]')`), true, "a money claim must expose the owner-only code field");
      const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(`/tmp/dbc-return-claim-${width}.png`, Buffer.from(screenshot.data, "base64"));
      if (width === 390) {
        const reason = await client.evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(x=>x.textContent.includes('Reason for your claim'));const input=label?.querySelector('input');input?.focus();input?.select();return !!input})()`);
        assert.equal(reason, true, "the owner must be able to enter a reason before review");
        await client.cmd("Input.insertText", { text: "Documented late return claim for the browser fixture." });
        await client.evaluate(`(()=>[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Review return'))?.click())()`);
        await wait(100);
        assert.equal(await client.evaluate(`!![...document.querySelectorAll('button')].find(x=>x.textContent.includes('Confirm return'))?.disabled`), true, "a reason and return preview still cannot authorize a money claim without the owner code");
        const ownerInput = await client.evaluate(`(()=>{const input=document.querySelector('[aria-label="Owner return claim code"]');input?.focus();return !!input})()`);
        assert.equal(ownerInput, true);
        await client.cmd("Input.insertText", { text: "a".repeat(64) });
        assert.equal(await client.evaluate(`![...document.querySelectorAll('button')].find(x=>x.textContent.includes('Confirm return'))?.disabled`), true, "after a current preview, explicit owner authorization enables the return");
      }
      await client.evaluate(`(()=>{const input=document.querySelector('.paymentSummary input[type="number"]');input?.focus();input?.select()})()`);
      await client.cmd("Input.insertText", { text: "10" });
      await wait(50);
      const optIn = await client.evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(x=>x.textContent.includes('I am claiming this amount'));return {visible:!!label,checked:label?.querySelector('input')?.checked,basis:!![...document.querySelectorAll('select')].find(el=>[...el.options].some(o=>o.value==='severe_cosmetic_damage'))}})()`);
      assert.equal(optIn.visible, true, "entering a damage amount must expose an explicit claim opt-in");
      assert.equal(optIn.checked, false, "an entered amount must not be claimed by default");
      assert.equal(optIn.basis, false, "claim-only details stay hidden until the owner opts in");
      await client.evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(x=>x.textContent.includes('I am claiming this amount'));label?.querySelector('input').click()})()`);
      const basis = await client.evaluate(`(()=>{const select=[...document.querySelectorAll('select')].find(el=>[...el.options].some(o=>o.value==='severe_cosmetic_damage'));return {visible:!!select,options:select?[...select.options].map(o=>o.textContent):[]}})()`);
      assert.equal(basis.visible, true, "new saved-card terms require a specific loss or permanent-damage basis");
      assert.deepEqual(basis.options.slice(1), ["Severe permanent cosmetic damage", "Lost / unreturned item"]);
      await client.evaluate(`document.querySelector('select')?.scrollIntoView({block:'center'})`);
      const basisScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(`/tmp/dbc-return-damage-basis-${width}.png`, Buffer.from(basisScreenshot.data, "base64"));
    }
    console.log("PASS return claim UI: late fee unchecked by default; claim reason required; no mobile/desktop overflow.");
  } finally {
    if (client) { client.close(); await fetch(`${process.env.DBC_CDP_URL || "http://localhost:9224"}/json/close/${client.tabId}`); }
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
