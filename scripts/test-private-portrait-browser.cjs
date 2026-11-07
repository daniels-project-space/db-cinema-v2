const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict"), esbuild = require("esbuild");
const { spawn } = require("node:child_process");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
setMock("./lib/accountVerificationReady", { accountVerificationReady: async () => true });
setMock("./verificationArchive", { archiveRetention: async () => ({ viewable: true }), documentCopyAvailable: async () => true });
const portrait = load("convex/privateVerificationPortrait.ts"), ctx = { db }, now = Date.now();
const account = put("accounts", { email: "fixture@example.invalid", createdAt: now - 90000000 });
const other = put("accounts", { email: "other@example.invalid", createdAt: now - 90000000 });
put("sessions", { token: "fixture-session", accountId: account._id, expiresAt: now + 600000 });
put("sessions", { token: "other-session", accountId: other._id, expiresAt: now + 600000 });
const booking = put("bookings", { accountId: account._id, diditSessionId: "fixture-verification" });
account.rentalVerification = { sourceBookingId: booking._id };
const archive = put("verification_archives", { accountId: account._id, bookingId: booking._id, sessionId: "fixture-verification", status: "complete" });
const document = put("verification_documents", { accountId: account._id, bookingId: booking._id, archiveId: archive._id, kind: "selfie-0-reference_image", contentType: "image/png" });
process.env.ADMIN_TOKEN = "fixture-admin";
process.env.PRIVATE_VERIFICATION_PHOTO_ENABLED = "true";
delete process.env.PRIVATE_VERIFICATION_PHOTO_NOTICE_ENABLED;
const source = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-private-portrait-"));
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {PrivatePortraitPreference} from './src/components/account/PrivatePortraitPreference';import {PrivateVerificationPortrait} from './src/components/admin/PrivateVerificationPortrait';const root=createRoot(document.getElementById('root'));window.renderFixture=(token,id)=>root.render(<><div id="account"><PrivatePortraitPreference token={token}/></div><div id="admin"><PrivateVerificationPortrait token="fixture-admin" accountId={id}/></div></>);window.renderFixture('fixture-session',${JSON.stringify(account._id)});`;
  await esbuild.build({ stdin: { contents: entry, resolveDir: path.resolve(__dirname, ".."), loader: "tsx" }, outfile: path.join(directory, "fixture.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_CONVEX_SITE_URL": '"."' }, plugins: [{ name: "fixture", setup(build) {
    build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|next\/link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: path.resolve(__dirname, ".."), contents: args.path === "convex/react" ? `import {useEffect,useState} from 'react';export function useQuery(name,args){const key=JSON.stringify([name,args]);const [state,setState]=useState({key:'',value:undefined});useEffect(()=>{let live=true;async function refresh(){const r=await fetch('/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});const value=await r.json();if(live)setState({key,value})}refresh();const timer=setInterval(refresh,80);return()=>{live=false;clearInterval(timer)}},[key]);return state.key===key?state.value:undefined}export function useMutation(name){return async args=>{const r=await fetch('/mutation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});if(!r.ok)throw Error('Failed')}}` : args.path === "next/link" ? `import React from 'react';export default function Link({href,children}){return <a href={href}>{children}</a>}` : `export const api=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>group+'.'+method})});` }));
  } }] });
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); response.end(fs.readFileSync(path.join(directory, "fixture.js"))); return; }
      if (request.url === "/enable-notice") { process.env.PRIVATE_VERIFICATION_PHOTO_NOTICE_ENABLED = "true"; response.end("ok"); return; }
      if (request.url === "/admin-private-portrait") {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const requested = JSON.parse(Buffer.concat(chunks).toString());
        const selected = await portrait.selected.handler(ctx, { token: (request.headers.authorization || "").replace(/^Bearer /, ""), accountId: account._id, refresh: 0 });
        if (!selected || selected.documentId !== requested.documentId) { response.writeHead(403); response.end(); return; }
        response.setHeader("Content-Type", "image/png"); response.end(pixel); return;
      }
      if (request.url === "/query" || request.url === "/mutation") {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const { name, args } = JSON.parse(Buffer.concat(chunks).toString());
        const handler = name === "privateVerificationPortrait.preference" ? portrait.preference : name === "privateVerificationPortrait.selected" ? portrait.selected : name === "privateVerificationPortrait.setPreference" ? portrait.setPreference : null;
        if (!handler) throw Error("Unexpected fixture request");
        const value = await handler.handler(ctx, args); response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value ?? null)); return;
      }
      response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script>');
    } catch { response.writeHead(400); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = path.join(directory, "chrome-profile");
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let client;
  async function until(expression) { for (let attempt = 0; attempt < 100; attempt++) { if (await client.evaluate(expression)) return; await wait(50); } throw Error(`Timed out: ${expression}`); }
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "Headless Chrome starts for the isolated fixture"); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect("about:blank"); await client.cmd("Page.enable"); await client.cmd("Runtime.enable");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` }); await wait(400);
    assert.equal(await client.evaluate(`!!document.querySelector('#account section')`), false, "Feature-off hides the choice");
    assert.equal(await client.evaluate(`!!document.querySelector('#admin img')`), false, "No portrait before consent");
    await client.evaluate(`fetch('/enable-notice')`);
    await until(`document.querySelector('#account')?.textContent.includes('Current choice: Not allowed')`);
    await client.evaluate(`[...document.querySelectorAll('#account button')].find(x=>x.textContent==='Allow private use').click()`);
    await until(`document.querySelector('#account')?.textContent.includes('Current choice: Allowed')`);
    await until(`!!document.querySelector('#admin img[alt="Private verification portrait"]')`);
    await client.evaluate(`window.renderFixture('other-session',${JSON.stringify(other._id)})`);
    await until(`document.querySelector('#account')?.textContent.includes('Current choice: Not allowed') && !document.querySelector('#admin img')`);
    await client.evaluate(`window.renderFixture('fixture-session',${JSON.stringify(account._id)})`);
    await until(`!!document.querySelector('#admin img') && document.querySelector('#account')?.textContent.includes('Current choice: Allowed')`);
    await client.evaluate(`[...document.querySelectorAll('#account button')].find(x=>x.textContent==='Withdraw permission').click()`);
    await until(`document.querySelector('#account')?.textContent.includes('Current choice: Not allowed') && !document.querySelector('#admin img')`);
    assert.equal(other.privateVerificationPortraitConsentVersion, undefined, "Choice remains bound to the authenticated account");
    assert.equal(account.privateVerificationPortraitConsentVersion, undefined, "Withdrawal removes consent");
    console.log("PASS private portrait browser: feature-off, authenticated consent, private display, account switch and withdrawal; local synthetic fixtures only");
  } finally {
    if (client) { client.close(); await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`); }
    if (chrome.exitCode === null) { const exited = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await exited; }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
