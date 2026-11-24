const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), os = require("node:os"), path = require("node:path"), esbuild = require("esbuild");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const helper = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", helper.slice(0, helper.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const stubs = {
  "next/link": `import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
  "convex/react": `export const useQuery=()=>({});export const useAction=ref=>async args=>{window.calls.push({ref,args});if(ref==='accountCodes.verify')return{setupToken:'verified-token'};if(ref==='accountCodes.complete')throw Error('fixture completion blocked');return{challenge:'challenge'}}`,
  "@cvx/_generated/api": `export const api=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>group+'.'+method})})`,
  "@/components/account/AccountProvider": `export const useAccount=()=>({acceptSession(){}})`,
  "@/components/SiteHeader": `import React from 'react';export const SiteHeader=()=> <header>DB CINEMA</header>`,
};

(async () => {
  const bundle = await esbuild.build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import AccountSetup from './src/app/account/setup/page';createRoot(document.getElementById('root')).render(<AccountSetup/>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NEXT_PUBLIC_CONVEX_URL": '"https://synthetic.convex.cloud"', "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "setup-stubs", setup(build) { build.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: "fixture" } : undefined); build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: root, contents: stubs[args.path] })); } }] });
  const css = await require("postcss")([require("@tailwindcss/postcss")({ base: root })]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}body{background:#090909;color:white;margin:0}</style><div id="root"></div><script>window.calls=[];window.fetch=async(url,opts)=>{window.previewRequest={url,authorization:opts.headers.Authorization};const data=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=');return new Response(new Blob([Uint8Array.from(data,c=>c.charCodeAt(0))],{type:'image/png'}),{status:200})}</script><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-signup-photo-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let browser;
  try {
    let port; for (let attempt = 0; attempt < 100 && !port; attempt++) { try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { await wait(100); } }
    assert(port); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; browser = await connect();
    await browser.cmd("Page.enable"); await browser.cmd("Runtime.enable");
    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?challenge=fixture&purpose=setup` });
    const until = async expression => { for (let attempt = 0; attempt < 100; attempt++) { if (await browser.evaluate(expression)) return; await wait(50); } throw Error(`Timed out: ${expression}`); };
    await until(`!!document.querySelector('input[aria-label="One-time code"]')`);
    await browser.evaluate(`(()=>{const input=document.querySelector('input[aria-label="One-time code"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'123456');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form').requestSubmit()})()`);
    await until(`!!document.querySelector('img[alt="Proposed account profile"]')`);
    await until(`document.querySelector('img[alt="Proposed account profile"]')?.naturalWidth>0`);
    assert.equal(await browser.evaluate(`window.previewRequest.authorization`), "Bearer verified-token", "the preview uses the verified token, never the unverified challenge");
    assert.equal(await browser.evaluate(`document.querySelector('img[alt="Proposed account profile"]').previousElementSibling.checked`), false, "the verified owner must opt in to the proposed photo");
    assert.match(await browser.evaluate(`document.body.innerText`), /Public reviews show it only if I choose to share it/);
    assert.equal(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth`), true, "the consent view fits a phone");
    fs.writeFileSync("/tmp/dbc-signup-pending-photo-390.png", Buffer.from((await browser.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await browser.evaluate(`(()=>{for(const selector of ['input[aria-label="New password"]','input[aria-label="Confirm password"]']){const input=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'FixturePassword8');input.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('input[aria-label="Agree to Terms and Conditions and Privacy Notice"]').click()})()`);
    await wait(100);await browser.evaluate(`document.querySelector('form').requestSubmit()`);
    await until(`window.calls.some(call=>call.ref==='accountCodes.complete')`);
    assert.equal(await browser.evaluate(`window.calls.filter(call=>call.ref==='accountCodes.complete').at(-1).args.acceptPendingAvatar`), false, "completion without photo consent discards the proposed image");
    await until(`!!document.querySelector('[role="alert"]')`);
    await browser.evaluate(`document.querySelector('img[alt="Proposed account profile"]').previousElementSibling.click()`);await wait(100);
    await browser.evaluate(`document.querySelector('form').requestSubmit()`);
    await until(`window.calls.filter(call=>call.ref==='accountCodes.complete').length===2`);
    assert.equal(await browser.evaluate(`window.calls.filter(call=>call.ref==='accountCodes.complete').at(-1).args.acceptPendingAvatar`), true, "only an explicit checkbox selection authorizes attachment");
    console.log("PASS signup photo browser: verified preview, explicit opt-in, privacy copy and mobile layout.");
  } finally {
    browser?.close(); if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; } await new Promise(resolve => server.close(resolve)); await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
