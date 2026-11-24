const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const browserHarness = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", browserHarness.slice(0, browserHarness.indexOf('const { ConvexHttpClient }')) + "\nreturn connect;")(require);

const mocks = {
  "next/link": 'import React from "react"; export default function Link({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); }',
  "convex/browser": 'export class ConvexHttpClient { constructor() {} async query() { return {}; } }',
  "@cvx/_generated/api": 'export const api = { settings: { get: "settings.get" } };',
  "@/components/Marquee": 'import React from "react"; export function Marquee({ items = [], className = "", itemClassName = "" }) { return React.createElement("div", { className, "aria-hidden": "true", style: { overflow: "hidden", maxWidth: "100%" } }, items.map((item) => React.createElement("span", { key: item, className: itemClassName }, item))); }',
  "@/components/GafferCall": 'import React from "react"; export function GafferCall({ label = "Talk to Gaffer" }) { return React.createElement("button", { type: "button" }, label); }',
  "@/components/EmailLink": 'import React from "react"; export function EmailLink({ className = "" }) { return React.createElement("a", { className, href: "mailto:hello@example.invalid" }, "hello@example.invalid"); }',
  "@/lib/hireCategories": 'export const HIRE_CATEGORIES = [];',
  "@/lib/site": 'export const HOURS_LABEL = "By appointment";',
  "shared/reviewPrize": 'export const REVIEW_PRIZE_GBP = 100;',
};

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-footer-mobile-"));
  const plugin = {
    name: "footer-test-mocks",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => mocks[args.path] ? ({ path: args.path, namespace: "footer-test" }) : undefined);
      build.onLoad({ filter: /.*/, namespace: "footer-test" }, (args) => ({ loader: "jsx", resolveDir: root, contents: mocks[args.path] }));
    },
  };
  await require("esbuild").build({
    entryPoints: [path.join(__dirname, "fixtures/footer-owner-login.tsx")],
    outfile: path.join(directory, "fixture.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"), plugins: [plugin], define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const css = await require("postcss")([require("@tailwindcss/postcss")({ base: root })])
    .process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  fs.writeFileSync(path.join(directory, "fixture.css"), css.css);

  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); return response.end(fs.readFileSync(path.join(directory, "fixture.js"))); }
    if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); return response.end(fs.readFileSync(path.join(directory, "fixture.css"))); }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#08080a;color:white}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await connect("about:blank");
    await browser.cmd("Page.enable");
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const [width, height, mobile] of [[320, 700, true], [390, 844, true], [768, 900, true], [1440, 900, false]]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await delay(100);
      await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
      for (let attempt = 0; attempt < 100 && !(await browser.evaluate('!!document.querySelector("footer a[href=\\"/admin\\"]")')); attempt++) await delay(50);
      const view = await browser.evaluate(`(() => {
        const link = document.querySelector('footer a[href="/admin"]');
        const notice = [...document.querySelectorAll('footer p')].find(element => element.textContent.includes('Website content, imagery'));
        if (!link || !notice) return null;
        const rect = element => { const r=element.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
        const style = getComputedStyle(link);
        const linkRect=rect(link), noticeRect=rect(notice), linkStyle={color:style.color,background:style.backgroundColor,opacity:style.opacity,visibility:style.visibility,display:style.display,zIndex:style.zIndex,pointerEvents:style.pointerEvents};
        return {link:linkRect,notice:noticeRect,linkStyle,viewportWidth:innerWidth,layoutWidth:document.documentElement.clientWidth,visualWidth:visualViewport?.width,devicePixelRatio,docWidth:document.documentElement.scrollWidth,visible:linkRect.width>0&&linkRect.height>0&&style.display!=="none"&&style.visibility!=="hidden"&&Number(style.opacity)>0.9,overlapsNotice:linkRect.left<noticeRect.right&&linkRect.right>noticeRect.left&&linkRect.top<noticeRect.bottom&&linkRect.bottom>noticeRect.top,linkText:link.textContent.trim(),linkHref:link.getAttribute("href")};
      })()`);
      assert(view, `AI notice and owner login render at ${width}px`);
      assert.equal(view.docWidth, view.layoutWidth, `Footer has no horizontal overflow at ${width}px`);
      assert.equal(view.visible, true, `Owner login remains visible at ${width}px`);
      assert.equal(view.linkHref, "/admin", `Owner login retains its admin destination at ${width}px`);
      assert.equal(view.overlapsNotice, false, `Owner login does not overlap the AI notice at ${width}px`);
      assert.notEqual(view.linkStyle.color, "rgb(0, 0, 0)", `Owner login text is not blacked out at ${width}px`);
      await browser.evaluate(`document.querySelector('footer a[href="/admin"]').scrollIntoView({block:'center',behavior:'instant'})`);
      await delay(100);
      const hit=await browser.evaluate(`(()=>{const link=document.querySelector('footer a[href="/admin"]'),rect=link.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2,element=document.elementFromPoint(x,y);return{hit:!!element&&(element===link||link.contains(element)),width:rect.width,height:rect.height,x,y}})()`);
      assert(hit.hit&&hit.width>=44&&hit.height>=44,`Owner login remains tappable over the notice at ${width}px: ${JSON.stringify(hit)}`);
      await delay(150);
      const screenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(`/tmp/dbc-footer-owner-login-${width}.png`, Buffer.from(screenshot.data, "base64"));
      await browser.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:hit.x,y:hit.y,button:'left',clickCount:1});
      await browser.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:hit.x,y:hit.y,button:'left',clickCount:1});
      for(let attempt=0;attempt<80&&await browser.evaluate('location.pathname')!=='/admin';attempt++)await delay(50);
      assert.equal(await browser.evaluate('location.pathname'),'/admin',`Owner login actually navigates at ${width}px`);
      console.log(JSON.stringify({ width, mobile, ...view }));
    }
  } finally {
    if (browser) browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
