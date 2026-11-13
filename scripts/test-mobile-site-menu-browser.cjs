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
  ["./account/CreditEnergyBar", `export function CreditEnergyBar(){return null}`],
  ["@/lib/membership", `export function tierByKey(){return undefined}`],
  ["./account/AccountFrame", `export function AccountFrame({children}){return <span>{children}</span>}`],
  ["./rentals/ChatIdentity", `export function ChatAvatar({name}){return <span>{name}</span>}`],
  ["convex/react", `export function useQuery(){return undefined}`],
  ["@cvx/_generated/api", `export const api={rentalChat:{unreadBreakdown:"rentalChat.unreadBreakdown"}}`],
  ["next/link", `import React from "react";export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`],
  ["next/navigation", `export function usePathname(){return window.location.pathname}`],
  ["@/components/cart/CartProvider", `export function useCart(){return{count:0,open(){}}}`],
  ["@/components/account/AccountProvider", `export function useAccount(){return{me:null,token:null,loading:false,signOut(){}}}`],
  ["@/components/icons", `export const IconArrowRight=()=> <span aria-hidden="true">→</span>;export const IconCart=()=> <span aria-hidden="true">▢</span>;export const IconMenu=()=> <span aria-hidden="true">☰</span>;export const IconUser=()=> <span aria-hidden="true">○</span>;export const IconX=()=> <span aria-hidden="true">×</span>;`],
  ["@/components/SignatureProductionsOverlay", `export function SignatureProductionsOverlay(){return null}`],
  ["@/components/FormSevenBadge", `export function FormSevenCoin(){return <span aria-hidden="true">7</span>}export function FormSevenMobileTrigger({onOpen}){return <button type="button" data-testid="form-seven-mobile" onClick={onOpen} className="min-h-11 rounded-xl border border-white/10 px-4 text-white/70">FORM / SEVEN</button>}export function useSpinAndShine(){return{spinning:false,shining:false}}`],
]);

const plugin = {
  name: "mobile-site-menu-fixture",
  setup(build) {
    for (const [specifier, contents] of aliases) {
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      build.onResolve({ filter: new RegExp("^" + escaped + "$") }, () => ({ path: specifier, namespace: "mobile-menu-fixture" }));
      build.onLoad({ filter: /.*/, namespace: "mobile-menu-fixture" }, args => ({ loader: "jsx", resolveDir: root, contents: aliases.get(args.path) }));
    }
  },
};

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-mobile-site-menu-"));
  const entry = `import React from "react";import{createRoot}from"react-dom/client";import{SiteHeader}from"./src/components/SiteHeader";createRoot(document.getElementById("root")).render(<SiteHeader/>);`;
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, sourcefile: "mobile-site-menu-fixture.tsx", loader: "tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    plugins: [plugin],
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const js = result.outputFiles[0].text;
  const css = await require("postcss")([require("@tailwindcss/postcss")({ base: root })]).process(
    fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"),
    { from: path.join(root, "src/app/globals.css") },
  );
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><style>html,body,#root{min-height:100%;margin:0;background:#08090a;color:#eee}body{font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(js); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    response.setHeader("content-type", "text/html");
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-mobile-site-menu-chrome-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
      try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; }
      catch { await wait(100); }
    }
    assert(port, "Isolated Chromium starts for the mobile menu fixture");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect("about:blank");
    await browser.cmd("Page.enable");
    await browser.cmd("Runtime.enable");
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
    const until = async (expression, label) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await browser.evaluate(expression)) return;
        await wait(50);
      }
      throw new Error(`Timed out: ${label}`);
    };
    await until(`!!document.querySelector('[aria-label="Open menu"]')`, "SiteHeader fixture renders");
    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
    await browser.evaluate(`document.body.style.overflow='auto'`);

    await browser.evaluate(`document.querySelector('[aria-label="Open menu"]').click()`);
    await until(`document.querySelector('[data-testid="mobile-site-menu"]').getAttribute('aria-hidden')==='false'`, "mobile menu opens");
    await until(`document.activeElement?.getAttribute('aria-label')==='Close menu'`, "focus moves into the menu");
    await wait(1100);

    const openMetrics = await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]'),r=menu.getBoundingClientRect();return{width:innerWidth,height:innerHeight,menuHeight:menu.clientHeight,menuRect:{top:r.top,bottom:r.bottom},menuScrollHeight:menu.scrollHeight,overflowY:getComputedStyle(menu).overflowY,bodyOverflow:document.body.style.overflow,dialogName:menu.getAttribute('aria-labelledby'),pageWidth:document.documentElement.scrollWidth}})()`);
    assert(openMetrics.menuRect.top >= 0 && openMetrics.menuRect.bottom <= openMetrics.height && openMetrics.menuHeight >= openMetrics.height - 16, `Menu stays within the phone viewport: ${JSON.stringify(openMetrics)}`);
    assert(openMetrics.menuScrollHeight > openMetrics.menuHeight, `Short phone menu has its own scroll area: ${JSON.stringify(openMetrics)}`);
    assert.equal(openMetrics.overflowY, "auto", `Menu scrolls internally: ${JSON.stringify(openMetrics)}`);
    assert.equal(openMetrics.bodyOverflow, "hidden", "Opening the menu locks body scrolling");
    assert.equal(openMetrics.pageWidth, 320, "Menu does not create horizontal page overflow");

    await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]');menu.scrollTop=menu.scrollHeight})()`);
    await wait(520);
    const bottom = await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]'),r=e=>{const b=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return b&&{left:b.left,right:b.right,top:b.top,bottom:b.bottom,visible:b.top<innerHeight&&b.bottom>0,opacity:s.opacity,display:s.display,visibility:s.visibility}},label=e=>e.querySelector('span')?.textContent.trim()??e.textContent.trim(),contact=[...menu.querySelectorAll('a')].find(a=>label(a)==='Contact'),account=[...menu.querySelectorAll('a')].find(a=>label(a)==='Account'),gaffer=[...menu.querySelectorAll('button')].find(b=>b.textContent.includes('Chat with Gaffer')),form7=menu.querySelector('[data-testid="form-seven-mobile"]'),footer=menu.querySelector('.hud-label');return{scrollTop:menu.scrollTop,maxScroll:menu.scrollHeight-menu.clientHeight,menuOpacity:getComputedStyle(menu).opacity,contact:r(contact),account:r(account),gaffer:r(gaffer),form7:r(form7),footer:r(footer)}})()`);
    assert(bottom.scrollTop >= bottom.maxScroll - 1, `The menu reaches its bottom: ${JSON.stringify(bottom)}`);
    assert(bottom.contact?.visible && bottom.account?.visible && bottom.gaffer?.visible && bottom.form7?.visible && bottom.footer?.visible, `All bottom navigation and footer entries are reachable at 320×640: ${JSON.stringify(bottom)}`);
    const screenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbcinema-mobile-nav-320x640-bottom.png", Buffer.from(screenshot.data, "base64"));

    await browser.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}))`);
    assert.equal(await browser.evaluate(`document.activeElement?.dataset.testid`), "form-seven-mobile", "Reverse tabbing from the first control wraps to the last menu control");
    await browser.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))`);
    assert.equal(await browser.evaluate(`document.activeElement?.getAttribute('aria-label')`), "Close menu", "Forward tabbing from the last control wraps to the first menu control");

    await browser.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
    await until(`document.querySelector('[aria-label="Open menu"]').getAttribute('aria-expanded')==='false'`, "Escape closes the menu");
    await until(`document.activeElement?.getAttribute('aria-label')==='Open menu'`, "Escape restores trigger focus");
    assert.equal(await browser.evaluate(`document.activeElement?.getAttribute('aria-label')`), "Open menu", "Escape returns focus to the menu trigger");
    assert.equal(await browser.evaluate(`document.body.style.overflow`), "auto", "Closing restores the previous body overflow value");
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="mobile-site-menu"]').getAttribute('aria-hidden')`), "true", "Closed menu is hidden from assistive technology");
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="mobile-site-menu"]').inert`), true, "Closed menu cannot receive keyboard focus");

    await browser.evaluate(`document.querySelector('[aria-label="Open menu"]').click()`);
    await until(`document.activeElement?.getAttribute('aria-label')==='Close menu'`, "menu reopens with focus inside");
    await browser.evaluate(`document.querySelector('[data-mobile-menu-close]').click()`);
    await until(`document.querySelector('[aria-label="Open menu"]').getAttribute('aria-expanded')==='false'`, "close control closes the menu");
    await until(`document.activeElement?.getAttribute('aria-label')==='Open menu'`, "close control restores trigger focus");
    assert.equal(await browser.evaluate(`document.activeElement?.getAttribute('aria-label')`), "Open menu", "Close control returns focus to the menu trigger");

    console.log("PASS mobile site menu at 320×640: internal scrolling reaches Contact, Account, Gaffer, Form Seven and footer; body lock/restoration; focus entry, Tab trapping, Escape and close-button focus return.");
    console.log("Screenshot: /tmp/dbcinema-mobile-nav-320x640-bottom.png");
  } finally {
    if (browser) { browser.close(); await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(() => {}); }
    await new Promise(resolve => server.close(resolve));
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
