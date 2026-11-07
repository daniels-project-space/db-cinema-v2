const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{RestrictedIdentityAlertFailures}from'./src/components/admin/RestrictedIdentityAlertFailures';window.__calls=[];createRoot(document.getElementById('root')).render(<RestrictedIdentityAlertFailures token="fixture-admin" onOpen={id=>window.__opened=id}/>);`;
const mocks = { name: "restricted-panel-fixture", setup(build) {
  build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api)$/ }, args => ({ path: args.path, namespace: "fixture" }));
  build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "convex/react"
    ? `export function useQuery(name){return name==='attention'?[{id:'job-1',bookingId:'booking-12345678',attempts:1}]:[{id:'job-2',accountId:'account-98765432',attempts:3}]};export function useMutation(name){return async args=>{window.__calls.push({name,args});if(window.__reject)throw Error('fixture')}};`
    : `export const api={restrictedIdentityAlerts:{attention:'attention',recheckAttention:'recheckAttention',retry:'retry',retryRecheck:'retryRecheck'}};`, loader: "js" }));
} };

(async () => {
  const bundle = await esbuild.build({ stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [mocks], define: { "process.env.NODE_ENV": '"production"' } });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root,"src/app/globals.css"),"utf8"), { from: path.join(root,"src/app/globals.css") });
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:#101010;color:#eee"><main id="root" style="max-width:980px;margin:32px auto;padding:0 16px"></main><script src="/bundle.js"></script></body></html>';
  const server = http.createServer((request,response) => { const files = { "/": ["text/html",html], "/style.css": ["text/css",css.css], "/bundle.js": ["text/javascript",bundle.outputFiles[0].text] }; const file=files[new URL(request.url,"http://localhost").pathname];response.writeHead(file?200:404,{"Content-Type":file?.[0]??"text/plain"});response.end(file?.[1]??"Not found"); });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"dbc-identity-panel-"));
  const chrome=spawn("/opt/google/chrome/chrome",["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${directory}`,"about:blank"],{stdio:"ignore"});
  let client;
  try {
    let port;for(let attempt=0;attempt<100;attempt++){try{port=fs.readFileSync(path.join(directory,"DevToolsActivePort"),"utf8").split("\n")[0];break;}catch{await wait(100);}}
    assert(port);process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;client=await connect();await client.cmd("Page.enable");await client.cmd("Runtime.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride",{width:1100,height:650,deviceScaleFactor:1,mobile:false});await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/`});
    for(let attempt=0;attempt<50&&!await client.evaluate('!!document.querySelector("section[aria-label]")');attempt++)await wait(100);
    assert.match(await client.evaluate('document.querySelector("section").innerText'),/2 pending/);
    assert.match(await client.evaluate('document.querySelector("section").innerText'),/Verification was not stopped/);
    assert.equal(await client.evaluate('Array.from(document.querySelectorAll("button")).every(button=>button.type==="button" && button.textContent.trim())'),true);
    const shot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-identity-alerts-desktop.png",Buffer.from(shot.data,"base64"));
    await client.evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="Open rental").click()');
    assert.equal(await client.evaluate("window.__opened"),"booking-12345678");
    await client.evaluate('window.__reject=true;Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="Retry check").click()');await wait(50);
    assert.match(await client.evaluate('document.querySelector("[role=alert]")?.textContent'),/could not be retried/);
    assert.equal(await client.evaluate("window.__calls[0].name"),"retry");
    await client.cmd("Emulation.setDeviceMetricsOverride",{width:375,height:812,deviceScaleFactor:1,mobile:true});await wait(100);
    assert.equal(await client.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,"The panel does not overflow on mobile");
    assert.equal(await client.evaluate('Array.from(document.querySelectorAll("button")).every(button=>{const box=button.getBoundingClientRect();return box.width>=44&&box.height>=44})'),true,"All actions have at least 44 × 44 pixel touch targets");
    const mobile=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-identity-alerts-mobile.png",Buffer.from(mobile.data,"base64"));
    console.log("PASS identity alert panel: desktop/mobile layout, readable warning, button labels, navigation and retry error; synthetic data only.");
  } finally {if(client){client.close();await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`).catch(()=>{});}if(chrome.exitCode===null){const exited=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill();await exited;}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await wait(300);await fs.promises.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
})().catch(error=>{console.error(error);process.exitCode=1});
