const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const esbuild = require("esbuild");
const postcss = require("postcss");
const { spawn, execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const mocks = {
  "next/link": `import React from "react";export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
  "next/navigation": `export function useRouter(){return {push(){}}}`,
  "convex/react": `export function useMutation(){return async()=>{}}`,
  "@cvx/_generated/api": `export const api={analytics:{track:"analytics.track"}}`,
  "@/components/account/AccountProvider": `export function useAccount(){return {me:null,toggleFavorite(){}}}`,
  "@/components/SmartImage": `import React from "react";export function SmartImage({src,alt,className}){return <img src={src} alt={alt} className={className}/>} `,
  "@/components/icons": `import React from "react";export function IconHeart(){return <span aria-hidden="true">♡</span>}export function IconCheck(){return <span aria-hidden="true">✓</span>}`,
  "@/lib/pricing": `export function formatRate(value){return Number(value).toFixed(2)}export function quote(pricing){return {perDay:pricing.daily}}`,
  "@/lib/session": `export function getSessionId(){return "fixture-session"}`,
};

(async () => {
  const entry = `import React from "react";
import {createRoot} from "react-dom/client";
import {GearCard} from "./src/components/GearCard";
import {GafferFocusProvider,useGafferFocus} from "./src/components/gaffer/GafferFocus";
const listings=[
  {_id:"listing-a",slug:"sony-fx3",title:"Sony FX3 camera",category:"Cameras",heroImage:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240'%3E%3Crect width='320' height='240' fill='%23252b30'/%3E%3C/svg%3E",pricing:{daily:45},depositAmount:100,minimumRentalDays:1},
  {_id:"listing-b",slug:"sony-lens",title:"Sony 24–70mm lens",category:"Lenses",heroImage:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240'%3E%3Crect width='320' height='240' fill='%23252b30'/%3E%3C/svg%3E",pricing:{daily:18},depositAmount:50,minimumRentalDays:1},
  {_id:"listing-c",slug:"red-komodo",title:"RED Komodo Cinema Camera",category:"Cameras",heroImage:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240'%3E%3Crect width='320' height='240' fill='%23252b30'/%3E%3C/svg%3E",pricing:{daily:100},depositAmount:0,minimumRentalDays:1,bookable:false,displayOnly:false}
];
function Controls(){const {focus,suggest}=useGafferFocus();return <nav className="flex gap-2 p-4"><button id="suggest" onClick={()=>void suggest(["listing-a","listing-b"])}>Show Gaffer shortlist</button><button id="focus" onClick={()=>void focus("listing-b",0)}>Focus lens</button><button id="clear" onClick={()=>void focus(null,0)}>Clear focus</button></nav>}
createRoot(document.getElementById("root")).render(<GafferFocusProvider><Controls/><section className="grid grid-cols-2 gap-4 p-4">{listings.map(listing=><GearCard key={listing._id} listing={listing}/>)}</section></GafferFocusProvider>);`;

  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    outdir: path.join(root, ".tmp-gaffer-listing-badge-test"),
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "listing-badge-fixtures", setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.path === "@/components/gaffer/GafferFocus") return { path: path.join(root, "src/components/gaffer/GafferFocus.tsx") };
        if (mocks[args.path]) return { path: args.path, namespace: "fixture" };
      });
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: root, contents: mocks[args.path] }));
    } }],
  });
  const globalCss = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const css = `${globalCss.css}\n${bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}`;
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  assert(script, "the real gear card and Gaffer-focus components bundle");
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(script); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css); }
    response.setHeader("content-type", "text/html");
    response.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="margin:0;background:#101112;color:#eee;font:14px system-ui"><main style="max-width:880px;margin:24px auto;padding:12px"><h1 style="padding:0 16px">Gear shortlist</h1><div id="root"></div></main><script>window.addEventListener('error',event=>(window.errors??=[]).push(event.message))</script><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-gaffer-listing-badge-"));
  const attachedBrowser = !!process.env.DBC_CDP_URL;
  const chrome = attachedBrowser ? null : spawn(process.env.CHROME_BIN || "/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${process.env.CHROME_DEBUG_PORT || "0"}`, `--user-data-dir=${profile}`], { stdio: "ignore", detached: process.platform !== "win32" });
  let client;
  try {
    let port = process.env.CHROME_DEBUG_PORT || (attachedBrowser ? new URL(process.env.DBC_CDP_URL).port : undefined);
    for (let attempt = 0; !port && attempt < 100; attempt++) { try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "headless browser starts");
    if (!attachedBrowser) process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect();
    await client.cmd("Page.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`document.querySelectorAll('.gear-card').length===3`); attempt++) await wait(50);
    assert.equal(await client.evaluate(`document.querySelectorAll('.gaffer-pick-badge').length`), 0, "ordinary and marketing-only catalogue tiles show no Gaffer confirmation badge");
    const marketingTile = await client.evaluate(`(()=>{const card=document.querySelector('[data-listing-id="listing-c"]');return{href:card?.getAttribute('href'),text:card?.textContent?.replace(/\\s+/g,' ').trim()}})()`);
    assert.equal(marketingTile.href, "/gear/red-komodo", "marketing-only tiles link to details, not a booking action");
    assert(!marketingTile.text.includes("Request to confirm"), "the ambiguous customer-facing confirmation badge is removed for marketing-only listings");
    assert(marketingTile.text.includes("View details"), "a non-bookable marketing tile clearly offers details rather than choosing dates");
    await client.evaluate(`document.querySelector('#suggest').click()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`document.querySelectorAll('.gaffer-pick-badge').length===2`); attempt++) await wait(25);
    assert.deepEqual(await client.evaluate(`Array.from(document.querySelectorAll('.gaffer-pick-badge')).map(node=>node.textContent.trim())`), ["Suggested", "Suggested"], "a multi-item Gaffer shortlist labels only its selected tiles as suggestions");
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-gaffer-dimmed]').length`), 0, "a multi-item shortlist keeps every recommendation readable");
    await client.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }).then(result => fs.writeFileSync("/tmp/dbc-gaffer-listing-suggested.png", Buffer.from(result.data, "base64")));
    await client.evaluate(`document.querySelector('#focus').click()`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`document.querySelector('[data-listing-id="listing-b"]')?.getAttribute('data-gaffer-focus')==='true'`); attempt++) await wait(25);
    assert.equal(await client.evaluate(`document.querySelector('[data-listing-id="listing-a"] .gaffer-pick-badge')`), null, "focusing a different listing clears the prior shortlist badge");
    assert.equal(await client.evaluate(`document.querySelector('[data-listing-id="listing-b"] .gaffer-pick-badge')?.textContent.trim()`), "Gaffer's pick", "the focused listing is labelled as Gaffer's pick, not a renter confirmation requirement");
    assert.equal(await client.evaluate(`document.querySelectorAll('.gear-card')[0]?.getAttribute('data-gaffer-dimmed')`), "true", "only other tiles dim while Gaffer focuses one item");
    await client.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }).then(result => fs.writeFileSync("/tmp/dbc-gaffer-listing-badge.png", Buffer.from(result.data, "base64")));
    await client.evaluate(`document.querySelector('#clear').click()`);
    assert.equal(await client.evaluate(`document.querySelectorAll('.gaffer-pick-badge').length`), 0, "clearing Gaffer focus restores ordinary tiles");
    assert.deepEqual(await client.evaluate(`window.errors??[]`), []);
    console.log("PASS gear listing badges: Gaffer shortlist/focus states render accurate labels; no renter-confirmation badge appears. Screenshots: /tmp/dbc-gaffer-listing-suggested.png, /tmp/dbc-gaffer-listing-badge.png");
  } finally {
    try { await client?.close(); } catch {}
    if (chrome) {
      const exited = new Promise(resolve => chrome.once("exit", resolve));
      if (process.platform === "win32") chrome.kill("SIGTERM");
      else try { process.kill(-chrome.pid, "SIGTERM"); } catch {}
      await Promise.race([exited, wait(3000)]);
      if (chrome.exitCode === null) {
        if (process.platform === "win32") chrome.kill("SIGKILL");
        else try { process.kill(-chrome.pid, "SIGKILL"); } catch {}
        await Promise.race([exited, wait(1000)]);
      }
    }
    await new Promise(resolve => server.close(resolve));
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch { execFileSync("rm", ["-rf", "--", profile]); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
