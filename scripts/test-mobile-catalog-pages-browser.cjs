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
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const aliases = new Map([
  ["next/link", `import React from "react"; export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`],
  ["next/navigation", `export function useRouter(){return {push(){}}}`],
  ["@/components/gaffer/GafferFocus", `export function useGafferFocus(){return {focusedId:window.location.pathname==="/card"?"synthetic-arri-alexa-mini-lf":null,suggestedIds:[]}}`],
  ["@/components/account/AccountProvider", `export function useAccount(){return {me:null,toggleFavorite(){}}}`],
  ["@/components/SiteHeader", `export function SiteHeader(){return <header className="flex h-14 items-center border-b border-white/10 bg-black px-4 text-sm text-white">DB CINEMA</header>}`],
  ["@/components/booking/BookingPanel", `export function BookingPanel({listing}){return <section data-testid="fixture-booking-panel" className="spot gradient-border rounded-2xl p-4 sm:p-6"><p className="hud-label text-accent-300">Your rental</p><h2 className="mt-2 font-display text-xl font-semibold text-white">Choose dates</h2><p className="mt-2 text-sm text-white/55">{listing.title}</p><div className="mt-5 grid grid-cols-2 gap-2"><button className="glass min-h-11 rounded-xl">Start date</button><button className="glass min-h-11 rounded-xl">End date</button></div><button className="btn-primary mt-4 min-h-11 w-full">Add to your kit</button></section>}`],
  ["@/components/booking/RentalContentsList", `export function RentalContentsList(){return null}`],
  ["@/components/Recommendations", `export function Recommendations(){return null}`],
  ["@/components/booking/Calendar", `export function addDaysIso(value){const date=new Date(value+"T00:00:00Z");date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10)} export function daysInclusive(start,end){return start&&end?Math.floor((Date.parse(end)-Date.parse(start))/86400000)+1:0}`],
  ["@/lib/dateSelection", `export function pickRentalDates(start,end,iso){return !start||end?{start:iso,end:null}:{start,end:iso}}`],
  ["@/lib/session", `export function getSessionId(){return "synthetic-catalog-visual-audit"}`],
  ["@/lib/pricing", `export function money(value){return Number(value).toFixed(2)}`],
  ["@/lib/pageMetadata", `export function publicPageMetadata(){return {}}`],
  ["@/lib/site", `export const HOURS_WINDOWS=[{opens:"10:00",closes:"13:00"},{opens:"16:00",closes:"20:00"}]`],
  ["convex/react", `export function useQuery(reference){const key=String(reference);return key==="catalog.getListingBySlug"?window.__listing:key==="reviews.stats"?{average:"4.9",count:128}:undefined} export function useMutation(){return async()=>null}`],
  ["@cvx/_generated/api", `export const api=new Proxy({}, {get:(_,namespace)=>new Proxy({}, {get:(_,name)=>String(namespace)+"."+String(name)})})`],
]);

const plugin = {
  name: "synthetic-mobile-catalog-page-fixture",
  setup(build) {
    for (const [specifier, contents] of aliases) {
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      build.onResolve({ filter: new RegExp("^" + escaped + "$") }, () => ({ path: specifier, namespace: "catalog-fixture" }));
      build.onLoad({ filter: /.*/, namespace: "catalog-fixture" }, args => ({ loader: "jsx", resolveDir: root, contents: aliases.get(args.path) }));
    }
  },
};

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-mobile-catalog-pages-"));
  const result = await esbuild.build({
    entryPoints: [path.join(root, "scripts/fixtures/mobile-catalog-pages.tsx")],
    outfile: path.join(temp, "bundle.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"), plugins: [plugin], define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const js = fs.readFileSync(path.join(temp, "bundle.js"), "utf8");
  assert(js.length > 10_000, "Actual GearCard, GearDetailClient and HowItWorksPage bundle in the local fixture");
  const css = await require("postcss")([require("@tailwindcss/postcss")({ base: root })]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const assets = new Map([
    ["/arri-deconstruct-poster.jpg", ["image/jpeg", path.join(root, "public/arri-deconstruct-poster.jpg")]],
    ["/images/home/maintained-cinema-gear-20261028.webp", ["image/webp", path.join(root, "public/images/home/maintained-cinema-gear-20261028.webp")]],
  ]);
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(js); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    const asset = assets.get(request.url);
    if (asset) { response.setHeader("content-type", asset[0]); return fs.createReadStream(asset[1]).pipe(response); }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#08090a;color:#eee}</style></head><body><div id="root"></div><script>window.__listing=${JSON.stringify({
      _id: "synthetic-arri-alexa-mini-lf", slug: "arri-alexa-mini-lf", title: "ARRI Alexa Mini LF cinema camera with production accessories", category: "Cameras", itemType: "camera", isPackage: false, heroImage: "/arri-deconstruct-poster.jpg", imageSources: ["/images/home/maintained-cinema-gear-20261028.webp"], gallery: ["/arri-deconstruct-poster.jpg", "/images/home/maintained-cinema-gear-20261028.webp"], description: "Professional cinema camera for hire in London.", pricing: { daily: 240, day3: 210, day7: 180 }, depositAmount: 100, minimumRentalDays: 1, quietDeal: null, displayOnly: false, bookable: true, unavailableDates: [], demandScore: 65, knowledge: { features: ["Large-format 4.5K sensor", "Production-ready camera body"], bestFor: ["narrative", "commercial"], tips: ["Bring compatible media and power."], limits: [] },
    })}</script><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-mobile-catalog-pages-chrome-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100 && !port; attempt++) { try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { await wait(100); } }
    assert(port, "Isolated local Chromium starts for this synthetic fixture");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect("about:blank"); await browser.cmd("Page.enable"); await browser.cmd("Runtime.enable");
    browser.on(event => { if (event.method === "Runtime.exceptionThrown" || event.method === "Log.entryAdded") console.error("BROWSER", JSON.stringify(event.params).slice(0, 900)); });
    const out = "/tmp/dbc-mobile-catalog-pages"; fs.mkdirSync(out, { recursive: true });
    for (const pathname of ["/card", "/detail", "/how-it-works"]) {
      for (const width of [320, 390, 430, 768, 1440]) {
        const mobile = width < 768;
        await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: mobile ? 3 : 1, mobile });
        await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}${pathname}` });
        for (let attempt = 0; attempt < 80 && !await browser.evaluate(`document.querySelector("main")?.children.length>0`); attempt++) await wait(50);
        for (let attempt = 0; attempt < 30 && !await browser.evaluate(`(() => [...document.querySelectorAll("img")].length>0 && [...document.querySelectorAll("img")].every(image=>image.complete&&image.naturalWidth>0))()`); attempt++) await wait(50);
        if (pathname === "/detail") await wait(900);
        const metrics = await browser.evaluate(`(()=>{const main=document.querySelector("main"),images=[...document.querySelectorAll("img")],textNodes=[...document.querySelectorAll("h1,h2,p,button")],card=document.querySelector(".gear-card"),link=card?.querySelector("a"),booking=document.querySelector("[data-testid='fixture-booking-panel']"),picture=images.find(img=>img.alt.includes("ARRI Alexa")),title=document.querySelector("h1"),steps=[...document.querySelectorAll("h2")].filter(h=>/^Browse|^Pick your dates|^Book & pay securely|^Pickup or delivery/.test(h.textContent));const r=e=>{const x=e?.getBoundingClientRect();return x&&{left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height}};return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,main:r(main),card:r(card),cardImage:r(picture),cardImageLoaded:!!picture&&picture.complete&&picture.naturalWidth>0,cardImageSrc:picture?.currentSrc,cardTitle:r(card?.querySelector("h3")),cardPrice:r(card?.querySelector(".text-accent-400")),favorite:r(card?.querySelector("button[aria-label='Add favourite']")),nestedButtons:link?.querySelectorAll("button").length??0,chooseDates:link?.textContent?.includes("Choose dates")??false,gafferBadge:r(card?.querySelector(".gaffer-pick-badge")),detailTitle:r(title),booking:r(booking),steps:steps.map(r),textOutside:[...textNodes].filter(e=>{const b=e.getBoundingClientRect();return getComputedStyle(e).display!=="none"&&(b.left < -1||b.right > innerWidth+1)}).map(e=>e.textContent.trim().slice(0,48))}})()`);
        console.log(`AUDIT ${pathname} ${width}px ${JSON.stringify(metrics)}`);
        assert(metrics.scrollWidth <= width, `${pathname} stays inside ${width}px: ${JSON.stringify(metrics)}`);
        assert.deepEqual(metrics.textOutside, [], `${pathname} has no clipped or overflowing text at ${width}px: ${JSON.stringify(metrics.textOutside)}`);
        if (pathname === "/card") {
          assert(metrics.cardImageLoaded, `The real listing photo loads on the GearCard at ${width}px`);
          assert(metrics.favorite.width >= 44 && metrics.favorite.height >= 44, `The favourite control meets a 44px touch target at ${width}px: ${JSON.stringify(metrics.favorite)}`);
          assert(metrics.cardTitle.left >= metrics.card.left && metrics.cardTitle.right <= metrics.card.right, `Long listing title stays in its card at ${width}px`);
          assert(metrics.cardPrice.left >= metrics.card.left && metrics.cardPrice.right <= metrics.card.right, `Listing price stays in its card at ${width}px`);
          assert.equal(metrics.nestedButtons, 0, `The listing link contains no nested action buttons at ${width}px`);
          assert.equal(metrics.chooseDates, true, `The listing link clearly invites renters to choose dates at ${width}px`);
          if (width < 768) assert(metrics.gafferBadge.right < metrics.favorite.left, `Gaffer label does not cover the favourite control at ${width}px`);
        }
        if (pathname === "/detail") {
          assert(metrics.cardImageLoaded, `The real listing photo loads on the detail page at ${width}px`);
          assert(metrics.detailTitle.width > 0, `Product detail title is visible at ${width}px`);
          assert(metrics.booking.width > 0, `Date booking controls render at ${width}px`);
          if (width < 1024) {
            assert(await browser.evaluate(`!!document.querySelector('[data-testid="mobile-booking-jump-bar"]')`), `The date shortcut stays reachable below desktop width at ${width}px`);
            for (let attempt = 0; attempt < 20 && !await browser.evaluate(`document.body.dataset.mobileBookingDock==='true'`); attempt++) await wait(25);
            const dock = await browser.evaluate(`(()=>{const bar=document.querySelector('[data-testid="mobile-booking-jump-bar"]'),launcher=document.querySelector('[data-testid="fixture-gaffer-launcher"]'),trigger=document.querySelector('[data-testid="mobile-gaffer-trigger"]'),panel=document.querySelector('[data-testid="fixture-gaffer-panel"]'),box=e=>{const r=e?.getBoundingClientRect();return r&&{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return{marker:document.body.dataset.mobileBookingDock==='true',width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bar:box(bar),launcher:box(launcher),launcherDisplay:getComputedStyle(launcher).display,trigger:box(trigger),panel:box(panel)}})()`);
            assert(dock.marker && dock.bar && dock.launcher && dock.trigger, `The product page activates the inline Gaffer entry point at ${width}px: ${JSON.stringify(dock)}`);
            assert.equal(dock.launcherDisplay, "none", `The floating Gaffer button is suppressed while the product dock is visible at ${width}px: ${JSON.stringify(dock)}`);
            assert(dock.trigger.height >= 44 && dock.trigger.left >= 0 && dock.trigger.right <= width, `Inline Gaffer remains an accessible touch target at ${width}px: ${JSON.stringify(dock)}`);
            await browser.evaluate(`window.__gafferDockTriggered=false;window.addEventListener('dbc:open-gaffer-chat',()=>{window.__gafferDockTriggered=true;const panel=document.querySelector('[data-testid="fixture-gaffer-panel"]');panel.hidden=false;panel.style.display='flex'},{once:true});document.querySelector('[data-testid="mobile-gaffer-trigger"]').click()`);
            assert.equal(await browser.evaluate(`window.__gafferDockTriggered`), true, `The inline Gaffer button opens the shared chat entry point at ${width}px`);
            const openDock = await browser.evaluate(`(()=>{const bar=document.querySelector('[data-testid="mobile-booking-jump-bar"]'),panel=document.querySelector('[data-testid="fixture-gaffer-panel"]'),input=document.querySelector('[data-testid="fixture-gaffer-input"]'),send=document.querySelector('[data-testid="fixture-gaffer-send"]'),b=bar.getBoundingClientRect(),p=panel.getBoundingClientRect(),i=input.getBoundingClientRect(),s=send.getBoundingClientRect();return{panel:{left:p.left,right:p.right,top:p.top,bottom:p.bottom,height:p.height},input:{left:i.left,right:i.right,top:i.top,bottom:i.bottom,width:i.width,height:i.height},send:{left:s.left,right:s.right,top:s.top,bottom:s.bottom,width:s.width,height:s.height},bar:{left:b.left,right:b.right,top:b.top,bottom:b.bottom},scrollWidth:document.documentElement.scrollWidth}})()`);
            assert(openDock.panel.bottom <= openDock.bar.top + 1 && openDock.panel.left >= -1 && openDock.panel.right <= width + 1 && openDock.scrollWidth <= width, `The open Gaffer popup clears the sticky booking bar and stays inside ${width}px: ${JSON.stringify(openDock)}`);
            assert(openDock.panel.height <= Math.min(0.52 * 844, 420) + 2, `The open Gaffer popup remains compact at ${width}px: ${JSON.stringify(openDock)}`);
            assert(openDock.input.width >= 120 && openDock.input.height >= 38 && openDock.input.bottom <= openDock.bar.top, `Gaffer message field stays comfortably usable above the booking CTA at ${width}px: ${JSON.stringify(openDock)}`);
            assert(openDock.send.width >= 40 && openDock.send.height >= 40 && openDock.send.bottom <= openDock.bar.top, `Gaffer send control stays usable above the booking CTA at ${width}px: ${JSON.stringify(openDock)}`);
            console.log(`GAFFER DOCK ${width}px ${JSON.stringify(openDock)}`);
            const dockShot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            fs.writeFileSync(path.join(out, `detail-${width}-gaffer-dock-pass-1.png`), Buffer.from(dockShot.data, "base64"));
            await browser.evaluate(`(()=>{const panel=document.querySelector('[data-testid="fixture-gaffer-panel"]');panel.hidden=true;panel.style.display='none'})()`);
            if (width < 768) {
              const initial = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
              fs.writeFileSync(path.join(out, `detail-${width}-initial-photo.png`), Buffer.from(initial.data, "base64"));
              assert(await browser.evaluate(`document.querySelectorAll('[aria-label="Next product photo"]').length===1`), `Touch photo navigation appears on phones at ${width}px`);
              await browser.evaluate(`document.querySelector('[aria-label="Next product photo"]').click()`);
              for (let attempt = 0; attempt < 30 && !await browser.evaluate(`(() => {const image=[...document.querySelectorAll("img")].find(item=>item.alt.includes("ARRI Alexa"));return image&&image.complete&&image.naturalWidth>0})()`); attempt++) await wait(50);
              assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Photo 2 of 2"]').getAttribute('aria-pressed')`), "true", `Photo selection advances and synchronizes its thumbnail at ${width}px`);
              for (let pass = 1; pass <= 4; pass++) {
                await wait(350);
                const galleryState = await browser.evaluate(`(() => {const buttons=[...document.querySelectorAll('[aria-label^="Photo "]')];return buttons.map(button=>({pressed:button.getAttribute('aria-pressed')==='true',visualSelected:button.classList.contains('ring-2')&&button.classList.contains('ring-accent-400'),opacity:Number(getComputedStyle(button).opacity)}));})()`);
                assert.equal(galleryState.filter(button=>button.pressed).length, 1, `Exactly one thumbnail is selected at ${width}px, visual pass ${pass}: ${JSON.stringify(galleryState)}`);
                assert.deepEqual(galleryState.map(button=>button.visualSelected), galleryState.map(button=>button.pressed), `The visible orange thumbnail ring matches the selected photo at ${width}px, visual pass ${pass}: ${JSON.stringify(galleryState)}`);
                assert(galleryState.find(button=>button.pressed).opacity >= .99, `Selected thumbnail reaches full opacity at ${width}px, visual pass ${pass}: ${JSON.stringify(galleryState)}`);
                const stateScreenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
                fs.writeFileSync(path.join(out, `detail-${width}-gallery-pass-${pass}.png`), Buffer.from(stateScreenshot.data, "base64"));
                const next = pass % 2 === 1;
                await browser.evaluate(`document.querySelector('[aria-label="${next ? "Previous" : "Next"} product photo"]').click()`);
              }
              await wait(350);
              const finalGalleryState = await browser.evaluate(`(() => {const buttons=[...document.querySelectorAll('[aria-label^="Photo "]')];return buttons.map(button=>({pressed:button.getAttribute('aria-pressed')==='true',visualSelected:button.classList.contains('ring-2')&&button.classList.contains('ring-accent-400')}));})()`);
              assert.deepEqual(finalGalleryState.map(button=>button.visualSelected), finalGalleryState.map(button=>button.pressed), `The final gallery thumbnail style agrees with its accessible state at ${width}px: ${JSON.stringify(finalGalleryState)}`);
              const galleryBox = await browser.evaluate(`(()=>{const r=document.querySelector('[data-testid="product-photo-gallery"]').getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
              const touch = (type, x, y) => browser.cmd("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
              const midY = (galleryBox.top + galleryBox.bottom) / 2;
              await touch("touchStart", galleryBox.right - 45, midY);
              await touch("touchMove", galleryBox.left + 35, midY + 2);
              await touch("touchEnd", 0, 0);
              await wait(80);
              assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Photo 1 of 2"]').getAttribute('aria-pressed')`), "true", `A left swipe advances the photo at ${width}px`);
              await touch("touchStart", galleryBox.left + 35, midY);
              await touch("touchMove", galleryBox.right - 45, midY + 1);
              await touch("touchEnd", 0, 0);
              await wait(80);
              assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Photo 2 of 2"]').getAttribute('aria-pressed')`), "true", `A right swipe returns to the previous photo at ${width}px`);
              await touch("touchStart", (galleryBox.left + galleryBox.right) / 2, midY - 25);
              await touch("touchMove", (galleryBox.left + galleryBox.right) / 2 + 2, midY + 35);
              await touch("touchEnd", 0, 0);
              await wait(80);
              assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Photo 2 of 2"]').getAttribute('aria-pressed')`), "true", `A vertical scroll gesture leaves the selected photo unchanged at ${width}px`);
              assert(await browser.evaluate(`document.querySelector('[data-testid="mobile-booking-jump"]').getBoundingClientRect().height>=44`), `The booking shortcut is a comfortable touch target at ${width}px`);
              if (width === 320 || width === 390) {
                const bookingAction = await browser.evaluate(`(()=>{const button=document.querySelector('[data-testid="mobile-booking-jump"]'),r=button.getBoundingClientRect();return{label:button.innerText.trim(),height:r.height,width:r.width,whiteSpace:getComputedStyle(button).whiteSpace,scrollWidth:button.scrollWidth,clientWidth:button.clientWidth}})()`);
                assert.equal(bookingAction.whiteSpace, "nowrap", `The product booking action stays on one line at ${width}px: ${JSON.stringify(bookingAction)}`);
                assert(bookingAction.height >= 44 && bookingAction.width <= width, `The one-line booking action retains its touch target at ${width}px: ${JSON.stringify(bookingAction)}`);
              }
            }
          }
        }
        if (pathname === "/how-it-works") {
          assert.equal(metrics.steps.length, 4, `The mobile how-it-works page keeps all four steps at ${width}px`);
          assert(metrics.steps.every(box => box.left >= 0 && box.right <= width), `Every how-it-works step fits at ${width}px`);
          assert(await browser.evaluate(`document.body.innerText.includes("Waterstones bookstore at Trafalgar Square")`), `The pickup instructions name the actual Trafalgar Square meeting point at ${width}px`);
        }
        const screenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(out, `${pathname.slice(1)}-${width}.png`), Buffer.from(screenshot.data, "base64"));
        console.log(`${pathname} ${width}px ${JSON.stringify({ scrollWidth: metrics.scrollWidth, cardImageLoaded: metrics.cardImageLoaded, card: metrics.card, booking: metrics.booking, steps: metrics.steps.length })}`);
      }
    }
    for (const width of [320, 390]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
      await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/detail?start=2027-11-06&end=2027-11-07` });
      await wait(900);
      const selectedDateAction = await browser.evaluate(`(()=>{const button=document.querySelector('[data-testid="mobile-booking-jump"]'),r=button.getBoundingClientRect();return{label:button.innerText.trim(),height:r.height,width:r.width,whiteSpace:getComputedStyle(button).whiteSpace,left:r.left,right:r.right}})()`);
      assert.equal(selectedDateAction.label, width === 320 ? "Review & add" : "Review price & add", `Date-selected action uses the appropriate short mobile label at ${width}px: ${JSON.stringify(selectedDateAction)}`);
      assert.equal(selectedDateAction.whiteSpace, "nowrap", `Selected-date action stays on one line at ${width}px: ${JSON.stringify(selectedDateAction)}`);
      assert(selectedDateAction.height >= 44 && selectedDateAction.left >= 0 && selectedDateAction.right <= width, `Selected-date action remains a usable in-bounds target at ${width}px: ${JSON.stringify(selectedDateAction)}`);
      const selectedScreenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(out, `detail-${width}-selected-dates.png`), Buffer.from(selectedScreenshot.data, "base64"));
    }
    console.log(`PASS GearCard, product details, and how-it-works across phone/tablet/desktop viewports. Screenshots: ${out}`);
  } finally {
    if (browser) { browser.close(); await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(() => {}); }
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
