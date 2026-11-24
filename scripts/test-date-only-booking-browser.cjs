/** Real listing booking controls in a local browser fixture; no live catalogue, inventory or payment calls. */
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), os = require("node:os"), assert = require("node:assert/strict"), postcss = require("postcss"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), entry = root + "/scripts/fixtures/date-only-booking.tsx", work = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-date-only-browser-"));
let globalCss;
const membershipSource = fs.readFileSync(root + "/scripts/test-membership-browser.cjs", "utf8"), connect = new Function("require", membershipSource.slice(0, membershipSource.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const addDaysIso = (iso, count) => { const date = new Date(`${iso}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10); };
let server, chrome, browser;
(async () => {
  globalCss = await postcss([require("@tailwindcss/postcss")({ base: root })]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const esbuild = require("esbuild"), entryRef = JSON.stringify(entry);
  const provider = `import {useFixtureQuery,useFixtureAction,useFixtureMutation,useFixtureConvex,useFixtureCart,useFixtureAccount} from ${entryRef}; export const useQuery=useFixtureQuery,useAction=useFixtureAction,useMutation=useFixtureMutation,useConvex=useFixtureConvex;`;
  const modules = {
    "convex/react": provider,
    "_generated/api": "const refs=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>String(group)+'.'+String(method)})});export const api=refs,internal=refs;",
    "components/cart/CartProvider": "export type CartItem=any;export const useCart=()=>window.fixture.getCart();",
    "components/account/AccountProvider": "export const useAccount=()=>({me:null,token:null});",
    "components/booking/useCalendarStock": "export function useCalendarStock(){return {ready:true,error:false,unavailable:new Set(),partial:new Set(),retry:async()=>{}};}",
    "components/SmartImage": "import React from 'react';export function SmartImage({alt='',className=''}){return React.createElement('span',{className,'aria-label':alt});}",
    "TimeSlotPicker.module.css": "export default {field:'field',label:'label',trigger:'trigger',selected:'selected',fullPrompt:'fullPrompt',mobilePrompt:'mobilePrompt',chevron:'chevron',menu:'menu',caption:'caption',slots:'slots',option:'option',active:'active',chosen:'chosen'};",
  };
  await esbuild.build({ entryPoints: [entry], outfile: work + "/fixture.js", bundle: true, platform: "browser", format: "iife", jsx: "automatic", tsconfig: root + "/tsconfig.json", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent", plugins: [{ name: "isolated-booking-fixture", setup(build) {
    build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|@\/components\/(cart\/CartProvider|account\/AccountProvider|SmartImage)|\.\/(CartProvider|useCalendarStock|TimeSlotPicker\.module\.css))$/ }, args => {
      const key = args.path.includes("_generated/api") ? "_generated/api" : args.path.replace(/^@\//, "");
      const pathKey = key === "./CartProvider" ? "components/cart/CartProvider" : key === "./useCalendarStock" ? "components/booking/useCalendarStock" : key.endsWith("TimeSlotPicker.module.css") ? "TimeSlotPicker.module.css" : key;
      if (!(pathKey in modules)) throw Error("Missing fixture module alias: " + args.path);
      return { path: pathKey, namespace: "booking-fixture" };
    });
    build.onLoad({ filter: /.*/, namespace: "booking-fixture" }, args => ({ contents: modules[args.path], loader: args.path.endsWith(".css") ? "js" : "tsx", resolveDir: root }));
  }}] });
  server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("content-type", "application/javascript"); response.end(fs.readFileSync(work + "/fixture.js")); return; }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); response.end(globalCss.css); return; }
    response.setHeader("content-type", "text/html"); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = work + "/chrome-profile", executable = process.env.DBC_CHROMIUM_PATH || "/snap/bin/chromium", port = process.env.DBC_DATE_ONLY_CDP_PORT || "9238";
  chrome = spawn(executable, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking", "--no-first-run", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
  process.env.DBC_CDP_URL = "http://127.0.0.1:" + port;
  let endpointReady = false;
  for (let i = 0; i < 100 && !endpointReady; i++) { if (chrome.exitCode !== null) throw Error("Chromium exited before its local debugging endpoint started"); try { endpointReady = (await fetch(process.env.DBC_CDP_URL + "/json/version")).ok; } catch {} if (!endpointReady) await wait(100); }
  assert(endpointReady, "Chromium exposes its local debugging endpoint");
  browser = await connect("http://127.0.0.1:" + server.address().port); await browser.cmd("Page.enable"); await browser.cmd("Runtime.enable");
  const errors = []; browser.on(message => { if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); });
  async function until(expression, label) { for (let i = 0; i < 150; i++) { if (await browser.evaluate(expression)) return; await wait(100); } const state = await browser.evaluate("JSON.stringify({url:location.href,root:document.querySelector('#root')?.innerHTML.slice(-1200),body:document.body.innerText.slice(-1200),basket:window.fixture?.getBasket(),queries:window.fixture?.queryLog})"); throw Error(label + ": " + state + " browserErrors=" + JSON.stringify(errors)); }
  async function click(expression, label) { await until("!!(" + expression + ")", label + " exists"); await browser.evaluate("(" + expression + ").click()"); }
  const visualOutput = path.join(os.tmpdir(), "dbc-duration-offer-visual"); fs.mkdirSync(visualOutput, { recursive: true });
  async function captureDuration(name, width, mobile) {
    await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
    await browser.evaluate("document.querySelector('[data-testid=booking-duration-control]')?.scrollIntoView({block:'center',behavior:'instant'})");
    await wait(120);
    const screenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(visualOutput, name), Buffer.from(screenshot.data, "base64"));
    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  await until("!!document.querySelector('[data-testid=calendar-next-month]')", "Listing booking calendar renders");
  assert.equal(await browser.evaluate("!!document.querySelector('[data-checkout-item-times],input[type=time],[data-testid=rental-handover-time]')"), false, "Browse starts with date selection only");
  const requestedDate = new Date(Date.now() + 60 * 86400000), requestedIso = requestedDate.toISOString().slice(0, 10), targetMonth = requestedDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  let visibleMonth = await browser.evaluate("document.querySelector('[data-testid=calendar-next-month]').parentElement.querySelector('.font-display').innerText.trim()");
  for (let attempt = 0; visibleMonth !== targetMonth && attempt < 15; attempt++) {
    await click("document.querySelector('[data-testid=calendar-next-month]')", "Next month");
    await until("document.querySelector('[data-testid=calendar-next-month]').parentElement.querySelector('.font-display').innerText.trim()!==" + JSON.stringify(visibleMonth), "Calendar month changes");
    visibleMonth = await browser.evaluate("document.querySelector('[data-testid=calendar-next-month]').parentElement.querySelector('.font-display').innerText.trim()");
  }
  assert.equal(visibleMonth, targetMonth, "The renter can browse to the selected future date");
  const day = String(requestedDate.getDate()), dayClicked = await browser.evaluate("(()=>{const button=[...document.querySelectorAll('[data-testid=calendar-day]')].find(item=>item.textContent.trim()===" + JSON.stringify(day) + ");if(!button)return false;button.click();return true})()");
  assert.equal(dayClicked, true, "The calendar day is clickable");
  await until("document.querySelector('[data-testid=booking-add-to-kit]')&&!document.querySelector('[data-testid=booking-add-to-kit]').disabled", "Date selection enables Add to kit without an exact time");
  await until("document.querySelector('[data-testid=booking-duration-increase]')&&!document.querySelector('[data-testid=booking-duration-increase]').disabled", "Selected dates expose a live-availability duration stepper");
  await click("document.querySelector('[data-testid=booking-duration-increase]')", "Add a second rental day");
  await until("document.querySelector('[data-testid=booking-rental-total]')?.innerText.trim()==='£200'", "A second day updates the displayed rental total");
  await until("document.querySelector('[data-testid=booking-third-day-offer]')?.innerText.includes('£70 more')", "Two selected days show the third-day offer");
  const twoDayOffer = await browser.evaluate("document.querySelector('[data-testid=booking-third-day-offer]').innerText");
  assert.match(twoDayOffer, /save £30/i, "The third-day prompt discloses the saving against daily rates");
  await captureDuration("two-day-offer-mobile.png", 390, true);
  await browser.evaluate("window.fixture.setExtensionAvailable(false)");
  await until("document.querySelector('[data-testid=booking-duration-increase]')?.disabled===true&&document.querySelector('[data-testid=booking-third-day-offer]')?.innerText.includes('not available')", "The extra-day offer fails closed when whole-kit stock is unavailable");
  await browser.evaluate("window.fixture.setExtensionAvailable(true)");
  await until("document.querySelector('[data-testid=booking-duration-increase]')?.disabled===false&&document.querySelector('[data-testid=booking-third-day-offer]')?.innerText.includes('save £30')", "The duration option returns after live stock becomes available");
  await click("document.querySelector('[data-testid=booking-duration-increase]')", "Apply the third rental day");
  await until("document.querySelector('[data-testid=booking-rental-total]')?.innerText.trim()==='£270'&&document.querySelector('[data-testid=booking-duration-saving]')?.innerText.includes('save £30')", "The 3-day discount and new price update immediately");
  await captureDuration("three-day-discount-desktop.png", 1440, false);
  await click("document.querySelector('[data-testid=booking-duration-decrease]')", "Remove one rental day");
  await until("document.querySelector('[data-testid=booking-rental-total]')?.innerText.trim()==='£200'", "Removing one day recalculates the price without stale savings");
  await click("document.querySelector('[data-testid=booking-duration-increase]')", "Restore the discounted third day");
  await until("document.querySelector('[data-testid=booking-rental-total]')?.innerText.trim()==='£270'", "Restoring the day reapplies the duration price exactly once");
  assert.equal(await browser.evaluate("!!document.querySelector('[data-checkout-item-times],input[type=time],[data-testid=rental-handover-time]')"), false, "Selecting rental dates still does not expose exact-time selectors");
  await click("document.querySelector('[data-testid=booking-add-to-kit]')", "Add to kit");
  await until("window.fixture.getBasket().length===1", "Selected listing is added to the basket");
  const added = await browser.evaluate("window.fixture.getBasket()[0]");
  assert.equal(added.start, requestedIso, "The browse selection preserves the pickup date"); assert.equal(added.end, addDaysIso(requestedIso, 2), "The duration controls preserve the chosen third rental day"); assert.equal(added.days, 3, "The basket receives the updated billable duration"); assert.equal(added.total, 270, "The basket receives the discounted 3-day price");
  assert.equal(Object.hasOwn(added, "pickupTime"), false, "Browse does not invent or request a pickup time"); assert.equal(Object.hasOwn(added, "returnTime"), false, "Browse does not invent or request a return time");
  const browseQueries = await browser.evaluate("window.fixture.queryLog.map(query=>query.key)"); assert.equal(browseQueries.includes("availability.forTimeSlots"), false, "Browse checks date availability without making an exact-time query");
  await click("document.querySelector('[data-testid=open-cart]')", "Open kit"); assert.equal(await browser.evaluate("!!document.querySelector('[data-checkout-item-times],input[type=time],[data-testid=rental-handover-time]')"), false, "Basket review remains date-only");
  await click("document.querySelector('[data-testid=open-checkout]')", "Checkout");
  await until("!!document.querySelector('[data-checkout-item-times] button[aria-controls]')", "Checkout time row appears");
  await click("document.querySelector('[data-checkout-item-times] button[aria-controls]')", "Open checkout time controls");
  await until("document.querySelectorAll('[data-checkout-item-times] [role=combobox]').length===2", "Separate pickup and return selectors render at checkout");
  const checkout = await browser.evaluate("({timeSelectors:document.querySelectorAll('[data-checkout-item-times] [role=combobox]').length,timeQuery:window.fixture.queryLog.some(query=>query.key==='availability.forTimeSlots'),labels:[...document.querySelectorAll('[data-checkout-item-times] [role=combobox]')].map(item=>item.getAttribute('aria-labelledby'))})");
  assert.equal(checkout.timeSelectors, 2); assert.equal(checkout.timeQuery, true, "Exact-time availability is queried only after checkout renders the time controls");
  assert.deepEqual(errors, [], "The browse-to-checkout interaction has no browser exceptions");
  console.log(JSON.stringify({ result: "PASS", path: "date selection → live-checked duration adjustment → date-only basket → separate checkout time controls", requestedDate: requestedIso, checkoutTimeSelectors: checkout.timeSelectors, externalServices: false, visualChecks: visualOutput }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  browser?.close();
  if (chrome && chrome.exitCode === null) { const exited = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill("SIGTERM"); await exited; }
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.promises.rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
