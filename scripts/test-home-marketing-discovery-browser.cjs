const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { load } = require("./lib/rentalTestHarness.cjs");
const root = path.resolve(__dirname, "..");
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const helper = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", helper.slice(0, helper.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);

async function main() {
  const homePage = fs.readFileSync(path.join(root, "src/app/page.tsx"), "utf8");
  const homeSearchComponent = fs.readFileSync(path.join(root, "src/components/HomeGearSearch.tsx"), "utf8");
  const proofTiles = homePage.indexOf("London, on the label");
  const gearSearchSection = homePage.indexOf('aria-label="Find and book rental gear"');
  const cameraDeconstruct = homePage.indexOf("<CameraDeconstruct />");
  assert(proofTiles >= 0 && proofTiles < gearSearchSection && gearSearchSection < cameraDeconstruct, "The landing search sits beneath the four proof tiles and before the camera story");
  assert(homeSearchComponent.includes('aria-label={featured ? "Search featured rental gear" : "Search rental gear"}'), "Homepage search labels distinguish featured gear from the general catalogue");
  assert(fs.readFileSync(path.join(root, "src/app/gear/GearCatalogueClient.tsx"), "utf8").includes('id="ai-item-assembly"'), "The AI kit-builder action has a real destination anchor");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-home-marketing-search-"));
  const categories = ["Cameras", "Lenses", "Lighting", "Audio", "Sound & DJ", "Drones"].map(name => ({ name, count: 3 }));
  const sourceListing = {
    _id: "fixture-red-komodo",
    slug: "red-komodo",
    title: "RED Komodo Cinema Camera",
    category: "Cameras",
    itemType: "camera-body",
    active: true,
    marketingOnly: true,
    marketingOnlySource: "admin",
    stockMappingStatus: "complete",
    components: [{ inventoryUnitId: "fixture-red-unit", qty: 1 }],
    r2Images: ["/images/home/maintained-cinema-gear-20261028.webp"],
    pricing: { daily: 100 },
  };
  const hiddenRedListing = {
    ...sourceListing,
    _id: "fixture-hidden-red-komodo",
    slug: "hidden-red-komodo",
    title: "RED Komodo hidden listing",
    suppressed: true,
    marketingOnly: false,
    marketingOnlySource: "admin",
  };
  const fx3Kit = {
    _id: "fixture-fx3-kit",
    slug: "2x-sony-fx3-24-70-tripods",
    title: "2x Sony FX3 Cameras, 24–70mm GM Lenses and Tripods",
    category: "Cameras",
    itemType: "camera-body",
    active: true,
    marketingOnly: false,
    marketingOnlySource: "admin",
    stockMappingStatus: "complete",
    components: [
      { inventoryUnitId: "fixture-sony-fx3", qty: 2 },
      { inventoryUnitId: "fixture-sony-gm-24-70", qty: 2 },
      { inventoryUnitId: "fixture-small-rig-tripod", qty: 2 },
    ],
    r2Images: ["/images/home/maintained-cinema-gear-20261028.webp"],
    pricing: { daily: 100 },
  };
  const a7vListing = {
    ...fx3Kit,
    _id: "fixture-sony-a7-v",
    slug: "sony-a7-v",
    title: "Sony A7 V Full-Frame Camera",
    components: [{ inventoryUnitId: "fixture-sony-a7-v", qty: 1 }],
  };
  const canonLensListing = {
    ...fx3Kit,
    _id: "fixture-canon-lens-set",
    slug: "canon-lens-set",
    title: "Canon 24–105mm and 16–35mm L-Series Lenses",
    category: "Lenses",
    itemType: "lens",
    components: [{ inventoryUnitId: "fixture-canon-lenses", qty: 1 }],
  };
  let fixtureListings = [sourceListing, hiddenRedListing, fx3Kit, a7vListing, canonLensListing];
  const searchDb = {
    query(table) {
      assert.equal(table, "listings");
      const query = {
        withSearchIndex(name, build) {
          assert.equal(name, "search_title");
          const filters = {};
          const builder = {
            search(field, value) { assert.equal(field, "title"); filters.search = value; return builder; },
            eq(field, value) { filters[field] = value; return builder; },
          };
          build(builder);
          return {
            async *[Symbol.asyncIterator]() {
              const terms = String(filters.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
              for (const listing of fixtureListings) {
                if (listing.active === filters.active && listing.category === filters.category && terms.some(term => listing.title.toLowerCase().includes(term))) yield listing;
              }
            },
          };
        },
        withIndex(name, build) {
          if (name === "by_active_itemType") return { take: async () => [] };
          assert(["by_category", "by_category_active_demand"].includes(name), `Unexpected catalogue index: ${name}`);
          const filters = {};
          const builder = { eq(field, value) { filters[field] = value; return builder; } };
          build(builder);
          const matching = fixtureListings.filter(listing => listing.category === filters.category && (filters.active === undefined || listing.active === filters.active));
          return {
            collect: async () => matching,
            order: () => ({ async *[Symbol.asyncIterator]() { for (const listing of matching) yield listing; } }),
          };
        },
      };
      return query;
    },
  };
  const gearSearchIntent = load("src/lib/gearSearchIntent.ts").gearSearchIntent;
  const intent = gearSearchIntent("RED cameras", categories);
  const searchHomeGear = load("convex/catalog.ts").searchHomeGear;
  const backendResult = await searchHomeGear.handler({ db: searchDb }, { search: intent.search, category: intent.categories[0] });
  assert.equal(backendResult.listings.length, 1, "The authoritative catalog search returns the active RED marketing listing");
  assert.equal(backendResult.listings[0].marketingOnly, true);
  assert.equal(backendResult.listings[0].bookable, false, "A completed stock mapping does not make a marketing-only item bookable");
  assert.deepEqual(backendResult.listings.map(listing => listing.slug), ["red-komodo"], "suppressed marketing-like rows stay hidden from homepage search");
  const catalogueListings = await load("convex/catalog.ts").listListings.handler(
    { db: searchDb }, { category: "Cameras", search: "RED", limit: 20 },
  );
  assert.deepEqual(catalogueListings.map(listing => listing.slug), ["red-komodo"], "catalogue search includes active marketing listings but excludes suppressed listings");
  const fx3Search = await searchHomeGear.handler({ db: searchDb }, { search: "2x Sony FX3 Cameras 24–70mm GM Lenses Tripods", category: "Cameras" });
  assert.equal(fx3Search.listings.length, 1, "the specifically reported multi-item Sony FX3 kit is discoverable when its canonical mapping is complete");
  assert.equal(fx3Search.listings[0].bookable, true, "the complete two-body/two-lens/two-tripod stock mapping is not classified as permanently unavailable");
  assert.deepEqual(fx3Search.listings[0].components.map(component => component.qty), [2, 2, 2], "the kit’s real component quantities remain explicit in the catalogue contract");
  const absentVenice = await searchHomeGear.handler({ db: searchDb }, { search: "Sony Venice", category: "Cameras" });
  assert.deepEqual(absentVenice.listings, [], "a product-specific Sony Venice query never falls back to unrelated Sony FX3 or A7 V items");
  const exactA7V = await searchHomeGear.handler({ db: searchDb }, { search: "Sony A7 V", category: "Cameras" });
  assert.deepEqual(exactA7V.listings.map(listing => listing.slug), ["sony-a7-v"], "model spacing normalization still finds the exact A7 V listing");
  const absentOrion = await searchHomeGear.handler({ db: searchDb }, { search: "Orion lenses", category: "Lenses" });
  assert.deepEqual(absentOrion.listings, [], "a product-specific Orion query never falls back to unrelated Canon lenses");
  const cameraCategory = await searchHomeGear.handler({ db: searchDb }, { search: "Cameras", category: "Cameras" });
  assert.deepEqual(cameraCategory.listings.map(listing => listing.slug), ["red-komodo", "2x-sony-fx3-24-70-tripods", "sony-a7-v"], "selecting a department returns its visible marketing and bookable listings for the homepage rail");
  fixtureListings = fixtureListings.filter(listing => listing._id !== sourceListing._id);
  const absentRed = await searchHomeGear.handler({ db: searchDb }, { search: "RED cameras", category: "Cameras" });
  assert.deepEqual(absentRed.listings, [], "a RED camera query shows no unrelated category bestsellers when no public RED listing exists");
  const redListing = backendResult.listings[0];
  const entry = path.join(dir, "fixture.tsx");
  fs.writeFileSync(entry, `import React from "react";import{createRoot}from"react-dom/client";import{HomeGearSearch}from${JSON.stringify(path.join(root, "src/components/HomeGearSearch.tsx"))};import{HomeCategoryGrid}from${JSON.stringify(path.join(root, "src/components/HomeCategoryGrid.tsx"))};const categories=${JSON.stringify(categories)};createRoot(document.getElementById("root")!).render(<><HomeGearSearch categories={categories}/><HomeCategoryGrid categories={categories}/></>);`);
  const modules = {
    "next/link": `import React from "react";export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
    "convex/react": `export function useQuery(){return null}export function useQueries(requests){window.__searchRequests.push(requests);const entry=Object.entries(requests)[0];if(!entry)return{};const[key,request]=entry;if(request.args.search==="Cameras"&&request.args.category==="Cameras")return{[key]:${JSON.stringify(cameraCategory)}};if(request.args.search!=="red"||request.args.category!=="Cameras")return{[key]:{mode:"empty",category:"Cameras",listings:[]}};return{[key]:${JSON.stringify(backendResult)}}}`,
    "@cvx/_generated/api": `export const api={catalog:{searchHomeGear:"catalog.searchHomeGear",getListingBySlug:"catalog.getListingBySlug"}}`,
    "@/components/SmartImage": `import React from "react";export function SmartImage({src,fallbackSources,alt,className}){return <img src={src??fallbackSources?.[0]??""} alt={alt} className={className} data-testid="listing-photo"/>}`,
    "@/components/icons": `import React from "react";const Icon=props=><span aria-hidden="true" {...props}/>;export const IconArrowRight=Icon,IconSearch=Icon,IconX=Icon`,
    "@/components/GearCard": `export function GearCard(){return null}`,
    "@/components/CategoryIcon": `export function CategoryIcon(){return null}`,
    "@/components/Reveal": `import React from "react";export function Reveal({children,className}){return <div className={className}>{children}</div>}`,
    "@/lib/homeGearSearchEvents": `export const HOME_GEAR_CATEGORY_EVENT="dbc:home-gear-category-select";export function selectHomeGearCategory(category){window.dispatchEvent(new CustomEvent(HOME_GEAR_CATEGORY_EVENT,{detail:{category}}))}`,
    "@/components/booking/BookingPanel": `export function BookingPanel(){return null}`,
    "@/lib/dateSelection": `export function pickRentalDates(){return{start:null,end:null}}`,
    "@/lib/pricing": `export function formatRate(value){return String(value)}export function quote(){return{perDay:0}}`,
    "./useCatalogRevisionRefresh": `export function useCatalogRevisionRefresh(){return{stale:false,refresh(){}}}`,
  };
  const plugin = {
    name: "home-marketing-search-fixture",
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => modules[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
      build.onResolve({ filter: /HomeGearSearch\.module\.css$/ }, () => ({ path: "styles", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
        loader: "jsx",
        resolveDir: root,
        contents: modules[args.path] ?? `export default new Proxy({}, {get:(_target,key)=>String(key)})`,
      }));
    },
  };
  await require("esbuild").build({ absWorkingDir: root, nodePaths: [path.join(root, "node_modules")], entryPoints: [entry], outfile: path.join(dir, "fixture.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), plugins: [plugin], define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
  const globalCss = await require("postcss")([require("@tailwindcss/postcss")({ base: root })]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const moduleCss = fs.readFileSync(path.join(root, "src/components/HomeGearSearch.module.css"), "utf8");
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); return response.end(fs.readFileSync(path.join(dir, "fixture.js"))); }
    if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); return response.end(`${globalCss.css}\n${moduleCss}\nbody{margin:0;background:#08080a;color:#fff}`); }
    if (request.url === redListing.heroImage) { response.setHeader("Content-Type", "image/webp"); return fs.createReadStream(path.join(root, "public", redListing.heroImage.slice(1))).pipe(response); }
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.__searchRequests=[]</script><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-home-marketing-chrome-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore", detached: true });
  let browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
      try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; }
      catch { await wait(100); }
    }
    assert(port, "Temporary Chromium starts for the synthetic storefront test");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect("about:blank");
    await browser.cmd("Page.enable");
    await browser.cmd("Runtime.enable");
    const screenshots = [];
    for (const [width, height] of [[320, 844], [390, 844], [1440, 900]]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
      await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
      for (let attempt = 0; attempt < 50 && !await browser.evaluate(`!!document.querySelector('input[type="search"]')`); attempt++) await wait(40);
      await wait(650);
      assert.equal(await browser.evaluate(`document.querySelector('input[type="search"]')?.getAttribute('aria-label')`), "Search rental gear", `The interactive search describes its visible section at ${width}px`);
      const idlePlaceholder = await browser.evaluate(`(()=>{const input=document.querySelector('input[type="search"]');const example=document.querySelector('[class*="examplePlaceholder"]');return{text:example?.textContent?.trim(),opacity:example&&getComputedStyle(example).opacity,placeholder:input?.placeholder}})()`);
      assert(idlePlaceholder.text && idlePlaceholder.opacity !== "0", `The empty search overlays a visible animated catalog example at ${width}px: ${JSON.stringify(idlePlaceholder)}`);
      assert.equal(idlePlaceholder.placeholder, "", `The animated example replaces—not duplicates—the input placeholder at ${width}px`);
      await browser.evaluate(`(()=>{const input=document.querySelector('input[type="search"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,' ');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      await wait(450);
      const typingWhitespace=await browser.evaluate(`(()=>{const example=document.querySelector('[class*="examplePlaceholder"]'),cursor=example.querySelector('span');return{opacity:getComputedStyle(example).opacity,text:example.textContent.trim(),cursor:getComputedStyle(cursor).animationPlayState}})()`);
      assert.equal(typingWhitespace.opacity,'0',`Typing a space hides the animated example at ${width}px`);
      assert.equal(typingWhitespace.text,'',`Typing a space stops the example text at ${width}px`);
      assert.equal(typingWhitespace.cursor,'paused',`Typing pauses the decorative cursor at ${width}px`);
      await browser.evaluate(`(()=>{const input=document.querySelector('input[type="search"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(550);
      await browser.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait(100);
      const reducedBefore=await browser.evaluate(`(()=>{const example=document.querySelector('[class*="examplePlaceholder"]');return{text:example.textContent.trim(),animation:getComputedStyle(example.querySelector('span')).animationName}})()`);
      await wait(700);
      assert.deepEqual(await browser.evaluate(`(()=>{const example=document.querySelector('[class*="examplePlaceholder"]');return{text:example.textContent.trim(),animation:getComputedStyle(example.querySelector('span')).animationName}})()`),reducedBefore,`Changing to reduced motion freezes the example at ${width}px`);
      assert.equal(reducedBefore.text,'Sony FX3 kits');assert.equal(reducedBefore.animation,'none');
      await browser.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await wait(500);
      const builder = await browser.evaluate(`document.querySelector('a[aria-label="Have AI assemble your kit"]')?.getAttribute('href')`);
      assert.equal(builder, "/gear#ai-item-assembly", `The AI kit-builder pill opens its real destination at ${width}px`);
      const builderBox=await browser.evaluate(`(()=>{const r=document.querySelector('a[aria-label="Have AI assemble your kit"]').getBoundingClientRect();return{width:r.width,height:r.height}})()`);
      assert(builderBox.width>=44&&builderBox.height>=44,`The AI builder target is easy to activate at ${width}px: ${JSON.stringify(builderBox)}`);
      const controls=await browser.evaluate(`(()=>{const input=document.querySelector('input[type="search"]'),link=document.querySelector('a[aria-label="Have AI assemble your kit"]'),label=link.querySelector('span'),a=input.getBoundingClientRect(),b=link.getBoundingClientRect();return{label:label.textContent,visible:getComputedStyle(label).display!=='none',inputWidth:a.width,overlap:Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
      assert(controls.visible&&controls.label==='Have AI assemble your kit'&&controls.inputWidth>=100&&!controls.overlap&&!controls.overflow,`The builder label and search remain visible and separate at ${width}px: ${JSON.stringify(controls)}`);
      const idleScreenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(`/tmp/dbc-home-search-idle-${width}.png`, Buffer.from(idleScreenshot.data, "base64"));
      await browser.evaluate(`document.querySelector('a[aria-label="Have AI assemble your kit"]').click()`);
      for(let attempt=0;attempt<80&&!await browser.evaluate(`location.pathname==='/gear'&&location.hash==='#ai-item-assembly'`);attempt++)await wait(40);
      assert.equal(await browser.evaluate(`location.pathname+location.hash`),'/gear#ai-item-assembly',`The AI builder control navigates on activation at ${width}px`);
      await browser.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
      for(let attempt=0;attempt<80&&!await browser.evaluate(`!!document.querySelector('nav[aria-label="Browse gear categories"] button')`);attempt++)await wait(40);
      await browser.evaluate(`document.querySelector('nav[aria-label="Browse gear categories"] button')?.click()`);
      for (let attempt = 0; attempt < 80 && !await browser.evaluate(`!!document.querySelector('button[aria-label="Choose rental times for 2x Sony FX3 Cameras, 24–70mm GM Lenses and Tripods"]')`); attempt++) await wait(40);
      const categoryBrowse = await browser.evaluate(`(()=>({path:location.pathname,input:document.querySelector('input[type="search"]')?.value,items:[...document.querySelectorAll('[aria-label="Gear search results"] > *')].map(node=>node.textContent.replace(/\\s+/g,' ').trim())}))()`);
      assert.equal(categoryBrowse.path, "/", `Choosing a category does not navigate away from the landing page at ${width}px`);
      assert.equal(categoryBrowse.input, "Cameras", `The selected department is shown in the homepage search at ${width}px`);
      assert.equal(await browser.evaluate(`document.querySelector('[class*="examplePlaceholder"]')?.className.includes('examplePlaceholderVisible')`), false, `Selecting a category immediately drops the prompt's visible state at ${width}px`);
      assert.equal(await browser.evaluate(`document.querySelector('nav[aria-label="Matching gear departments"] button')?.getAttribute('aria-pressed')`), "true", `The active category is exposed to assistive technology at ${width}px`);
      assert(categoryBrowse.items.some(text=>text.includes("2x Sony FX3 Cameras")), `The category expands into a matching inline rail at ${width}px: ${JSON.stringify(categoryBrowse)}`);
      assert(categoryBrowse.items.some(text=>text.includes("Display only")), `The category rail clearly labels marketing listings as display-only at ${width}px: ${JSON.stringify(categoryBrowse)}`);
      assert(!categoryBrowse.items.some(text=>text.includes("Available by request")), `The category rail does not imply a non-bookable marketing listing can be requested at ${width}px`);
      const categoryShot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(`/tmp/dbc-home-category-search-${width}.png`, Buffer.from(categoryShot.data, "base64"));
      if (width <= 390) {
        await browser.evaluate(`(()=>{const rail=document.querySelector('[aria-label="Gear search results carousel"]');rail.focus();rail.scrollLeft=0;rail.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))})()`);
        await wait(250);
        assert(await browser.evaluate(`document.querySelector('[aria-label="Gear search results carousel"]')?.scrollLeft > 0`), `The result carousel responds to arrow keys on mobile at ${width}px`);
      }
      await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
      for (let attempt = 0; attempt < 50 && !await browser.evaluate(`!!document.querySelector('[data-testid="home-category-select"]')`); attempt++) await wait(40);
      await browser.evaluate(`document.querySelector('[data-testid="home-category-select"][data-category="Cameras"]')?.click()`);
      for (let attempt = 0; attempt < 80 && !await browser.evaluate(`document.querySelector('input[type="search"]')?.value==="Cameras"&&document.querySelector('[aria-label="Gear search results carousel"]')?.textContent.includes('2x Sony FX3 Cameras')`); attempt++) await wait(40);
      const categoryCardBrowse = await browser.evaluate(`(()=>({path:location.pathname,input:document.querySelector('input[type="search"]')?.value,carousel:!!document.querySelector('[aria-label="Gear search results carousel"]'),listing:document.querySelector('[aria-label="Gear search results carousel"]')?.textContent.includes('2x Sony FX3 Cameras'),cardIsButton:document.querySelector('[data-testid="home-category-select"][data-category="Cameras"]')?.tagName==='BUTTON'}))()`);
      assert.equal(categoryCardBrowse.path, "/", `Choosing a lower department card does not navigate away at ${width}px`);
      assert.equal(categoryCardBrowse.input, "Cameras", `A lower department card selects the same inline search at ${width}px`);
      assert.equal(categoryCardBrowse.carousel, true, `A lower department card reveals the in-place results carousel at ${width}px`);
      assert.equal(categoryCardBrowse.listing, true, `The in-place department carousel contains real matching inventory at ${width}px: ${JSON.stringify(categoryCardBrowse)}`);
      assert.equal(categoryCardBrowse.cardIsButton, true, `A category selector is keyboard-activatable rather than a navigation link at ${width}px`);
      const lowerCategoryShot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(`/tmp/dbc-home-category-grid-${width}.png`, Buffer.from(lowerCategoryShot.data, "base64"));
      await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
      for (let attempt = 0; attempt < 50 && !await browser.evaluate(`!!document.querySelector('input[type="search"]')`); attempt++) await wait(40);
      await browser.evaluate(`(()=>{const input=document.querySelector('input[type="search"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'RED cameras');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      assert.equal(await browser.evaluate(`document.querySelector('[class*="examplePlaceholder"]')?.className.includes('examplePlaceholderVisible')`), false, `The animated prompt immediately drops its visible state when the renter types at ${width}px`);
      for (let attempt = 0; attempt < 80 && !await browser.evaluate(`!!document.querySelector('a[aria-label="View RED Komodo Cinema Camera"]')`); attempt++) await wait(40);
      for (let attempt = 0; attempt < 50 && !await browser.evaluate(`(()=>{const image=document.querySelector('a[aria-label="View RED Komodo Cinema Camera"] img');return image?.complete&&image.naturalWidth>0})()`); attempt++) await wait(40);
      const result = await browser.evaluate(`(()=>{const link=document.querySelector('a[aria-label="View RED Komodo Cinema Camera"]');const image=link?.querySelector('img');return{href:link?.getAttribute('href'),text:link?.textContent?.replace(/\\s+/g,' ').trim(),imageSrc:image?.getAttribute('src'),imageAlt:image?.getAttribute('alt'),imageLoaded:!!image?.complete&&image.naturalWidth>0,requests:window.__searchRequests.flatMap(group=>Object.values(group)).map(request=>request.args),bookingDialog:!!document.querySelector('dialog'),bookingButtons:[...document.querySelectorAll('button')].map(button=>button.getAttribute('aria-label')).filter(label=>label?.includes('RED Komodo'))}})()`);
      assert(result.requests.length > 0 && result.requests.every(request => request.search === "red" && request.category === "Cameras"), `The typed query routes only to RED camera results at ${width}px: ${JSON.stringify(result)}`);
      assert.equal(result.href, "/gear/red-komodo", `A marketing-only result opens its product details at ${width}px`);
      assert(result.text.includes("Display only"), `The result clearly states the marketing listing is display-only at ${width}px: ${result.text}`);
      assert.equal(result.imageSrc, redListing.heroImage, `The exact listing photo is used, not an icon or category illustration, at ${width}px`);
      assert.equal(result.imageAlt, redListing.title, `The photo has product-specific alternative text at ${width}px`);
      assert.equal(result.imageLoaded, true, `The listing photograph loads in the rendered result at ${width}px`);
      assert.equal(result.bookingDialog, false, `Marketing-only search results never open the booking dialog at ${width}px`);
      assert.deepEqual(result.bookingButtons, [], `Marketing-only search results expose no quick-book action at ${width}px`);
      const screenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const screenshotPath = `/tmp/dbc-home-marketing-search-${width}.png`;
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
      screenshots.push(screenshotPath);
      await browser.evaluate(`(()=>{const input=document.querySelector('input[type="search"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'R');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      await wait(400);
      assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Gear search results carousel"]')?.children.length`), 0, `A one-character query never displays results from the previous search at ${width}px`);
      assert.equal(await browser.evaluate(`!!document.querySelector('nav[aria-label="Matching gear departments"]')`), false, `A one-character query does not show stale departments at ${width}px`);
      await browser.evaluate(`(()=>{const input=document.querySelector('input[type="search"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Cameras');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      for (let attempt = 0; attempt < 80 && !await browser.evaluate(`!!document.querySelector('button[aria-label="Choose rental times for 2x Sony FX3 Cameras, 24–70mm GM Lenses and Tripods"]')`); attempt++) await wait(40);
      await browser.evaluate(`(()=>{const input=document.querySelector('input[type="search"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Orion');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Gear search results carousel"]')?.children.length`), 0, `Changing a query immediately hides old listings while the new search loads at ${width}px`);
    }
    await browser.cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 50 && !await browser.evaluate(`!!document.querySelector('input[type="search"]')`); attempt++) await wait(40);
    await wait(650);
    const reducedPrompt = await browser.evaluate(`(()=>{const input=document.querySelector('input[type="search"]'),example=document.querySelector('[class*="examplePlaceholder"]'),cursor=document.querySelector('[class*="exampleCursor"]');return{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,text:example?.textContent?.trim(),opacity:example&&getComputedStyle(example).opacity,cursorAnimation:cursor&&getComputedStyle(cursor).animationName,transitionDuration:example&&getComputedStyle(example).transitionDuration}})()`);
    assert.equal(reducedPrompt.reduced, true, "The reduced-motion browser preference reaches the search component");
    assert.equal(reducedPrompt.text, "Sony FX3 kits", `Reduced motion keeps the search example static: ${JSON.stringify(reducedPrompt)}`);
    assert.equal(reducedPrompt.cursorAnimation, "none", `Reduced motion disables the cursor blink: ${JSON.stringify(reducedPrompt)}`);
    assert(reducedPrompt.opacity !== "0" && Number.parseFloat(reducedPrompt.transitionDuration) <= 0.001, `Reduced motion leaves the prompt readable without a perceptible fade: ${JSON.stringify(reducedPrompt)}`);
    await browser.evaluate(`(()=>{const input=document.querySelector('input[type="search"]'),setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Sony Venice');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await wait(500);
    const reducedTypedPrompt = await browser.evaluate(`(()=>{const input=document.querySelector('input[type="search"]'),example=document.querySelector('[class*="examplePlaceholder"]');return{value:input?.value,opacity:example&&getComputedStyle(example).opacity}})()`);
    assert.equal(reducedTypedPrompt.value, "Sony Venice", `The typed query survives prompt cleanup under reduced motion: ${JSON.stringify(reducedTypedPrompt)}`);
    assert.equal(reducedTypedPrompt.opacity, "0", `Typing clears the static prompt under reduced motion: ${JSON.stringify(reducedTypedPrompt)}`);
    console.log(`PASS homepage search and catalog discovery at 320px, 390px and 1440px: inline category carousel, accessible category state, loaded listing image, request-only state and details link. Idle screenshots: ${screenshots.join(", ")}; category screenshots: /tmp/dbc-home-category-search-320.png, /tmp/dbc-home-category-search-390.png, /tmp/dbc-home-category-search-1440.png`);
  } finally {
    browser?.close();
    if (chrome.exitCode === null) {
      try { process.kill(-chrome.pid, "SIGTERM"); } catch { chrome.kill("SIGTERM"); }
      await Promise.race([new Promise(resolve => chrome.once("exit", resolve)), wait(2000)]);
    }
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
