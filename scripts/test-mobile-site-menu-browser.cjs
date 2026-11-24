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
  ["@cvx/_generated/api", `export const api={settings:{get:"settings.get"},rentalChat:{unreadBreakdown:"rentalChat.unreadBreakdown"}}`],
  ["next/link", `import React from "react";export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`],
  ["next/navigation", `export function usePathname(){return window.location.pathname}`],
  ["@/components/cart/CartProvider", `export function useCart(){return{count:0,open(){}}}`],
  ["@/components/account/AccountProvider", `export function useAccount(){return{me:null,token:null,loading:false,signOut(){}}}`],
  ["@/components/icons", `export const IconArrowRight=()=> <span aria-hidden="true">→</span>;export const IconCart=()=> <span aria-hidden="true">▢</span>;export const IconMenu=()=> <span aria-hidden="true">☰</span>;export const IconUser=()=> <span aria-hidden="true">○</span>;export const IconX=()=> <span aria-hidden="true">×</span>;`],
  ["@/components/SignatureProductionsOverlay", `export function SignatureProductionsOverlay(){return null}`],
  ["@/components/FormSevenBadge", `export function FormSevenCoin(){return <span aria-hidden="true">7</span>}export function FormSevenMobileTrigger({onOpen}){return <button type="button" data-testid="form-seven-mobile" onClick={onOpen} className="min-h-11 rounded-xl border border-white/10 px-4 text-white/70">FORM / SEVEN</button>}export function useSpinAndShine(){return{spinning:false,shining:false}}`],
  ["convex/browser", `export class ConvexHttpClient{async query(){return {}}}`],
  ["@/components/Marquee", `export function Marquee(){return null}`],
  ["@/components/GafferCall", `export function GafferCall(){return null}`],
  ["@/components/EmailLink", `export function EmailLink(){return <a href="mailto:hello@example.invalid">Email</a>}`],
  ["@/lib/hireCategories", `export const HIRE_CATEGORIES=[]`],
  ["@/lib/site", `export const HOURS_LABEL="daily"`],
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
  const entry = `import React from "react";import{createRoot}from"react-dom/client";import{SiteHeader}from"./src/components/SiteHeader";import{Footer}from"./src/components/Footer";Footer().then(footer=>createRoot(document.getElementById("root")).render(<div id="main-content" style={{position:"relative",zIndex:10}}><SiteHeader/>{footer}</div>));`;
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
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><style>html,body,#root{min-height:100%;margin:0;background:#08090a;color:#eee}body{font-family:Arial,sans-serif}</style></head><body><div id="root"></div><div data-testid="fixed-chat-launcher" style="position:fixed;right:12px;bottom:12px;width:48px;height:48px;background:#d93b50;z-index:60"></div><script src="/bundle.js"></script></body></html>`;
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

    const overlayStack = await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]'),launcher=document.querySelector('[data-testid="fixed-chat-launcher"]'),hit=document.elementFromPoint(innerWidth-36,innerHeight-36);return{menuZ:getComputedStyle(menu).zIndex,launcherZ:getComputedStyle(launcher).zIndex,launcherCovered:menu.contains(hit)}})()`);
    assert(Number(overlayStack.menuZ) > Number(overlayStack.launcherZ) && overlayStack.launcherCovered, `The fullscreen menu stays above fixed chat controls: ${JSON.stringify(overlayStack)}`);

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

    await browser.evaluate(`document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,document.documentElement.scrollHeight)`);
    await wait(300);
    const footer = await browser.evaluate(`(()=>{const link=[...document.querySelectorAll('footer a')].find(a=>a.textContent.trim()==='Owner login'),box=link.getBoundingClientRect();return{href:link.getAttribute('href'),top:box.top,bottom:box.bottom,width:box.width,height:box.height,color:getComputedStyle(link).color,pageWidth:document.documentElement.scrollWidth}})()`);
    assert.equal(footer.href, "/admin", "Owner login points to the admin page");
    assert(footer.top >= 0 && footer.bottom <= 640 && footer.height >= 44, `Owner login is visible and tappable after the AI notice: ${JSON.stringify(footer)}`);
    assert.equal(footer.pageWidth, 320, "Footer does not create horizontal overflow");
    const footerScreenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbcinema-mobile-footer-320.png", Buffer.from(footerScreenshot.data, "base64"));

    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.evaluate(`window.scrollTo(0,0);document.querySelector('[aria-label="Open menu"]').click()`);
    await until(`document.querySelector('[data-testid="mobile-site-menu"]').getAttribute('aria-hidden')==='false'`, "390px mobile menu opens");
    await wait(1100);
    const mobile390 = await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]'),r=menu.getBoundingClientRect();return{width:innerWidth,height:innerHeight,top:r.top,bottom:r.bottom,menuHeight:menu.clientHeight,menuScrollHeight:menu.scrollHeight,pageWidth:document.documentElement.scrollWidth}})()`);
    assert(mobile390.top >= 0 && mobile390.bottom <= mobile390.height && mobile390.menuHeight >= mobile390.height - 16, `390px menu stays within the phone viewport: ${JSON.stringify(mobile390)}`);
    assert.equal(mobile390.pageWidth, 390, "390px menu does not create horizontal overflow");
    await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]');menu.scrollTop=menu.scrollHeight})()`);
    await wait(520);
    const bottom390 = await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]'),visible=e=>{const r=e?.getBoundingClientRect();return r&&r.top<innerHeight&&r.bottom>0},label=e=>e.querySelector('span')?.textContent.trim()??e.textContent.trim(),contact=[...menu.querySelectorAll('a')].find(a=>label(a)==='Contact'),account=[...menu.querySelectorAll('a')].find(a=>label(a)==='Account'),gaffer=[...menu.querySelectorAll('button')].find(b=>b.textContent.includes('Chat with Gaffer')),form7=menu.querySelector('[data-testid="form-seven-mobile"]');return{atBottom:menu.scrollTop>=menu.scrollHeight-menu.clientHeight-1,contact:visible(contact),account:visible(account),gaffer:visible(gaffer),form7:visible(form7),footer:visible(menu.querySelector('.hud-label'))}})()`);
    assert(bottom390.atBottom && bottom390.contact && bottom390.account && bottom390.gaffer && bottom390.form7 && bottom390.footer, `390px menu bottom entries remain reachable: ${JSON.stringify(bottom390)}`);
    const menu390Screenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbcinema-mobile-nav-390x844-bottom.png", Buffer.from(menu390Screenshot.data, "base64"));
    await browser.evaluate(`document.querySelector('[data-mobile-menu-close]').click()`);
    await until(`document.querySelector('[aria-label="Open menu"]').getAttribute('aria-expanded')==='false'`, "390px menu closes");
    await browser.evaluate(`document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,document.documentElement.scrollHeight)`);
    await wait(300);
    const footer390 = await browser.evaluate(`(()=>{const link=[...document.querySelectorAll('footer a')].find(a=>a.textContent.trim()==='Owner login'),box=link.getBoundingClientRect();return{href:link.getAttribute('href'),top:box.top,bottom:box.bottom,width:box.width,height:box.height,pageWidth:document.documentElement.scrollWidth}})()`);
    assert.equal(footer390.href, "/admin", "390px owner login points to the admin page");
    assert(footer390.top >= 0 && footer390.bottom <= 844 && footer390.height >= 44, `Owner login stays visible and tappable after the AI notice at 390px: ${JSON.stringify(footer390)}`);
    assert.equal(footer390.pageWidth, 390, "390px footer does not create horizontal overflow");
    const footer390Screenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbcinema-mobile-footer-390.png", Buffer.from(footer390Screenshot.data, "base64"));

    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.evaluate(`window.scrollTo(0,0);document.querySelector('[aria-label="Open menu"]').click()`);
    await until(`document.querySelector('[data-testid="mobile-site-menu"]').getAttribute('aria-hidden')==='false'`, "desktop menu opens");
    await wait(1100);
    const desktop = await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]'),nav=menu.querySelector('nav'),links=[...nav.querySelectorAll('a')],rect=nav.getBoundingClientRect();return{width:rect.width,left:rect.left,right:rect.right,columns:getComputedStyle(nav).gridTemplateColumns.split(' ').length,links:links.map(link=>{const r=link.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}})}})()`);
    assert(desktop.width <= 768 && desktop.left >= 0 && desktop.right <= 1440 && desktop.columns === 2, `Desktop menu stays contained and uses two columns: ${JSON.stringify(desktop)}`);
    assert(desktop.links.every(link => link.left >= 0 && link.right <= 1440 && link.top >= 0 && link.bottom <= 900), `Desktop links are visible within the viewport: ${JSON.stringify(desktop)}`);
    const desktopScreenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbcinema-desktop-menu-1440.png", Buffer.from(desktopScreenshot.data, "base64"));

    await browser.evaluate(`document.querySelector('[data-mobile-menu-close]').click()`);
    await until(`document.querySelector('[aria-label="Open menu"]').getAttribute('aria-expanded')==='false'`, "desktop menu closes before the viewport matrix");
    const responsiveCases = [
      [639, 800, 1], [640, 800, 2], [767, 900, 2], [768, 900, 2],
      [1023, 768, 2], [1024, 768, 2], [1535, 900, 2], [1536, 900, 2],
      [1920, 1080, 2], [2560, 1440, 2],
    ];
    for (const [width, height, columns] of responsiveCases) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
      await browser.evaluate(`window.scrollTo(0,0);document.querySelector('[aria-label="Open menu"]').click()`);
      await until(`document.querySelector('[data-testid="mobile-site-menu"]').getAttribute('aria-hidden')==='false'`, `menu opens at ${width}×${height}`);
      const metrics = await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]'),nav=menu.querySelector('nav'),mr=menu.getBoundingClientRect(),nr=nav.getBoundingClientRect(),links=[...nav.querySelectorAll('a')].map(link=>{const r=link.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}}),gaffer=[...menu.querySelectorAll('button')].find(button=>button.textContent.includes('Chat with Gaffer')),formSeven=menu.querySelector('[data-testid="form-seven-mobile"]'),footer=menu.querySelector('.hud-label'),measure=node=>{const r=node?.getBoundingClientRect();return r&&{top:r.top,bottom:r.bottom,visible:r.top<innerHeight&&r.bottom>0}},bottomControls={gaffer:measure(gaffer),formSeven:measure(formSeven),footer:measure(footer)},overflowing=[...menu.querySelectorAll('a,button,nav,footer,span')].map(node=>{const r=node.getBoundingClientRect();return{tag:node.tagName,text:node.textContent.trim().replace(/\\s+/g,' ').slice(0,60),left:r.left,right:r.right,width:r.width,scroll:node.scrollWidth,client:node.clientWidth}}).filter(node=>node.right>mr.right+1||node.left<mr.left-1||node.scroll>node.client+1);return{viewport:{width:innerWidth,height:innerHeight},menu:{left:mr.left,right:mr.right,top:mr.top,bottom:mr.bottom,clientWidth:menu.clientWidth,scrollWidth:menu.scrollWidth,clientHeight:menu.clientHeight,scrollHeight:menu.scrollHeight},nav:{left:nr.left,right:nr.right,width:nr.width,columns:getComputedStyle(nav).gridTemplateColumns.split(' ').length},links,bottomControls,overflowing,pageWidth:document.documentElement.scrollWidth}})()`);
      if (width === 639) {
        const shot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync("/tmp/dbcinema-menu-639x800-entry.png", Buffer.from(shot.data, "base64"));
      }
      assert.deepEqual(metrics.viewport, { width, height }, `The browser reports the requested ${width}×${height} viewport`);
      assert(metrics.menu.left === 0 && metrics.menu.right === width && metrics.menu.top === 0 && metrics.menu.bottom === height, `The menu covers the viewport exactly at ${width}×${height}: ${JSON.stringify(metrics.menu)}`);
      assert(metrics.menu.scrollWidth <= metrics.menu.clientWidth + 1, `Menu content has no horizontal clipping/overflow at ${width}×${height}: ${JSON.stringify(metrics)}`);
      assert(metrics.nav.width <= 768 && metrics.nav.left >= 0 && metrics.nav.right <= width, `The content stays centered and capped at ${width}×${height}: ${JSON.stringify(metrics.nav)}`);
      assert.equal(metrics.nav.columns, columns, `Navigation columns switch cleanly at the 640px breakpoint (${width}px)`);
      assert(metrics.links.every(link => link.left >= 0 && link.right <= width && link.top >= 0 && link.bottom <= height), `No navigation link clips the viewport at ${width}×${height}: ${JSON.stringify(metrics.links)}`);
      if (metrics.menu.scrollHeight <= metrics.menu.clientHeight + 1) {
        assert(Object.values(metrics.bottomControls).every(control => control?.visible), `When the menu fits, its help, partner and footer controls stay visible at ${width}×${height}: ${JSON.stringify(metrics.bottomControls)}`);
      } else {
        await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]');menu.scrollTop=menu.scrollHeight})()`);
        const bottomReachable = await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]'),visible=node=>{const r=node?.getBoundingClientRect();return r&&r.top<innerHeight&&r.bottom>0},gaffer=[...menu.querySelectorAll('button')].find(button=>button.textContent.includes('Chat with Gaffer')),formSeven=menu.querySelector('[data-testid="form-seven-mobile"]'),footer=menu.querySelector('.hud-label');return{atBottom:menu.scrollTop>=menu.scrollHeight-menu.clientHeight-1,gaffer:visible(gaffer),formSeven:visible(formSeven),footer:visible(footer)}})()`);
        assert(bottomReachable.atBottom && bottomReachable.gaffer && bottomReachable.formSeven && bottomReachable.footer, `Long menu has all lower controls reachable by scrolling at ${width}×${height}: ${JSON.stringify(bottomReachable)}`);
        await browser.evaluate(`document.querySelector('[data-testid="mobile-site-menu"]').scrollTop=0`);
      }
      assert.equal(metrics.pageWidth, width, `The menu creates no page-wide horizontal overflow at ${width}×${height}`);
      if ([639, 640, 1920].includes(width)) {
        await wait(1050);
        const settled = await browser.evaluate(`(()=>{const menu=document.querySelector('[data-testid="mobile-site-menu"]'),nav=menu.querySelector('nav'),r=menu.getBoundingClientRect(),links=[...nav.querySelectorAll('a')].map(link=>{const b=link.getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom}});return{scrollWidth:menu.scrollWidth,clientWidth:menu.clientWidth,links,navColumns:getComputedStyle(nav).gridTemplateColumns.split(' ').length,viewport:{width:innerWidth,height:innerHeight},bounds:{left:r.left,right:r.right,top:r.top,bottom:r.bottom}}})()`);
        assert(settled.scrollWidth <= settled.clientWidth + 1, `Settled menu does not overflow at ${width}×${height}: ${JSON.stringify(settled)}`);
        assert(settled.links.every(link => link.left >= 0 && link.right <= width && link.top >= 0 && link.bottom <= height), `Settled links stay inside the viewport at ${width}×${height}: ${JSON.stringify(settled.links)}`);
        const shot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(`/tmp/dbcinema-menu-${width}x${height}-settled.png`, Buffer.from(shot.data, "base64"));
      }
      await browser.evaluate(`document.querySelector('[data-mobile-menu-close]').click()`);
      await until(`document.querySelector('[aria-label="Open menu"]').getAttribute('aria-expanded')==='false'`, `menu closes at ${width}×${height}`);
    }

    console.log("PASS site menu at 320×640, 390×844, breakpoint edges 639/640, 767/768, 1023/1024, 1535/1536, and fullscreen 1920×1080/2560×1440; bounds, internal scrolling, no clipping/overlap or horizontal page overflow, focus trap, and trigger restoration.");
    console.log("Screenshots: /tmp/dbcinema-mobile-nav-320x640-bottom.png, /tmp/dbcinema-mobile-nav-390x844-bottom.png, /tmp/dbcinema-desktop-menu-1440.png, /tmp/dbcinema-menu-639x800-entry.png, /tmp/dbcinema-menu-639x800-settled.png, /tmp/dbcinema-menu-640x800-settled.png, /tmp/dbcinema-menu-1920x1080-settled.png");
  } finally {
    if (browser) { browser.close(); await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(() => {}); }
    await new Promise(resolve => server.close(resolve));
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
