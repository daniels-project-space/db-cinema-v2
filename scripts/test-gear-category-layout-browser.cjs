const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const membershipSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", membershipSource.slice(0, membershipSource.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const categories = ["Cameras", "Lenses", "Lighting", "Audio", "Packages"];
const listings = [{
  _id: "fixture-arri",
  slug: "arri-alexa-mini-lf",
  title: "ARRI Alexa Mini LF cinema camera",
  category: "Cameras",
  heroImage: "/arri-deconstruct-poster.jpg",
  pricing: { daily: 240 },
}];

const aliases = new Map([
  ["@/components/gaffer/GafferFocus", `export function useGafferFocus(){return {suggestedIds:[]}}`],
  ["@/components/icons", `export function IconSearch({className=''}){return <span className={className} aria-hidden="true">⌕</span>}`],
  ["@/components/AssemblyShowcase", `export function AssemblyShowcase(){return null}`],
  ["@/components/GearLoopBanner", `export function GearLoopBanner({sub}){return <section className="relative h-24 overflow-hidden border-b border-white/10 px-5 py-3"><p className="text-xs uppercase tracking-widest text-amber-300">The catalogue</p><p className="text-sm text-white/60">{sub}</p></section>}`],
  ["@/components/GearCard", `export function GearCard({listing}){return <article className="spot min-w-0 overflow-hidden rounded-2xl"><img src={listing.heroImage} alt={listing.title} className="aspect-[16/10] w-full object-contain bg-black"/><div className="p-3"><h3 className="break-words text-sm text-white">{listing.title}</h3><p className="mt-2 text-accent-300">£{listing.pricing.daily}/day</p></div></article>}`],
  ["@/components/HireProfessionals", `export function HireProfessionals(){return null}`],
  ["@/components/SiteHeader", `export function SiteHeader(){return <header className="flex h-14 items-center border-b border-white/10 bg-black px-4 text-sm text-white">DB CINEMA <span className="ml-4 text-white/55">Gear · How it works</span></header>}`],
  ["@/components/Reveal", `export function Reveal({children}){return <>{children}</>}`],
  ["@/lib/session", `export function getSessionId(){return 'synthetic-mobile-session'}`],
]);

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-gear-categories-"));
  const plugin = {
    name: "synthetic-gear-category-browser",
    setup(build) {
      for (const [specifier, contents] of aliases) {
        build.onResolve({ filter: new RegExp("^" + specifier.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + "$" ) }, () => ({ path: specifier, namespace: "mobile-fixture" }));
        build.onLoad({ filter: new RegExp("^" + specifier.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + "$" ), namespace: "mobile-fixture" }, () => ({ loader: "jsx", resolveDir: root, contents }));
      }
      build.onResolve({ filter: /^convex\/react$/ }, () => ({ path: "convex-react", namespace: "mobile-fixture" }));
      build.onLoad({ filter: /^convex-react$/, namespace: "mobile-fixture" }, () => ({ loader: "js", contents: `export function useQuery(ref){return window.__query(ref)};export function useMutation(){return async()=>null}` }));
      build.onResolve({ filter: /^@cvx\/_generated\/api$/ }, () => ({ path: "generated-api", namespace: "mobile-fixture" }));
      build.onLoad({ filter: /^generated-api$/, namespace: "mobile-fixture" }, () => ({ loader: "js", contents: `export const api=new Proxy({}, {get:(_,namespace)=>new Proxy({}, {get:(_,name)=>String(namespace)+'.'+String(name)})})` }));
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "mobile-fixture" }));
      build.onLoad({ filter: /^navigation$/, namespace: "mobile-fixture" }, () => ({ loader: "js", contents: `export function useSearchParams(){return new URLSearchParams(window.location.search)};export function useRouter(){return {replace(){}}}` }));
    },
  };

  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import GearPage from './src/app/gear/GearCatalogueClient';createRoot(document.getElementById('root')).render(<GearPage/>);`, resolveDir: root, loader: "tsx" },
    bundle: true, write: false, outdir: path.join(temp, "bundle"), platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"), plugins: [plugin], define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  assert(js, "The actual gear catalogue client bundles with synthetic data");
  const css = await require("postcss")([require("@tailwindcss/postcss")({ base: root })]).process(
    fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"),
    { from: path.join(root, "src/app/globals.css") },
  );
  const server = http.createServer((req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("content-type", "text/javascript"); return res.end(js); }
    if (req.url === "/style.css") { res.setHeader("content-type", "text/css"); return res.end(css.css); }
    if (req.url === "/arri-deconstruct-poster.jpg") { const bytes = fs.readFileSync(path.join(root, "public/arri-deconstruct-poster.jpg")); res.setHeader("content-type", "image/jpeg"); return res.end(bytes); }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#08090a;color:#eee}</style></head><body><div id="root"></div><script>window.__query=ref=>ref==='catalog.categories'?${JSON.stringify(categories.map(name => ({ name, count: name === "Packages" ? 3 : 4 })))}:ref==='catalog.bestSellers'?${JSON.stringify(listings)}:ref==='catalog.listListings'?${JSON.stringify(listings)}:[]</script><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-gear-categories-chrome-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100 && !port; attempt++) { try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { await wait(100); } }
    assert(port, "Isolated local Chromium starts for the fixture");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect();
    await browser.cmd("Page.enable"); await browser.cmd("Runtime.enable");
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
    for (let attempt = 0; attempt < 100 && !await browser.evaluate(`!!document.querySelector('[aria-label="Gear categories"] button')`); attempt++) await wait(50);
    const out = "/tmp/dbc-mobile-catalogue-responsive"; fs.mkdirSync(out, { recursive: true });
    for (const width of [320, 390, 430, 768]) {
      const mobile = width < 768;
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: mobile ? 3 : 1, mobile });
      await wait(100);
      const metrics = await browser.evaluate(`(()=>{const group=document.querySelector('[aria-label="Gear categories"]'),g=group.getBoundingClientRect(),buttons=[...group.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return{text:b.textContent.trim().replace(/\\s+/g,' '),left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,pressed:b.getAttribute('aria-pressed')}}),grid=document.querySelector('main > div.order-4 .dim-grid.mt-4'),gridRect=grid?.getBoundingClientRect(),card=grid?.firstElementChild?.getBoundingClientRect(),image=grid?.querySelector('img'),filters=document.querySelector('[aria-controls="gear-refinements"]'),panel=document.querySelector('#gear-refinements'),search=document.querySelector('input[placeholder="Search gear…"]');return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,group:{left:g.left,right:g.right,width:g.width,scrollWidth:group.scrollWidth,clientWidth:group.clientWidth,scroll:getComputedStyle(group).overflowX},resultGrid:{columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,gridWidth:gridRect?.width,cardWidth:card?.width,imageLoaded:!!image&&image.complete&&image.naturalWidth>0,imageAlt:image?.alt},filters:{expanded:filters?.getAttribute('aria-expanded'),display:getComputedStyle(panel).display,left:filters?.getBoundingClientRect().left,right:filters?.getBoundingClientRect().right,searchRight:search?.getBoundingClientRect().right},bestSellersVisible:!!document.querySelector('section.order-3')?.getBoundingClientRect().height,buttons}})()`);
      assert.equal(metrics.scrollWidth <= width, true, `Catalogue page stays within ${width}px: ${JSON.stringify(metrics)}`);
      assert(metrics.buttons.length === categories.length + 1, `All ${categories.length + 1} category filters render at ${width}px`);
      assert.equal(metrics.resultGrid.columns, 1, `A single match gets one uncluttered result column at ${width}px: ${JSON.stringify(metrics.resultGrid)}`);
      assert(metrics.resultGrid.cardWidth >= metrics.resultGrid.gridWidth * 0.95, `A single matching listing fills its available browsing width rather than leaving an empty grid column: ${JSON.stringify(metrics.resultGrid)}`);
      assert.equal(metrics.bestSellersVisible, false, `Best sellers do not push the tablet catalogue results away from the filters: ${width}px`);
      assert(metrics.buttons.every(button => button.height >= 43), `Category buttons remain comfortably tappable at ${width}px`);
      assert(metrics.resultGrid.imageLoaded, `The actual listing photo loads at ${width}px: ${JSON.stringify(metrics.resultGrid)}`);
      if (width < 640) {
        assert.equal(metrics.group.scroll, "auto", `Phone category pills use a horizontal scroll rail: ${JSON.stringify(metrics.group)}`);
        assert(metrics.group.scrollWidth > metrics.group.clientWidth, `Phone category rail keeps all categories reachable without adding a second row: ${JSON.stringify(metrics.group)}`);
        assert(metrics.buttons[0].left >= metrics.group.left - 1 && metrics.buttons[0].right <= metrics.group.right + 1, `The first category is visible at the rail start`);
        assert.equal(metrics.filters.expanded, "false", `Secondary filters start collapsed on phone widths`);
        assert.equal(metrics.filters.display, "none", `Collapsed mobile filters do not consume vertical space`);
        assert(metrics.filters.left >= metrics.filters.searchRight + 1 && metrics.filters.right <= width, `The filter button sits beside search without overlap or viewport clipping: ${JSON.stringify(metrics.filters)}`);
      } else {
        assert(metrics.buttons.every(button => button.left >= metrics.group.left - 1 && button.right <= metrics.group.right + 1), `Every category label remains visible at ${width}px: ${JSON.stringify(metrics)}`);
        assert.notEqual(metrics.filters.display, "none", `Tablet and desktop refinements stay visible without another tap`);
      }
      if (width === 320) {
        await browser.evaluate(`(()=>{const rail=document.querySelector('[aria-label="Gear categories"]');rail.scrollTo({left:rail.scrollWidth,behavior:'instant'})})()`);
        await wait(100);
        const lastCategory = await browser.evaluate(`(()=>{const rail=document.querySelector('[aria-label="Gear categories"]'),buttons=rail.querySelectorAll('button'),button=buttons[buttons.length-1],r=button.getBoundingClientRect(),g=rail.getBoundingClientRect();return{left:r.left,right:r.right,railLeft:g.left,railRight:g.right,scrollLeft:rail.scrollLeft}})()`);
        assert(lastCategory.left >= lastCategory.railLeft - 1 && lastCategory.right <= lastCategory.railRight + 1, `The last phone category can scroll fully into view: ${JSON.stringify(lastCategory)}`);
        await browser.evaluate(`document.querySelector('[aria-label="Gear categories"]').scrollTo({left:0,behavior:'instant'})`);
        await wait(100);
      }
      if (width === 320) {
        await browser.evaluate(`document.querySelector('[aria-controls="gear-refinements"]').click()`);
        assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('#gear-refinements')).display`), "grid", "Phone refinements expand when selected");
        assert.equal(await browser.evaluate(`document.querySelector('[aria-controls="gear-refinements"]').getAttribute('aria-expanded')`), "true", "The mobile filter disclosure exposes its state accessibly");
        const expanded = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(out, "catalogue-320-filters-expanded.png"), Buffer.from(expanded.data, "base64"));
        await browser.evaluate(`document.querySelector('[aria-controls="gear-refinements"]').click()`);
        await browser.evaluate(`([...document.querySelectorAll('[aria-label="Gear categories"] button')].find(item=>item.textContent.includes('Lenses'))).click()`);
        for (let attempt = 0; attempt < 30 && !await browser.evaluate(`([...document.querySelectorAll('[aria-label="Gear categories"] button')].find(item=>item.textContent.includes('Lenses'))?.getAttribute('aria-pressed')==='true')`); attempt++) await wait(50);
        const selected = await browser.evaluate(`([...document.querySelectorAll('[aria-label="Gear categories"] button')].find(item=>item.textContent.includes('Lenses'))?.getAttribute('aria-pressed'))`);
        assert.equal(selected, "true", "A category filter remains operable on a phone");
        await browser.evaluate(`([...document.querySelectorAll('[aria-label="Gear categories"] button')].find(item=>item.textContent.trim().startsWith('All'))).click()`);
        assert.equal(await browser.evaluate(`([...document.querySelectorAll('[aria-label="Gear categories"] button')].find(item=>item.textContent.trim().startsWith('All'))?.getAttribute('aria-pressed'))`), "true", "Reset the synthetic fixture to All before capturing the catalogue state");
      }
      const screenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(out, `catalogue-${width}.png`), Buffer.from(screenshot.data, "base64"));
      console.log(`CATALOGUE ${width}px ${JSON.stringify({ scrollWidth: metrics.scrollWidth, railWidth: metrics.group.width, resultGrid: metrics.resultGrid, filters: metrics.filters, rows: new Set(metrics.buttons.map(button => button.top)).size, allVisible: metrics.buttons.every(button => button.left >= metrics.group.left - 1 && button.right <= metrics.group.right + 1) })}`);
    }
    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
    for (let attempt = 0; attempt < 100 && !await browser.evaluate(`!!document.querySelector('#gear-toolbar')`); attempt++) await wait(50);
    await browser.evaluate(`document.querySelector('#gear-toolbar').scrollIntoView({block:'start'})`);
    await wait(500);
    const actualCategoryView = await browser.evaluate(`(()=>({scrollWidth:document.documentElement.scrollWidth,categoryIcons:[...document.querySelectorAll('[aria-label="Gear categories"] svg')].length,categoryLabels:[...document.querySelectorAll('[aria-label="Gear categories"] button')].map(button=>button.getAttribute('aria-label')),listingPhoto:[...document.querySelectorAll('img')].some(image=>image.alt==='ARRI Alexa Mini LF cinema camera'&&image.complete&&image.naturalWidth>0)}))()`);
    assert.equal(actualCategoryView.scrollWidth, 390, "The scrolled category view has no horizontal overflow");
    assert(actualCategoryView.categoryIcons >= 4, `Actual animated category glyphs render alongside text labels: ${JSON.stringify(actualCategoryView)}`);
    assert(actualCategoryView.categoryLabels.every(label=>label&&label.includes(",")), `All category buttons keep their accessible text labels: ${JSON.stringify(actualCategoryView.categoryLabels)}`);
    assert(actualCategoryView.listingPhoto, "A real listing image remains visible beside the category controls after scrolling");
    const scrolledScreenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(out, "catalogue-390-scrolled-to-categories.png"), Buffer.from(scrolledScreenshot.data, "base64"));
    console.log(`PASS responsive category filters, no clipped buttons, real category glyphs and listing image, and screenshots: ${out}`);
  } finally {
    if (browser) { browser.close(); await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(() => {}); }
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
