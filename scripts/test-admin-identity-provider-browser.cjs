const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{AdminIdentityProvider}from'./src/components/admin/AdminIdentityProvider';let current=null;const listeners=new Set();window.__set=(token,jwt,expiresAt=Date.now()+60000)=>{current=token?{token,expiresAt,headers:{Authorization:'Bearer '+jwt,'X-DBC-Admin-Session':token}}:null;window.__jwt=jwt;listeners.forEach(fn=>fn())};const controller={current:()=>current&&current.expiresAt>Date.now()?current:null,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},fetchAccessToken:async()=>current?window.__jwt:null};createRoot(document.getElementById('root')).render(<AdminIdentityProvider controller={controller} client={{}}><div id="protected">Private admin area</div></AdminIdentityProvider>);`;
const mocks = { name: "provider-fixture", setup(build) {
  build.onResolve({ filter: /^convex\/react$/ }, () => ({ path: "convex/react", namespace: "fixture" }));
  build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `import React,{createContext,useContext,useEffect,useState}from'react';const C=createContext(false);export function ConvexProviderWithAuth({useAuth,children}){const auth=useAuth();const[confirmed,setConfirmed]=useState(false);useEffect(()=>{let active=true;setConfirmed(false);if(auth.isAuthenticated)auth.fetchAccessToken({forceRefreshToken:false}).then(jwt=>{window.__lastJwt=jwt;if(active)setConfirmed(!!jwt&&window.__backendAccepts!==false)});return()=>{active=false}},[auth.isAuthenticated,auth.fetchAccessToken,useAuth]);return <C.Provider value={confirmed}>{children}</C.Provider>};export function Authenticated({children}){return useContext(C)?children:null}`, loader: "jsx", resolveDir: root }));
} };

(async () => {
  const bundle=await esbuild.build({stdin:{contents:fixture,resolveDir:root,loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",plugins:[mocks],define:{"process.env.NODE_ENV":'"production"'}});
  const server=http.createServer((request,response)=>{const js=request.url==="/bundle.js";response.writeHead(200,{"Content-Type":js?"text/javascript":"text/html"});response.end(js?bundle.outputFiles[0].text:'<!doctype html><main id="root"></main><script src="/bundle.js"></script>');});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"dbc-admin-provider-"));
  const chrome=spawn("/opt/google/chrome/chrome",["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${directory}`,"about:blank"],{stdio:"ignore"});
  let client;
  try {
    let port;for(let attempt=0;attempt<100;attempt++){try{port=fs.readFileSync(path.join(directory,"DevToolsActivePort"),"utf8").split("\n")[0];break;}catch{await wait(100);}}
    assert(port);process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;client=await connect();await client.cmd("Page.enable");await client.cmd("Runtime.enable");await client.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/`});
    for(let attempt=0;attempt<50&&!await client.evaluate("typeof window.__set==='function'");attempt++)await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("#protected")'),false);
    await client.evaluate("window.__set('session-a','jwt-a')");await wait(80);
    assert.equal(await client.evaluate('!!document.querySelector("#protected")'),true);
    assert.equal(await client.evaluate('window.__lastJwt'),"jwt-a");
    await client.evaluate("window.__backendAccepts=false;window.__set('session-b','jwt-b')");await wait(80);
    assert.equal(await client.evaluate('!!document.querySelector("#protected")'),false,"An unconfirmed identity never renders admin children");
    assert.equal(await client.evaluate('window.__lastJwt'),"jwt-b");
    await client.evaluate("window.__backendAccepts=true;window.__set('session-c','jwt-c',Date.now()+120)");await wait(50);
    assert.equal(await client.evaluate('!!document.querySelector("#protected")'),true);
    await wait(150);assert.equal(await client.evaluate('!!document.querySelector("#protected")'),false,"Expired sessions hide protected children");
    await client.evaluate("window.__set(null,null)");await wait(30);assert.equal(await client.evaluate('!!document.querySelector("#protected")'),false);
    console.log("PASS isolated admin identity provider: unauthenticated, switch, backend denial, expiry and logout rendering; Convex identity mocked.");
  } finally {if(client){client.close();await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`).catch(()=>{});}if(chrome.exitCode===null){const exited=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill();await exited;}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await wait(300);await fs.promises.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
})().catch(error=>{console.error(error);process.exitCode=1});
