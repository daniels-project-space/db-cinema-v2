const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");
const harness = require("./lib/rentalTestHarness.cjs");

harness.setMock("./rateLimit", { bump: async () => ({ allowed: true }) });
harness.setMock("./lib/rentalChat", { accountForToken: async () => null, postRentalMessage: async () => "message" });
harness.setMock("./adminAuth", { assertAdmin: async () => {} });

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const connectSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", connectSource.slice(0, connectSource.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);

(async () => {
  const root = path.resolve(__dirname, "..");
  const { db, put, putFreshSharedStock, load } = harness;
  putFreshSharedStock();
  const source = put("listings", {
    title: "RED cinema camera request",
    slug: "red-cinema-camera-request",
    category: "Cameras",
    itemType: "camera-body",
    active: true,
    stockMappingStatus: "incomplete",
    components: [],
    pricing: { daily: 120 },
    depositAmount: 500,
  });
  const unit = put("inventory_units", { name: "Cinema camera", active: true, quantityOwned: 1 });
  const candidate = put("listings", {
    title: "Cinema camera kit",
    slug: "cinema-camera-kit",
    category: "Cameras",
    itemType: "camera-body",
    active: true,
    stockMappingStatus: "complete",
    components: [{ inventoryUnitId: unit._id, qty: 1 }],
    pricing: { daily: 40 },
    depositAmount: 50,
    r2Images: ["/images/home/maintained-cinema-gear-20261028.webp"],
  });
  const start = Date.UTC(2030, 1, 1), end = Date.UTC(2030, 1, 3);
  const args = { items: [{ key: `detail-${source._id}`, listingId: source._id, start, end, qty: 1 }], sourceKey: `detail-${source._id}`, limit: 3 };
  const replacementQuery = load("convex/cartReplacements.ts").sets;
  const result = await replacementQuery.handler({ db }, args);
  assert.equal(result.status, "ready");
  assert.equal(result.options.length, 1, "a nonbookable source can discover a compatible, stock-backed alternative");
  assert.equal(result.options[0].items[0].listingId, candidate._id);
  assert.equal(result.options[0].items[0].heroImage, "/images/home/maintained-cinema-gear-20261028.webp", "recommendations use the actual listing photo");
  const quotedTotal = result.options[0].items[0].total;
  assert.equal(quotedTotal, load("convex/lib/pricing.ts").quote(candidate.pricing, 3).total, "the alternative carries the authoritative multi-day quote");

  const checkout = load("convex/checkoutCartData.ts");
  const shareKey = value => value.repeat(43).slice(0, 43);
  await assert.rejects(checkout.create.handler({ db }, { email: "renter@example.test", shareKey: shareKey("a"), lines: [{ listingId: source._id }] }), /no longer available to rent/);
  await checkout.create.handler({ db }, { email: "renter@example.test", shareKey: shareKey("b"), lines: [{ listingId: candidate._id }] });
  assert.equal((harness.tables.get("checkout_carts") ?? []).length, 1, "the source stays blocked while the real alternative can enter ordinary checkout validation");

  const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{GearDetailAlternatives}from'./src/components/booking/GearDetailAlternatives';function Fixture(){const[start,setStart]=useState(null),[end,setEnd]=useState(null),[month,setMonth]=useState(new Date(2030,1,1));const pick=date=>{if(!start||(end&&start!==end)){setStart(date);setEnd(date)}else{setStart(date<start?date:start);setEnd(date<start?start:date)}};return <main style={{maxWidth:720,margin:'0 auto',padding:12}}><GearDetailAlternatives listing={window.__source} start={start} end={end} month={month} onPick={pick} onMonthChange={setMonth}/></main>}createRoot(document.getElementById('root')).render(<Fixture/>);`;
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    plugins: [{ name: "gear-detail-alternatives-fixture", setup(build) {
      const aliases = new Map([
        ["convex/react", `const client=window.__fixtureConvex||(window.__fixtureConvex={query:async(ref,args)=>{window.__queryArgs=args;const index=window.__replacementQueryIndex++;const value=window.__replacementResponses[Math.min(index,window.__replacementResponses.length-1)];if(window.__delayNextResponse){window.__delayNextResponse=false;return new Promise(resolve=>window.__releaseQuery=()=>resolve(value))}return value}});export const useConvex=()=>client`],
        ["@cvx/_generated/api", `const path=a=>new Proxy({}, {get:(_,b)=>a+'.'+String(b)});export const api=new Proxy({}, {get:(_,a)=>path(String(a))})`],
        ["@/components/SmartImage", `import React from'react';export function SmartImage({src,alt,...props}){return <img src={src} alt={alt} {...props}/>} `],
        ["@/components/cart/CartProvider", `import React,{useState}from'react';export function useCart(){const[items,setItems]=useState(window.__initialCart);window.__cartItems=items;window.__externalCartUpdate=next=>setItems(()=>{window.__cartItems=next;return next});return{items,add:item=>setItems(current=>{const next=[...current,{...item,key:'alternative-'+current.length}];window.__cartItems=next;return next})}}`],
        ["@/lib/dates", `export const dayMs=value=>Date.parse(value+'T00:00:00Z');export const iso=(y,m,d)=>y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');export const addDaysIso=(start,n)=>start;export const daysInclusive=(start,end)=>Math.max(1,Math.round((dayMs(end)-dayMs(start))/86400000)+1)`],
        ["@/lib/pricing", `export const formatGbp=value=>'£'+Number(value).toFixed(2)`],
        ["@/lib/dateSelection", `export function crossesUnavailableDate(){return false}`],
        ["@/components/icons", `import React from'react';export const IconChevronLeft=()=> <span>‹</span>;export const IconChevronRight=()=> <span>›</span>`],
      ]);
      for (const [specifier, contents] of aliases) {
        const escaped = specifier.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
        build.onResolve({ filter: new RegExp("^" + escaped + "$") }, () => ({ path: specifier, namespace: "gear-detail-fixture" }));
        build.onLoad({ filter: /.*/, namespace: "gear-detail-fixture" }, args => ({ loader: "tsx", resolveDir: root, contents: aliases.get(args.path) }));
      }
    }}],
  });
  const css = await postcss([require("@tailwindcss/postcss")({ base: root })]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://fixture.local").pathname;
    if (pathname === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (pathname === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    if (pathname === "/images/home/maintained-cinema-gear-20261028.webp") { response.setHeader("content-type", "image/webp"); return response.end(fs.readFileSync(path.join(root, "public/images/home/maintained-cinema-gear-20261028.webp"))); }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#101112;color:white;font:14px Arial}</style><body><div id="root"></div><script>window.__source=${JSON.stringify({ _id: String(source._id), title: source.title, bookable: false })};window.__initialCart=[];window.__replacementQueryIndex=0;const ready=${JSON.stringify(result)},empty={status:'ready',requested:1,options:[],singles:[],searchLimited:false};window.__replacementResponses=location.search==='?empty'?[empty,empty,empty]:location.search==='?race'?[ready,ready,ready,ready,ready]:[ready,ready,{status:'refresh_required'},ready,ready];</script><script src="/bundle.js"></script></body>`);
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-gear-detail-alternatives-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    let port;
    for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "Chromium exposes a local inspection port");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect();
    await browser.cmd("Page.enable");
    await browser.cmd("Runtime.enable");
    browser.on(event => { if (event.method === "Runtime.exceptionThrown") console.error("BROWSER", JSON.stringify(event.params)); });
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
      for (let attempt = 0; attempt < 100 && !await browser.evaluate("!!document.querySelector('[data-testid=gear-detail-alternatives]')"); attempt++) await wait(40);
      const pickDay = async day => {
        await browser.evaluate(`(()=>{const button=[...document.querySelectorAll('[data-testid=calendar-day]')].find(node=>node.textContent.trim()==='${day}');button?.click()})()`);
        await wait(60);
      };
      await pickDay(1);
      await pickDay(3);
      for (let attempt = 0; attempt < 100 && !await browser.evaluate("!!document.querySelector('[data-testid=alternative-option]')"); attempt++) await wait(40);
      const before = await browser.evaluate(`(()=>{const panel=document.querySelector('[data-testid=gear-detail-alternatives]'),card=panel?.querySelector('[data-testid=alternative-option]'),img=card?.querySelector('img'),button=card?.querySelector('button'),r=panel?.getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,panel:r&&{left:r.left,right:r.right,width:r.width},copy:panel?.innerText,body:document.body.innerText,image:{src:img?.getAttribute('src'),alt:img?.alt,loaded:img?.complete&&img?.naturalWidth>0},button:button?.innerText,buttonHeight:button?.getBoundingClientRect().height}})()`);
      assert(before.panel && before.scrollWidth <= width && before.panel.left >= -1 && before.panel.right <= width + 1, `Alternative panel fits ${width}px: ${JSON.stringify(before)}`);
      assert.equal(before.image.src, "/images/home/maintained-cinema-gear-20261028.webp");
      assert.equal(before.image.loaded, true, "the real listing photo loads");
      assert(before.copy.includes(`£${quotedTotal.toFixed(2)}`), "the quote displays the live authoritative three-day total");
      assert(before.copy.includes("Exact pickup and return times are chosen at checkout."), "the alternative date picker does not ask for times");
      assert(before.buttonHeight >= 44, "the add control meets touch target height");
      assert.equal(await browser.evaluate("!!document.querySelector('[role=group][aria-label=\\\"Select rental dates\\\"]')"), true, "date controls are announced as a named group");
      assert.equal(await browser.evaluate("(()=>{const button=document.querySelector('[data-testid=calendar-day]');button?.focus();return document.activeElement===button})()"), true, "calendar date cells accept keyboard focus");
      const shot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(`/tmp/dbc-gear-detail-alternatives-${width}.png`, Buffer.from(shot.data, "base64"));
      await browser.evaluate("document.querySelector('[data-testid=add-available-alternative]').click()");
      for (let attempt = 0; attempt < 100 && !await browser.evaluate("document.body.innerText.includes('Live stock is refreshing.')"); attempt++) await wait(40);
      assert.equal(await browser.evaluate("window.__cartItems?.length ?? 0"), 0, "a shared-stock refresh does not add a stale quote");
      assert.match(await browser.evaluate("document.body.innerText"), /Live stock is refreshing/);
      await browser.evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Check again'))?.click()");
      for (let attempt = 0; attempt < 100 && !await browser.evaluate("!!document.querySelector('[data-testid=add-available-alternative]')"); attempt++) await wait(40);
      await browser.evaluate("document.querySelector('[data-testid=add-available-alternative]').click()");
      for (let attempt = 0; attempt < 100 && !await browser.evaluate("window.__cartItems?.length"); attempt++) await wait(40);
      const after = await browser.evaluate(`(()=>({items:window.__cartItems,added:document.querySelector('[data-testid=alternative-added]')?.innerText,requested:window.__queryArgs?.items?.at(-1)}))()`);
      assert.equal(after.items.length, 1, "the selected listing is added once");
      assert.equal(after.items[0].listingId, String(candidate._id));
      assert.equal(after.items[0].start, "2030-02-01");
      assert.equal(after.items[0].end, "2030-02-03");
      assert.equal(after.items[0].pickupTime, undefined, "exact time is left to checkout");
      assert.match(after.added, /added to your kit/);
      assert.equal(after.requested.listingId, String(source._id), "the original request is queried for alternatives, never added");
      assert(await browser.evaluate("window.__replacementQueryIndex") >= 5, "date changes, retry, click, and post-add basket updates all use the replacement API");
    }
    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 768, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?empty` });
    for (let attempt = 0; attempt < 100 && !await browser.evaluate("!!document.querySelector('[data-testid=gear-detail-alternatives]')"); attempt++) await wait(40);
    const selectDates = async () => {
      await browser.evaluate("[...document.querySelectorAll('[data-testid=calendar-day]')].find(node=>node.textContent.trim()==='1')?.click()");
      await wait(50);
      await browser.evaluate("[...document.querySelectorAll('[data-testid=calendar-day]')].find(node=>node.textContent.trim()==='3')?.click()");
    };
    await selectDates();
    for (let attempt = 0; attempt < 100 && !await browser.evaluate("document.body.innerText.includes('No compatible alternatives are available')"); attempt++) await wait(40);
    const emptyState = await browser.evaluate("({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(button=>button.innerText),width:innerWidth,scrollWidth:document.documentElement.scrollWidth})");
    assert.match(emptyState.text, /No compatible alternatives are available/);
    assert(!emptyState.buttons.some(text => /Add alternative|Add one|Add this available set/.test(text)), "empty results never expose an add button");
    assert(emptyState.scrollWidth <= emptyState.width, "empty state fits its viewport");
    const emptyShot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbc-gear-detail-alternatives-empty-768.png", Buffer.from(emptyShot.data, "base64"));

    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?race` });
    for (let attempt = 0; attempt < 100 && !await browser.evaluate("!!document.querySelector('[data-testid=gear-detail-alternatives]')"); attempt++) await wait(40);
    await selectDates();
    for (let attempt = 0; attempt < 100 && !await browser.evaluate("!!document.querySelector('[data-testid=add-available-alternative]')"); attempt++) await wait(40);
    await browser.evaluate("window.__delayNextResponse=true;document.querySelector('[data-testid=add-available-alternative]').click()");
    for (let attempt = 0; attempt < 100 && !await browser.evaluate("typeof window.__releaseQuery==='function'"); attempt++) await wait(20);
    assert.equal(await browser.evaluate("typeof window.__releaseQuery"), "function", "the click is waiting on a fresh authoritative response");
    await browser.evaluate("window.__externalCartUpdate([{key:'external-change',listingId:'other-listing',start:'2030-02-01',end:'2030-02-03'}]);requestAnimationFrame(()=>requestAnimationFrame(()=>window.__releaseQuery()))");
    for (let attempt = 0; attempt < 100 && !await browser.evaluate("document.body.innerText.includes('Your kit changed')"); attempt++) await wait(40);
    const race = await browser.evaluate("({items:window.__cartItems,copy:document.body.innerText})");
    assert.equal(race.items.length, 1, "a concurrent basket update prevents adding a stale alternative");
    assert.equal(race.items[0].listingId, "other-listing");
    assert.match(race.copy, /Your kit changed/);
    console.log("PASS gear detail alternatives: nonbookable source remains rejected at checkout; live stock-backed listing photo/quote is shown; chosen replacement enters the ordinary cart with selected dates and no times at 390px and 1440px.");
  } finally {
    if (browser) browser.close();
    await new Promise(resolve => server.close(resolve));
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
