const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const esbuild = require("esbuild");
const sharp = require("sharp");
const { spawn } = require("node:child_process");

const membershipSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", membershipSource.slice(0, membershipSource.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, "..");
const items = [
  { key: "synthetic-camera", listingId: "12345678901234567890123456789012", slug: "sony-fx3-camera", title: "Sony FX3 cinema camera", heroImage: "/fixtures/listings/missing-camera.webp", imageSources: ["/fixtures/listings/sony-fx3.webp"], start: "2030-11-06", end: "2030-11-07", days: 2, perDay: 100, total: 200, deposit: 50 },
  { key: "synthetic-lens", listingId: "23456789012345678901234567890123", slug: "sony-24-70-lens", title: "Sony 24–70mm f/2.8 G Master lens", heroImage: "/fixtures/listings/sony-24-70.webp", imageSources: ["/fixtures/listings/sony-24-70.webp"], start: "2030-11-06", end: "2030-11-07", days: 2, perDay: 35, total: 70, deposit: 0 },
];
const modules = {
  "@/components/icons": `export const IconX=()=> <span aria-hidden="true">×</span>;export const IconArrowRight=()=> <span aria-hidden="true">→</span>;export const IconLock=()=> <span aria-hidden="true">▣</span>;`,
  "@/components/SiteHeader": `export function SiteHeader(){return <header className="border-b border-white/10 bg-black px-4 py-3 text-sm">DB CINEMA <span className="ml-2 text-white/45">/ Basket</span></header>}`,
  "@/components/GearLoopBanner": `export function GearLoopBanner({lead,accent,sub}){return <section className="mx-auto max-w-5xl px-4 py-6"><p className="text-xs uppercase tracking-widest text-amber-300">Your kit</p><h1 className="font-display text-3xl">{lead} <span className="text-amber-300">{accent}</span></h1><p className="mt-2 text-sm text-white/55">{sub}</p></section>}`,
  "@/components/cart/CheckoutStatus": `export function useCheckoutStatus(){return{enabled:true,loading:false}};export function CheckoutPauseNotice(){return null}`,
  "@/components/cart/ReplacementSets": `export function ReplacementSets(){return null}`,
  "@/components/cart/useCartStockCheck": `export function useCartStockCheck(items){const availability=Object.fromEntries(items.map(i=>[i.listingId,{ok:true,available:1,demanded:1}]));return{ready:true,checking:false,error:null,needsTimes:items.some(i=>!i.pickupTime||!i.returnTime),missingTimeItems:items.filter(i=>!i.pickupTime||!i.returnTime),invalidTimeOrder:false,availability,unavailableItems:[],recheck:async()=>({availability})}}`,
  "@/components/cart/CartStockNotice": `export function CartStockNotice({needsTimes}){return <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200">{needsTimes?"Exact times are chosen at checkout":"Availability checked"}</div>}`,
  "@/components/plans/CartPlanning": `export function CartPlanning(){return null}`,
  "@/components/cart/KitCompatibility": `export function KitCompatibility(){return null}`,
  "@/components/cart/usePromo": `export function usePromo(){return{draft:"",setDraft(){},applied:null,error:null,apply:async()=>{},clear(){}}}`,
  "@/components/Recommendations": `export function Recommendations(){return null}`,
  "@/components/CheckoutMembership": `export function CheckoutMembership(){return <div className="rounded-xl border border-white/10 bg-white/[.02] p-3 text-xs text-white/55">Membership pricing is checked at checkout.</div>}`,
  "@/components/cart/useBasketPrice": `export function useBasketPrice(){const lines=window.__cartLines||${JSON.stringify(items)};return{loading:false,quote:{items:lines,combinedTotalDue:lines.reduce((sum,item)=>sum+item.total,0),depositAmount:0,totalReduction:0,creditApplied:0,earnedCreditApplied:0,refundCreditApplied:0,membershipCreditApplied:0,quotedDeliveryFee:0},recommendations:[]}}`,
  "@/lib/pricing": `export function formatGbp(value){return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(value)||0)}`,
  "@/components/cart/CartProvider": `import React from 'react';let lines=${JSON.stringify(items)};window.__cartLines=lines;let listeners=new Set();const notify=()=>{window.__cartLines=lines;listeners.forEach(fn=>fn())};export function useCart(){React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>lines,()=>lines);const subtotal=lines.reduce((sum,i)=>sum+i.total,0);return{items:lines,subtotal,eligibleSubtotal:subtotal,membership:null,setMembership(){},remove(key){lines=lines.filter(i=>i.key!==key);notify()},duplicateItem(key){const i=lines.find(x=>x.key===key);if(i){lines=[...lines,{...i,key:i.key+'-copy'}];notify()}},clear(){lines=[];notify()},updateDates(key,start,end,total,pickupTime,returnTime){lines=lines.map(i=>i.key===key?{...i,start,end,total,pickupTime,returnTime}:i);notify()}}}`,
  "@/lib/dates": `export function dayMs(value){return Date.parse(value+'T00:00:00.000Z')}`,
  "../../../shared/rentalDuration": `export function rentalPricingDays(){return 2}`,
  "@/components/cart/CheckoutCode": `export function CheckoutCode(){return null}`,
  "@/components/cart/CancellationProtection": `export function CancellationProtection(){return null}`,
  "@/components/account/AccountProvider": `export function useAccount(){return{token:null,me:null,loading:false}}`,
  "@/components/account/useFreshVerification": `export function useFreshVerification(){return false}`,
  "@/components/checkout/NextAvailableRentalOptions": `export function NextAvailableRentalOptions(){return null}`,
  "@/lib/checkoutDraft": `export function browserCheckoutStorage(){return{getItem(){return null},setItem(){},removeItem(){}}};export function readCheckoutDraft(){return null};export function saveCheckoutDraft(){}`,
  "@/lib/legal": `export const AGREEMENTS=[];export function agreementsForSecurityPolicy(){return[]}`,
  "../../../shared/rentalAgreement": `export const DELIVERY_TERMS_VERSION='fixture';export const DELIVERY_ACCEPTANCE_TEXT='fixture'`,
  "../../../shared/rentalSecurity": `export const ASSESSMENT_SECURITY_POLICY_VERSION='assessment';export const SECURITY_POLICY_VERSION='setup-intent-v1';export const REFUNDABLE_DEPOSIT_POLICY_VERSION='deposit';export function hasCashDepositPolicy(){return false};export function isCardHoldSecurityPolicy(){return false};export function isSetupIntentSecurityPolicy(){return true};export function isImmediateClaimSecurityPolicy(){return true};export function savedCardChargeLimit(){return 50};export function setupIntentSecurityLimit(){return 50}`,
  "../../../shared/membershipSelection": `export function accountPricingContext(){return{}};export function shouldResetMembershipPreference(){return false};export function membershipOfferContext(){return'fixture'};export function membershipRecommendationPreview(){return[]}`,
  "@/lib/session": `export function getSessionId(){return'synthetic-session'}`,
  "next/link": `export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
  "next/navigation": `export function useRouter(){return{push(path){window.__route=path}}}`,
};

(async () => {
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import CartPage from './src/app/cart/page';createRoot(document.getElementById('root')).render(<CartPage/>);`;
  const plugin = { name: "cart-fixtures", setup(build) {
    build.onResolve({ filter: /^@\/components\/SmartImage$/ }, () => ({ path: path.join(root, "src/components/SmartImage.tsx") }));
    build.onResolve({ filter: /^\.\/CartProvider$/ }, () => ({ path: "@/components/cart/CartProvider", namespace: "fixture" }));
    build.onResolve({ filter: /^convex\/react$/ }, () => ({ path: "convex-react", namespace: "fixture" }));
    build.onLoad({ filter: /^convex-react$/, namespace: "fixture" }, () => ({ loader: "js", contents: `export const useQuery=(ref,args)=>window.__query(ref,args);export const useAction=ref=>window.__action(ref);export const useMutation=ref=>window.__action(ref);export const useConvex=()=>({query:async(ref,args)=>window.__query(ref,args)});` }));
    build.onResolve({ filter: /^@cvx\/_generated\/api$/ }, () => ({ path: "generated-api", namespace: "fixture" }));
    build.onLoad({ filter: /^generated-api$/, namespace: "fixture" }, () => ({ loader: "js", contents: `export const api=new Proxy({}, {get:(_,namespace)=>new Proxy({}, {get:(_,name)=>String(namespace)+'.'+String(name)})});` }));
    for (const [specifier, contents] of Object.entries(modules)) {
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      build.onResolve({ filter: new RegExp("^" + escaped + "$") }, () => ({ path: specifier, namespace: "fixture" }));
      build.onLoad({ filter: new RegExp("^" + escaped + "$"), namespace: "fixture" }, () => ({ loader: "jsx", resolveDir: root, contents }));
    }
  } };
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, write: false, outdir: "/fixture", platform: "browser", format: "iife", jsx: "automatic", plugins: [plugin] });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"));
  const cssModule = bundle.outputFiles.find(file => file.path.endsWith(".css"));
  const css = await require("postcss")([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const cameraPhoto = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><defs><linearGradient id="bg" y2="1"><stop stop-color="#41423f"/><stop offset=".62" stop-color="#252729"/><stop offset="1" stop-color="#17191a"/></linearGradient><radialGradient id="lamp"><stop stop-color="#e5b87f" stop-opacity=".8"/><stop offset="1" stop-color="#e5b87f" stop-opacity="0"/></radialGradient><linearGradient id="body" x2="0" y2="1"><stop stop-color="#35393b"/><stop offset=".45" stop-color="#1d2022"/><stop offset="1" stop-color="#0c0e10"/></linearGradient><linearGradient id="glass" x2="1" y2="1"><stop stop-color="#243239"/><stop offset=".42" stop-color="#14191d"/><stop offset=".72" stop-color="#627078"/><stop offset="1" stop-color="#151a1d"/></linearGradient></defs><rect width="960" height="640" fill="url(#bg)"/><circle cx="800" cy="120" r="170" fill="url(#lamp)"/><circle cx="105" cy="190" r="95" fill="#c89965" opacity=".09"/><path d="M0 480Q280 420 510 470T960 438V640H0Z" fill="#17191a"/><ellipse cx="490" cy="500" rx="320" ry="58" fill="#08090a" opacity=".82"/><rect x="250" y="244" width="465" height="236" rx="29" fill="#090b0d" opacity=".7"/><path d="M276 251Q276 218 315 218h114l33 36H312v220h-36z" fill="#272b2d" stroke="#515355" stroke-width="4"/><rect x="313" y="264" width="398" height="201" rx="20" fill="url(#body)" stroke="#55585a" stroke-width="5"/><path d="M347 264v-45q0-14 17-14h91q12 0 17 13l14 46" fill="#1d2022" stroke="#575a5b" stroke-width="5"/><rect x="493" y="229" width="110" height="30" rx="8" fill="#242729" stroke="#55585a" stroke-width="4"/><rect x="346" y="294" width="72" height="55" rx="8" fill="#141719" stroke="#67696a" stroke-width="4"/><rect x="357" y="303" width="48" height="34" rx="3" fill="#52636a"/><path d="M362 329l15-18 25 21" fill="none" stroke="#a6a89d" stroke-width="3" opacity=".6"/><rect x="606" y="290" width="71" height="17" rx="8" fill="#101214"/><circle cx="638" cy="328" r="6" fill="#b84531"/><circle cx="670" cy="329" r="6" fill="#c6a06f"/><circle cx="366" cy="378" r="10" fill="#121516" stroke="#85827a" stroke-width="3"/><circle cx="400" cy="379" r="7" fill="#121516" stroke="#777671" stroke-width="3"/><path d="M704 319h36q19 0 19 20v86q0 29-30 29h-25z" fill="#24282a" stroke="#5d5e5c" stroke-width="5"/><path d="M737 328h60q27 0 37 21l57 74q20 26 8 52l-14 29H741z" fill="#121517" stroke="#56585a" stroke-width="6"/><ellipse cx="864" cy="405" rx="54" ry="92" fill="#20282c" stroke="#b98d5d" stroke-width="8"/><ellipse cx="875" cy="405" rx="35" ry="72" fill="url(#glass)" stroke="#292d2f" stroke-width="8"/><ellipse cx="881" cy="405" rx="20" ry="52" fill="#1a272e" opacity=".85"/><path d="M858 350q28 11 34 48" fill="none" stroke="#c2d1cf" stroke-opacity=".5" stroke-width="7"/><path d="M284 451h402" stroke="#9b754f" stroke-opacity=".34" stroke-width="3"/><text x="346" y="447" fill="#b7b3a9" font-family="Arial,sans-serif" font-size="13" letter-spacing="4">CINEMA CAMERA</text><path d="M182 541h600" stroke="#d0aa7a" stroke-opacity=".12" stroke-width="2"/></svg>`)).webp({ quality: 88 }).toBuffer();
  const lensPhoto = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><defs><linearGradient id="bg" y2="1"><stop stop-color="#4a443c"/><stop offset=".65" stop-color="#282523"/><stop offset="1" stop-color="#181716"/></linearGradient><radialGradient id="light"><stop stop-color="#e1b77f" stop-opacity=".55"/><stop offset="1" stop-color="#e1b77f" stop-opacity="0"/></radialGradient><linearGradient id="barrel" x2="0" y2="1"><stop stop-color="#373532"/><stop offset=".2" stop-color="#121314"/><stop offset=".72" stop-color="#202223"/><stop offset="1" stop-color="#090a0b"/></linearGradient><linearGradient id="front" x2="1" y2="1"><stop stop-color="#263943"/><stop offset=".35" stop-color="#11191e"/><stop offset=".7" stop-color="#52636b"/><stop offset="1" stop-color="#101619"/></linearGradient></defs><rect width="960" height="640" fill="url(#bg)"/><circle cx="760" cy="165" r="225" fill="url(#light)"/><path d="M0 492Q260 430 520 478T960 450V640H0Z" fill="#171615"/><ellipse cx="484" cy="493" rx="345" ry="60" fill="#090909" opacity=".78"/><path d="M180 269h105q34 0 50 25l43-18h275q35 0 51 33l43 104q12 30-8 55l-25 31H242q-48 0-63-48l-26-119q-8-37 27-63z" fill="url(#barrel)" stroke="#5b564e" stroke-width="7"/><path d="M261 293l40 171m65-179l32 191m65-187l21 185m63-184l12 183m63-178l5 164" fill="none" stroke="#82725f" stroke-width="8" opacity=".8"/><path d="M324 290v177m149-182v183m133-179v177" stroke="#0a0c0e" stroke-width="15" opacity=".82"/><path d="M359 285v179m148-182v185m133-178v170" stroke="#c19a69" stroke-width="3" opacity=".6"/><path d="M236 302q-42 5-39 42l22 100q7 29 38 29h42l-37-172z" fill="#272b2d" stroke="#979083" stroke-width="5"/><ellipse cx="218" cy="395" rx="57" ry="94" fill="#121719" stroke="#a17c52" stroke-width="9"/><ellipse cx="204" cy="395" rx="36" ry="67" fill="url(#front)" stroke="#242a2c" stroke-width="8"/><ellipse cx="198" cy="395" rx="20" ry="48" fill="#14232a" opacity=".9"/><path d="M181 355q25 14 30 48" fill="none" stroke="#d3e0dc" stroke-width="7" stroke-opacity=".48"/><rect x="724" y="321" width="49" height="104" rx="10" fill="#151719" stroke="#6d655a" stroke-width="5"/><path d="M758 340h-35m35 17h-35m35 17h-35m35 17h-35m35 17h-35" stroke="#b69368" stroke-width="3" opacity=".72"/><text x="365" y="386" fill="#b8b2a8" font-family="Arial,sans-serif" font-size="15" letter-spacing="5" transform="rotate(-2 365 386)">G MASTER · 24–70</text><path d="M245 529h470" stroke="#d0aa7a" stroke-opacity=".13" stroke-width="2"/></svg>`)).webp({ quality: 88 }).toBuffer();
  const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${css.css}${cssModule?.text ?? ""}html,body,#root{min-height:100%;margin:0;background:#090909;color:#f6f4f0;font-family:Arial,sans-serif}button{cursor:pointer}input,button{font:inherit}</style><div id="root"></div><script>window.__route='';window.__query=(ref,args)=>ref==='availability.forCart'&&args!=='skip'?Object.fromEntries(args.items.map(i=>[i.listingId,{ok:true}])):undefined;window.__action=ref=>async args=>({items:(args?.items??[]).map(i=>({...i,total:i.total})),subtotal:270});</script><script src="/bundle.js"></script>`;
  const imageRequests = [];
  const server = http.createServer((req, res) => { if (req.url === "/bundle.js") { res.setHeader("content-type", "text/javascript"); res.end(js.text); return; } if (req.url?.startsWith("/fixtures/listings/")) imageRequests.push(req.url); if (req.url === "/fixtures/listings/missing-camera.webp") { res.statusCode = 404; res.end("missing synthetic primary image"); return; } if (req.url === "/fixtures/listings/sony-fx3.webp") { res.setHeader("content-type", "image/webp"); res.setHeader("cache-control", "public, max-age=3600"); res.end(cameraPhoto); return; } if (req.url === "/fixtures/listings/sony-24-70.webp") { res.setHeader("content-type", "image/webp"); res.setHeader("cache-control", "public, max-age=3600"); res.end(lensPhoto); return; } res.setHeader("content-type", "text/html"); res.end(page); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-cart-mobile-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "Synthetic browser starts");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect();
    await browser.cmd("Page.enable"); await browser.cmd("Runtime.enable");
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
    const until = async (expression, label) => { for (let i = 0; i < 80; i++) { if (await browser.evaluate(expression)) return; await wait(50); } throw new Error(`Timed out: ${label}; page=${await browser.evaluate("document.documentElement.outerHTML.slice(-500)")}`); };
    await until(`!!document.querySelector('[data-testid="basket-summary"]')`, "synthetic cart renders");
    await until(`(()=>{const images=[...document.querySelectorAll('img[alt="Sony FX3 cinema camera"],img[alt="Sony 24–70mm f/2.8 G Master lens"]')];return images.length===2&&images.every(image=>image.complete&&image.naturalWidth>0&&image.classList.contains('loaded'))})()`, "both synthetic catalog photos load through SmartImage");
    const imageProof = await browser.evaluate(`(()=>[...document.querySelectorAll('img[alt="Sony FX3 cinema camera"],img[alt="Sony 24–70mm f/2.8 G Master lens"]')].map(image=>({alt:image.alt,src:new URL(image.src).pathname,width:image.naturalWidth,height:image.naturalHeight,loaded:image.classList.contains('loaded')})))()`);
    assert.deepEqual(imageProof.map(item=>item.src), ["/fixtures/listings/sony-fx3.webp", "/fixtures/listings/sony-24-70.webp"], `Cart renders the resolved primary/fallback catalog image URLs: ${JSON.stringify(imageProof)}`);
    assert(imageProof.every(item=>item.width>=640&&item.height>=400&&item.loaded), `Cart thumbnails are real raster listing photos, not glyphs: ${JSON.stringify(imageProof)}`);
    assert(imageRequests.includes("/fixtures/listings/missing-camera.webp"), "SmartImage tries the listing primary image before switching to its available fallback source");
    const out = "/tmp/dbc-cart-mobile-audit"; fs.mkdirSync(out, { recursive: true });
    for (const width of [320, 390, 430, 768]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 768 });
      await wait(80);
      const geometry = await browser.evaluate(`(()=>{const nodes=[...document.querySelectorAll('main, [data-testid="basket-summary"], input, button, [data-cart-dates],img[alt="Sony FX3 cinema camera"],img[alt="Sony 24–70mm f/2.8 G Master lens"]')].filter(e=>e.getBoundingClientRect().width>0);return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,docHeight:document.documentElement.scrollHeight,outside:nodes.filter(e=>{const r=e.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1}).map(e=>({tag:e.tagName,text:e.innerText?.slice(0,32),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})).slice(0,5),images:[...document.querySelectorAll('img[alt="Sony FX3 cinema camera"],img[alt="Sony 24–70mm f/2.8 G Master lens"]')].map(i=>({alt:i.alt,loaded:i.complete&&i.naturalWidth>0,src:new URL(i.src).pathname}))}})()`);
      assert.equal(geometry.scrollWidth <= width, true, `Cart has no horizontal overflow at ${width}px: ${JSON.stringify(geometry)}`);
      assert.deepEqual(geometry.outside, [], `Cart controls fit at ${width}px: ${JSON.stringify(geometry)}`);
      assert(geometry.images.length===2&&geometry.images.every(image=>image.loaded), `Both actual product thumbnails remain loaded at ${width}px: ${JSON.stringify(geometry.images)}`);
      assert.equal(await browser.evaluate(`document.querySelectorAll('[data-checkout-item-times]').length`), 0, "Cart does not ask for exact pickup/return times");
      if (width < 768) assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid="mobile-checkout-dock"]')`), true, "Phone cart keeps a checkout action visible");
      const shot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(out, `cart-${width}-top.png`), Buffer.from(shot.data, "base64"));
    }
    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.evaluate(`document.querySelector('[data-testid="mobile-checkout-dock"] button').click()`);
    await until(`window.__route==='/checkout'`, "checkout action continues to checkout without asking for times in the cart");
    await browser.evaluate(`document.querySelector('[data-cart-dates] button').click()`);
    await until(`!!document.querySelector('[data-cart-dates] input[type=date]')`, "cart date editor opens");
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-cart-dates] input[type="time"]').length`), 0, "Date editor leaves exact times for checkout");
    const dateLayout = await browser.evaluate(`(()=>{const es=[...document.querySelectorAll('[data-cart-dates] input')],rs=es.map(e=>e.getBoundingClientRect());return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,boxes:rs.map(r=>({left:r.left,right:r.right,width:r.width}))}})()`);
    assert.equal(dateLayout.scrollWidth <= 320, true, `Date editor stays within 320px: ${JSON.stringify(dateLayout)}`);
    assert(dateLayout.boxes.every(r => r.left >= -1 && r.right <= 321), `Date fields fit 320px: ${JSON.stringify(dateLayout)}`);
    let shot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(out, "cart-320-date-editor.png"), Buffer.from(shot.data, "base64"));
    const title = "Sony FX3 cinema camera";
    await browser.evaluate(`document.querySelector('button[aria-label="Remove ${title}"]')?.click()`);
    await until(`document.body.innerText.includes('Sony 24–70mm f/2.8 G Master lens')`, "remove item updates the basket");
    assert.equal(await browser.evaluate(`document.body.innerText.includes('Sony FX3 cinema camera')`), false, "Remove action removes only the selected synthetic item");
    await browser.evaluate(`window.scrollTo(0,document.documentElement.scrollHeight)`); await wait(100);
    shot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(out, "cart-320-summary-bottom.png"), Buffer.from(shot.data, "base64"));
    assert.equal(await browser.evaluate(`document.documentElement.scrollWidth<=320`), true, "Summary and lower actions remain within the phone width");
    console.log(`PASS synthetic cart browser: 320/390/430/768px geometry and loaded synthetic camera/lens photos (including SmartImage fallback), scrolling, visible phone checkout action, date-only edits, item removal, and no exact-time controls. No Convex, auth or payment calls. Screenshots: ${out}`);
  } finally {
    if (browser) { browser.close(); await fetch(`${process.env.DBC_CDP_URL || "http://localhost:9224"}/json/close/${browser.tabId}`).catch(() => {}); }
    await new Promise(resolve => server.close(resolve));
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
