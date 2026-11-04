const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), os = require("node:os"), path = require("node:path"), { spawn } = require("node:child_process");
const esbuild = require("esbuild"), postcss = require("postcss");
const source = fs.readFileSync("scripts/test-membership-browser.cjs", "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + "\nreturn connect;")(require);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const bundle = await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CompactRentalImages} from './src/components/admin/CompactRentalImages';const items=Array.from({length:10},(_,index)=>({listingId:'item-'+index,title:'Equipment '+index,heroImage:'/equipment-'+(index===9?0:index)+'.jpg',qty:index===1?2:1}));createRoot(document.getElementById('root')).render(<div style={{width:'min(100%,320px)',margin:'auto',padding:'12px'}}><button type="button">Fixture renter</button><CompactRentalImages items={items}/></div>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false });
  const items = Array.from({ length: 10 }, (_, index) => ({ listingId:`item-${index}`,title:index===0?"A deliberately long camera title to test the actual admin inbox layout":"Equipment "+index,heroImage:`/equipment-${index===9?0:index}.jpg`,qty:index===1?2:1 }));
  const rental = { _id:"fixture-rental",name:"Fixture renter",guestEmail:"fixture@example.invalid",status:"confirmed",items,unreadOwner:2,updatedAt:1,start:Date.UTC(2030,0,1),end:Date.UTC(2030,0,2),total:100 };
  const inboxBundle = await esbuild.build({ stdin: { contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {RentalInbox} from './src/components/admin/RentalInbox';createRoot(document.getElementById('root')).render(<RentalInbox token="synthetic-token"/>);`,resolveDir:process.cwd(),loader:"jsx" },bundle:true,write:false,outfile:"/tmp/dbc-inbox-fixture.js",plugins:[{name:"isolated-inbox",setup(build){
    build.onResolve({filter:/(_generated\/api|^convex\/react$|\/RentalKit$|\/RentalOrderTools$|\/AccountDocuments$|\/DroneLicence$|\/RentalConversation$)/},args=>({path:args.path,namespace:"fixture"}));
    build.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"jsx",contents:args.path.endsWith("_generated/api")?`const refs=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,name)=>String(group)+'.'+String(name)})});export const api=refs;`:args.path==="convex/react"?`export const useQuery=(ref)=>ref==='rentalChat.unreadTotals'?0:ref==='adminNotifications.latest'?[{_id:'system-alert',kind:'verification_failure',title:'Didit webhook rejected',body:'Synthetic warning',renterName:'System alert',rentalStage:'general'}]:null;export const usePaginatedQuery=(ref,args)=>({results:args==='skip'?[]:[${JSON.stringify(rental)}],status:'Exhausted',loadMore:()=>{}});export const useMutation=(ref)=>async(args)=>{if(ref==='adminNotifications.acknowledge')window.__acknowledged=args.id};export const useAction=useMutation;`:`export const RentalKit=()=>null,RentalOrderTools=()=>null,AccountDocuments=()=>null,AdminDroneLicence=()=>null,RentalConversation=()=>null;`}));
  }}] });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/inbox.js") { response.setHeader("content-type", "text/javascript"); return response.end(inboxBundle.outputFiles.find(file=>file.path.endsWith(".js")).text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css + (inboxBundle.outputFiles.find(file=>file.path.endsWith(".css"))?.text ?? "")); }
    if (request.url.startsWith("/equipment-")) { response.setHeader("content-type", "image/svg+xml"); return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#847d6c"/></svg>'); }
    response.setHeader("content-type", "text/html"); response.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:#111;color:white"><div id="root"></div><script src="${request.url==="/inbox"?"/inbox.js":"/bundle.js"}"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-compact-kit-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temporary}`], { stdio: "ignore" });
  let client;
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${temporary}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; client = await connect(); await client.cmd("Page.enable"); await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Booked equipment images\\"]")'); attempt++) await wait(100);
    for (const width of [320, 390, 1280]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: width < 768 }); await wait(200);
      const state = await client.evaluate(`(()=>{const strip=document.querySelector('[aria-label="Booked equipment images"]');strip.focus();return{images:[...strip.querySelectorAll('img')].map(image=>image.alt),sources:[...strip.querySelectorAll('img')].map(image=>image.getAttribute('src')),focus:document.activeElement===strip,scrollable:strip.scrollWidth>strip.clientWidth,overflow:document.documentElement.scrollWidth>innerWidth,quantity:strip.textContent.includes('×2')}})()`);
      assert.equal(state.images.length, 10); assert.equal(state.sources[0], state.sources[9]); assert.notEqual(state.images[0], state.images[9]); assert(state.focus && state.quantity && state.scrollable && !state.overflow);
      await client.evaluate('document.querySelector("[aria-label=\\"Booked equipment images\\"]").scrollLeft=0');
      await client.cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
      await client.cmd("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 }); await wait(300);
      assert(await client.evaluate('document.querySelector("[aria-label=\\"Booked equipment images\\"]").scrollLeft>0'), "Keyboard users can scroll the image strip");
      const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`/tmp/dbc-admin-compact-${width}.png`, Buffer.from(screenshot.data, "base64"));
    }
    for (const width of [390, 1280]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await client.cmd("Page.navigate", { url:`http://127.0.0.1:${server.address().port}/inbox` });
      for (let attempt = 0; attempt < 100 && !await client.evaluate('location.pathname === "/inbox" && document.querySelectorAll("[aria-label=\\"Booked equipment images\\"] img").length === 10'); attempt++) await wait(100);
      const state = await client.evaluate(`(()=>{const strip=document.querySelector('[aria-label="Booked equipment images"]');const button=[...document.querySelectorAll('button')].find(item=>item.textContent.includes('Fixture renter'));return{images:strip?.querySelectorAll('img').length,insideButton:!!strip?.closest('button'),button:!!button,overflow:document.documentElement.scrollWidth>innerWidth,longTitle:!!strip?.querySelector('img[alt^="A deliberately long"]')}})()`);
      assert.equal(state.images,10);assert(state.button&&!state.insideButton&&!state.overflow&&state.longTitle);
      await client.evaluate(`[...document.querySelectorAll('button')].find(item=>item.textContent.includes('Needs your attention')).click()`);await wait(100);
      const systemAlert=await client.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent.includes('Didit webhook rejected'));return {text:button?.textContent,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
      assert.match(systemAlert.text,/System alert/);assert.match(systemAlert.text,/Select to mark read/);assert(!systemAlert.text.includes('General support')&&!systemAlert.overflow);
      const alertScreenshot=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`/tmp/dbc-admin-system-alert-${width}.png`,Buffer.from(alertScreenshot.data,'base64'));
      await client.evaluate(`[...document.querySelectorAll('button')].find(item=>item.textContent.includes('Didit webhook rejected')).click()`);await wait(100);assert.equal(await client.evaluate('window.__acknowledged'),'system-alert');
      await client.evaluate(`(()=>{const strip=document.querySelector('[aria-label="Booked equipment images"]');strip.focus();strip.scrollLeft=0})()`);
      await client.cmd("Input.dispatchKeyEvent",{type:"keyDown",key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39});await client.cmd("Input.dispatchKeyEvent",{type:"keyUp",key:"ArrowRight",code:"ArrowRight",windowsVirtualKeyCode:39});await wait(300);
      assert(await client.evaluate(`document.querySelector('[aria-label="Booked equipment images"]').scrollLeft>0`),"Inbox strip responds to the keyboard");
      const screenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync(`/tmp/dbc-admin-inbox-${width}.png`,Buffer.from(screenshot.data,"base64"));
      await client.evaluate(`[...document.querySelectorAll('button')].find(item=>item.textContent.includes('Fixture renter')).click()`);await wait(100);
      assert.equal(await client.evaluate(`[...document.querySelectorAll('button')].find(item=>item.textContent.includes('Fixture renter')).getAttribute('aria-current')`),"true");
    }
    console.log("PASS actual compact rental images: shared photos retain distinct listing names, quantities and focusable horizontal scrolling at 320/390/1280px. Synthetic data only.");
  } finally { if (client) client.close(); if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; } server.close(); await wait(300); await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
