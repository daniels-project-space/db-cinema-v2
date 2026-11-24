const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");
const rentalHarness = require("./lib/rentalTestHarness.cjs");
const connectSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", connectSource.slice(0, connectSource.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = path.resolve(__dirname, "..");
  const { db, put, putFreshSharedStock, load } = rentalHarness;
  putFreshSharedStock();
  const inventory = (name, quantityOwned) => put("inventory_units", { name, active: true, quantityOwned });
  const listing = (title, category, itemType, unit, pricing, r2Images, specs = {}) => put("listings", {
    title,
    slug: title.toLowerCase().replaceAll(" ", "-"),
    category,
    itemType,
    active: true,
    stockMappingStatus: "complete",
    components: [{ inventoryUnitId: unit._id, qty: 1 }],
    pricing: { daily: pricing },
    depositAmount: 0,
    r2Images: [r2Images],
    specs,
  });
  const unavailable = listing("Unavailable Sony camera", "Cameras", "camera-body", inventory("unavailable camera", 0), 40, "/fixtures/sony-camera.webp", { mount: "E" });
  const alternative = listing("Cinema camera kit", "Cameras", "camera-body", inventory("FX3 body", 1), 40, "/images/management/documents-kit-spotlight.webp", { mount: "E" });
  const retainedLens = listing("Sony 24-70mm lens", "Lenses", "lens", inventory("24-70 lens", 1), 20, "/fixtures/sony-24-70.webp", { mount: "E" });
  const unavailableId = String(unavailable._id), alternativeId = String(alternative._id), retainedLensId = String(retainedLens._id);
  const start = Date.UTC(2030, 1, 1), end = start + 2 * 86_400_000;
  const items = [
    { key: "unavailable-body", listingId: unavailable._id, start, end, pickupTime: "09:00", returnTime: "18:00", qty: 1, title: unavailable.title },
    { key: "retained-lens", listingId: retainedLens._id, start, end, pickupTime: "09:00", returnTime: "18:00", qty: 1, title: retainedLens.title },
  ];
  const replacements = load("convex/cartReplacements.ts");
  const queryArgs = { items, sourceKey: "unavailable-body", limit: 3 };
  const initialData = await replacements.sets.handler({ db }, queryArgs);
  assert.equal(initialData.status, "ready");
  assert.equal(initialData.options.length, 1, "The real stock query finds a complete replacement for the unavailable line");
  assert.equal(initialData.options[0].items.length, 1);
  assert.equal(initialData.options[0].items[0].heroImage, "/images/management/documents-kit-spotlight.webp", "The replacement uses the listing photo, not a generated item icon");
  const initialTotal = initialData.options[0].items[0].total;
  await db.patch(alternative._id, { pricing: { daily: 60 } });
  const freshData = await replacements.sets.handler({ db }, queryArgs);
  const freshTotal = freshData.options[0].items[0].total;
  assert.notEqual(freshTotal, initialTotal, "The live recheck carries the updated rental quote");

  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{ReplacementSets}from'./src/components/cart/ReplacementSets';createRoot(document.getElementById('root')).render(<main><ReplacementSets item={window.__initialItems[0]}/></main>);`;
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    plugins: [{ name: "replacement-browser-fixture", setup(build) {
      build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|next\/link|@\/components\/SmartImage|@\/lib\/demandTracking|@\/lib\/dates|@\/lib\/pricing|\.\/CartProvider)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", resolveDir: root, contents:
        args.path === "convex/react" ? `import{useState}from'react';export const useQuery=(ref,args)=>window.__fixtureQuery(ref,args);export const useMutation=()=>async()=>({ok:true});export const useConvex=()=>({query:async(ref,args)=>window.__freshFixtureQuery(ref,args)});` :
        args.path === "@cvx/_generated/api" ? `const path=a=>new Proxy({}, {get:(_,b)=>a+'.'+String(b)});export const api=new Proxy({}, {get:(_,a)=>path(String(a))});` :
        args.path === "next/link" ? `import React from'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}` :
        args.path === "@/components/SmartImage" ? `import React from'react';export function SmartImage({src,fallbackSources,alt,...props}){return React.createElement('img',{src:src||fallbackSources?.[0],alt,...props})}` :
        args.path === "@/lib/demandTracking" ? `export function recordReplacement(){window.__replacementTracked=(window.__replacementTracked||0)+1}` :
        args.path === "@/lib/dates" ? `export const dayMs=value=>new Date(value+'T00:00:00Z').getTime()` :
        args.path === "@/lib/pricing" ? `export const formatGbp=value=>'£'+Number(value).toFixed(2)` :
        `import{useState}from'react';export function useCart(){const[items,setItems]=useState(window.__initialItems);window.__cartSnapshot=items;return{items,switchSet(expected,keys,replacements){if(JSON.stringify(items)!==expected)throw Error('Your basket changed. Refresh before applying replacements.');const next=[...items.filter(item=>!keys.includes(item.key)),...replacements.map((item,index)=>({...item,key:'replacement-'+index}))];window.__cartSnapshot=next;setItems(next)}}}`
      }));
    }}],
  });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    if (request.url === "/images/management/documents-kit-spotlight.webp") { response.setHeader("content-type", "image/webp"); return response.end(fs.readFileSync(path.join(root, "public/images/management/documents-kit-spotlight.webp"))); }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="margin:0;padding:12px;background:#141616;color:#eee;font:14px Arial"><div id="root"></div><script>window.__initialItems=${JSON.stringify(items.map(item => ({ ...item, start: "2030-02-01", end: "2030-02-03", days: 3, perDay: 40, total: 120, deposit: 0 })))};window.__fixtureQuery=(ref,args)=>{window.__queryArgs={ref,args};return ${JSON.stringify(initialData)}};window.__freshFixtureQuery=(ref,args)=>{window.__freshQueryArgs={ref,args};return ${JSON.stringify(freshData)}};</script><script src="/bundle.js"></script>`);
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-cart-replacement-browser-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    let port;
    for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "Temporary Chromium exposes a local inspection port");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect();
    await browser.cmd("Page.enable");
    await browser.cmd("Runtime.enable");
    for (const width of [390, 1280]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height: 860, deviceScaleFactor: 1, mobile: width < 600 });
      await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
      for (let attempt = 0; attempt < 100 && !await browser.evaluate("!!document.querySelector('button')"); attempt++) await wait(50);
      const before = await browser.evaluate(`(()=>{const panel=document.querySelector('section'),img=panel?.querySelector('img'),button=panel?.querySelector('button.btn-primary');return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,panel:panel?.getBoundingClientRect().toJSON(),image:{src:img?.getAttribute('src'),alt:img?.alt,loaded:img?.complete&&img?.naturalWidth>0},copy:panel?.innerText,button:button?.innerText,disabled:button?.disabled}})()`);
      assert(before.panel && before.scrollWidth <= width && before.panel.right <= width + 1, `Replacement cards fit ${width}px: ${JSON.stringify(before)}`);
      assert.equal(before.image.src, "/images/management/documents-kit-spotlight.webp", "The rendered alternative uses its listing photo");
      assert.equal(before.image.loaded, true, "The listing photo loads as a real image in the browser");
      assert(before.copy.includes(`£${Number(initialTotal).toFixed(2)}`), "The displayed card has the original query price before selection");
      assert.equal(before.button, "Switch to this");
      await browser.evaluate(`document.querySelector('button.btn-primary').click()`);
      for (let attempt = 0; attempt < 100 && !await browser.evaluate("window.__cartSnapshot?.some(item=>item.key==='replacement-0')"); attempt++) await wait(50);
      const after = await browser.evaluate(`(()=>({items:window.__cartSnapshot.map(({key,listingId,title,start,end,total})=>({key,listingId,title,start,end,total})),freshRef:window.__freshQueryArgs?.ref,tracked:window.__replacementTracked||0,copy:document.body.innerText}))()`);
      assert.equal(after.items.length, 2, "Switching one unavailable line does not discard or duplicate another basket line");
      assert(after.items.some(item => item.key === "retained-lens" && item.listingId === retainedLensId), "The unrelated lens remains in the basket");
      assert(after.items.some(item => item.listingId === alternativeId && item.total === freshTotal), "The selected alternative uses the latest re-quoted price");
      assert(!after.items.some(item => item.listingId === unavailableId), "The unavailable source is replaced, not left alongside the selected item");
      assert.equal(after.freshRef, "cartReplacements.sets", "The UI rechecks choices through the authoritative replacement query on click");
      assert.equal(after.tracked, 1, "The selected replacement records one demand event");
      fs.writeFileSync(`/tmp/dbc-cart-replacement-${width}.png`, Buffer.from((await browser.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    }
    console.log("PASS replacement UI browser: real stock-backed suggestion, actual listing photo, click-time stock/price recheck, and partial swap preserves unaffected basket lines at 390px and 1280px.");
  } finally {
    if (browser) browser.close();
    await new Promise(resolve => server.close(resolve));
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
