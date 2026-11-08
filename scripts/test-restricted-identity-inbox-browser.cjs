const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
const membershipBrowser = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", membershipBrowser.slice(0, membershipBrowser.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
const fixture = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{PossibleRestrictedIdentityMatch}from'./src/components/admin/PossibleRestrictedIdentityMatch';window.__queryCalls=[];window.__mutationCalls=0;window.__syntheticAccount={id:'synthetic-renter',membership:'guest'};window.__syntheticBooking={id:'synthetic-booking',status:'confirmed'};window.__initialSnapshot=JSON.stringify([window.__syntheticAccount,window.__syntheticBooking]);function App(){const[mode,setMode]=useState('unapproved');window.__setMode=next=>setMode(()=>{window.__mode=next;return next});window.__mode=mode;return <main><p data-testid="approval-state">{mode==='unapproved'?'Verification pending':'Verification approved'}</p>{mode!=='unapproved'&&<PossibleRestrictedIdentityMatch token="synthetic-admin-token" bookingId="synthetic-booking" onOpenAccount={id=>{window.__opened=id}}/>}</main>}createRoot(document.getElementById('root')).render(<App/>);`;
const mocks = { name: "restricted-inbox-fixture", setup(build) {
  build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|@cvx\/_generated\/dataModel)$/ }, args => ({ path: args.path, namespace: "fixture" }));
  build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "convex/react"
    ? `export function useQuery(name,args){window.__queryCalls.push({name,args});return window.__mode==='match'?{matches:[{id:'synthetic-restricted-account',name:'Sam Example',email:'sam@example.invalid',blockedReason:'Synthetic policy test'}],more:false}:{matches:[],more:false}};export function useMutation(){window.__mutationCalls++;return ()=>{window.__mutationCalls++}};`
    : args.path.endsWith("dataModel") ? "export type Id<T extends string=string>=string;"
    : `export const api={accountAdmin:{possibleRestrictedIdentityMatches:'possibleRestrictedIdentityMatches'}};`, loader: "js" }));
} };

(async () => {
  const inboxSource = fs.readFileSync(path.join(root, "src/components/admin/RentalInbox.tsx"), "utf8");
  const panelSource = fs.readFileSync(path.join(root, "src/components/admin/PossibleRestrictedIdentityMatch.tsx"), "utf8");
  assert.match(inboxSource, /"idVerifyStatus" in focus && focus\.idVerifyStatus === "verified" && <PossibleRestrictedIdentityMatch/);
  assert.match(inboxSource, /function openMatchedAccountChat\(accountId: string\)[\s\S]*?setStage\("general"\)[\s\S]*?setSelected\(accountId\)[\s\S]*?ownerConversationUrl\(\{ accountId \}\)/);
  assert.doesNotMatch(panelSource, /useMutation|useAction|api\.[\w.]+\.(?:mutation|action)/, "The match panel must be read-only");
  const bundle = await esbuild.build({ stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [mocks], define: { "process.env.NODE_ENV": '"production"' } });
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#101010;color:#eee"><main id="root"></main><script src="/bundle.js"></script></body></html>';
  const server = http.createServer((request, response) => { const file = new URL(request.url, "http://localhost").pathname === "/bundle.js" ? ["text/javascript", bundle.outputFiles[0].text] : ["text/html", html]; response.writeHead(200, { "Content-Type": file[0] }); response.end(file[1]); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-restricted-inbox-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${directory}`, "about:blank"], { stdio: "ignore" });
  let client;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(path.join(directory, "DevToolsActivePort"), "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "Headless browser did not start");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect();
    await client.cmd("Page.enable");
    await client.cmd("Runtime.enable");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 50 && !await client.evaluate('!!document.querySelector("[data-testid=approval-state]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('document.querySelector("[data-testid=approval-state]").textContent'), "Verification pending");
    assert.equal(await client.evaluate('document.querySelector("[data-testid=possible-restricted-identity-match]")'), null);
    assert.equal(await client.evaluate("window.__queryCalls.length"), 0, "Unapproved verification must not query candidate context");

    await client.evaluate('window.__setMode("match")');
    for (let attempt = 0; attempt < 50 && !await client.evaluate('!!document.querySelector("[data-testid=possible-restricted-identity-match]")'); attempt++) await wait(100);
    const matchText = await client.evaluate('document.querySelector("[data-testid=possible-restricted-identity-match]").innerText');
    assert.match(matchText, /Possible restricted-account match/);
    assert.match(matchText, /lead, not proof/);
    assert.match(matchText, /no booking was blocked/);
    assert.match(matchText, /Sam Example/);
    assert.match(matchText, /Synthetic policy test/);
    assert.equal(await client.evaluate("window.__queryCalls.at(-1).args.token"), "synthetic-admin-token");
    assert.equal(await client.evaluate("window.__queryCalls.at(-1).args.bookingId"), "synthetic-booking");
    await client.evaluate('document.querySelector("[data-testid=open-matched-account-chat]").click()');
    assert.equal(await client.evaluate("window.__opened"), "synthetic-restricted-account", "Compare action opens the matching account");

    await client.evaluate('window.__setMode("no-match")');
    await wait(50);
    assert.equal(await client.evaluate('document.querySelector("[data-testid=possible-restricted-identity-match]")'), null, "No-match state stays quiet");
    assert.equal(await client.evaluate("window.__mutationCalls"), 0, "No account or booking mutation was called");
    assert.equal(await client.evaluate("JSON.stringify([window.__syntheticAccount,window.__syntheticBooking])===window.__initialSnapshot"), true, "Synthetic account and booking remain unchanged");
    console.log("PASS restricted-match inbox browser: unapproved hidden, matched lead visible, no-match quiet, compare navigates, no mutation; synthetic fixture only.");
  } finally {
    if (client) { client.close(); await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`).catch(() => {}); }
    if (chrome.exitCode === null) { const exited = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await exited; }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await wait(250);
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
