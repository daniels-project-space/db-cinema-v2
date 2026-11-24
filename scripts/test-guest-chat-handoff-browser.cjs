const assert = require('node:assert/strict');
const fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path'), esbuild = require('esbuild');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-guest-handoff-'));
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, chrome, browser;
async function main() {
  const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{GuestChatHandoff}from'./src/components/account/GuestChatHandoff';function App(){const [account,setAccount]=useState('a');return <><button onClick={()=>setAccount('b')}>Switch account</button><GuestChatHandoff key={account} token={account} email={account+'@example.invalid'}/></>}createRoot(document.getElementById('root')).render(<App/>);`;
  const mocks = { 'convex/react': `export const useMutation=()=>async value=>{window.calls.push(value);if(window.fail)throw Error('offline');if(window.pause)await new Promise(resolve=>window.resume=resolve)};`, '@cvx/_generated/api': `export const api={chat:{importGuestHistory:'import'}};` };
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', plugins: [{name:'fixture',setup(build){build.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:mocks[args.path]}));}}] });
  server = http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles[0].text)}res.setHeader('content-type','text/html');res.end('<meta name="viewport" content="width=device-width"><div id="root"></div><script>window.calls=[];window.addEventListener("dbc:open-renter-notifications",()=>window.opened=true)</script><script src="/bundle.js"></script>')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=path.join(directory,'chrome');chrome=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{stdio:'ignore'});
  let port;for(let i=0;i<100;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break}catch{await sleep(100)}}
  assert(port);process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;browser=await connect();await browser.cmd('Page.enable');await browser.cmd('Runtime.enable');
  await browser.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('dbc_guest_chat_handoff_v1',JSON.stringify({requestId:'guest_1234567890123456',transcript:'Guest: My question'}))`});
  await browser.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
  for(let i=0;i<100&&!await browser.evaluate('!!document.querySelector("section")');i++)await sleep(50);
  assert(await browser.evaluate('!!document.querySelector("section")'), await browser.evaluate('document.body.innerText'));
  assert.match(await browser.evaluate('document.querySelector("section").textContent'),/a@example.invalid/);
  assert.equal(await browser.evaluate('window.calls.length'),0,'No import before explicit confirmation');
  await browser.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Not now").click()');
  assert.equal(await browser.evaluate('!!localStorage.getItem("dbc_guest_chat_handoff_v1")'),true,'Cancel preserves the handoff');
  await browser.cmd('Page.reload');await sleep(200);
  await browser.evaluate('window.fail=true;Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Save and")).click()');await sleep(100);
  assert.equal(await browser.evaluate('!!document.querySelector("[role=alert]")'),true);
  assert.equal(await browser.evaluate('!!localStorage.getItem("dbc_guest_chat_handoff_v1")'),true,'Failure preserves the handoff');
  await browser.evaluate('window.fail=false;window.pause=true;Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Save and")).click()');await sleep(100);
  await browser.evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Switch account").click();window.resume()');await sleep(100);
  assert.equal(await browser.evaluate('!!localStorage.getItem("dbc_guest_chat_handoff_v1")'),true,'Account switch preserves handoff after an old request');
  assert.match(await browser.evaluate('document.querySelector("section").textContent'),/b@example.invalid/);
  await browser.evaluate('window.pause=false;Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Save and")).click()');await sleep(100);
  assert.equal(await browser.evaluate('localStorage.getItem("dbc_guest_chat_handoff_v1")'),null);
  assert.equal(await browser.evaluate('window.opened'),true,'Only a successful transfer opens the alert setup');
  console.log('PASS guest handoff browser: explicit confirmation, cancel, retry, account switch, and alert setup.');
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{if(browser){try{await Promise.race([browser.cmd('Browser.close'),sleep(1000)])}catch{}try{browser.close()}catch{}}if(chrome){chrome.kill();await sleep(300)}if(server)server.closeAllConnections(),server.close();try{fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100})}catch{}});
