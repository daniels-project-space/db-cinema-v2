const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http'), os = require('node:os'), path = require('node:path'), {spawn} = require('node:child_process');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const helper = fs.readFileSync(path.join(root, 'scripts/test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', helper.slice(0, helper.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const bundle = await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import AccountAccess from './src/app/account/access/page';createRoot(document.getElementById('root')).render(<AccountAccess/>);`,resolveDir:root,loader:'jsx'},bundle:true,write:false,plugins:[{name:'fixture',setup(build){
    build.onResolve({filter:/^(convex\/react|@cvx\/_generated\/api|@\/components\/account\/AccountProvider|next\/link)$/},args=>({path:args.path,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'jsx',resolveDir:root,contents:args.path==='convex/react'?`export function useAction(){return async ({secret})=>{sessionStorage.setItem('exchanged',secret);return {token:'synthetic-session'}}}`:args.path.includes('_generated/api')?`export const api={accountAccess:{exchange:'exchange'}}`:args.path.includes('AccountProvider')?`export function useAccount(){return {acceptSession:token=>sessionStorage.setItem('accepted',token)}}`:`import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`}));
  }}]});
  const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('content-type','application/javascript');return res.end(bundle.outputFiles[0].text)}res.setHeader('content-type','text/html; charset=utf-8');res.end(req.url.startsWith('/account/access')?'<div id="root"></div><script src="/bundle.js"></script>':'<main>Account destination</main>')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-confirm-chat-'));
  const chrome=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${dir}`],{stdio:'ignore'});let client;
  try {
    let port;for(let attempt=0;attempt<100;attempt++){try{port=fs.readFileSync(dir+'/DevToolsActivePort','utf8').split('\n')[0];break}catch{await wait(100)}}assert(port);process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;
    client=await connect();await client.cmd('Page.enable');
    for(const [query, expected] of [['?next=chat&rental=synthetic-booking','?rental=synthetic-booking#chat'],['?next=chat','?conversation=general#chat']]){
      await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/account/access${query}#synthetic-secret`});
      for(let attempt=0;attempt<100;attempt++){if(await client.evaluate('location.pathname === "/account"'))break;await wait(50)}
      assert.equal(await client.evaluate('location.search+location.hash'),expected);
      assert.equal(await client.evaluate('sessionStorage.getItem("exchanged")'),'synthetic-secret');
      assert.equal(await client.evaluate('sessionStorage.getItem("accepted")'),'synthetic-session');
      assert(!await client.evaluate('location.href.includes("synthetic-secret")'),'private access secret does not persist in destination');
    }
    console.log('PASS account access browser: rental and general chat retain context after secure session exchange; synthetic data only.');
  } finally {if(client)client.close();server.close();chrome.kill('SIGTERM');await wait(100);fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
})().catch(error=>{console.error(error);process.exitCode=1});
