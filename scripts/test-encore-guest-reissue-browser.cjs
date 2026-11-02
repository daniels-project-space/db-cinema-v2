const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(__dirname,'test-membership-browser.cjs'),'utf8');
const connect=new Function('require',source.slice(0,source.indexOf('const { ConvexHttpClient }'))+';return connect;')(require);
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-guest-claim-'));
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import AccountAccess from './src/app/account/access/page';window.calls=[];createRoot(document.getElementById('root')).render(<AccountAccess/>);`;
 await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:path.join(directory,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'guest-fixture',setup(build){
  build.onResolve({filter:/^(convex\/react$|@cvx\/_generated\/api$|next\/link$|@\/components\/account\/AccountProvider$)/},args=>({path:args.path,namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:root,contents:args.path==='convex/react'?`const reject=async()=>{throw {data:{code:'ACCESS_LINK_EXPIRED'}}};const request=async args=>{window.calls.push(args);return {ok:true}};export const useAction=()=>reject,useMutation=()=>request;`:args.path==='@cvx/_generated/api'?`export const api=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>String(group)+'.'+String(method)})});`:args.path==='next/link'?`import React from 'react';export default function Link({children,href}){return <a href={href}>{children}</a>}`:`export const useAccount=()=>({acceptSession:()=>{}});`}));
 }}]});
 const server=http.createServer((request,response)=>{if(request.url==='/fixture.js'){response.setHeader('Content-Type','application/javascript');response.end(fs.readFileSync(path.join(directory,'fixture.js')))}else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let client;
 try{
  client=await connect('about:blank');await client.cmd('Page.enable');await client.cmd('Runtime.enable');await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?claim=booking-fixture#expired-secret`});
  for(let attempts=0;attempts<100&&!(await client.evaluate(`!!document.querySelector('input[type=email]')`));attempts++)await wait(100);
  await client.evaluate(`(()=>{const field=document.querySelector('input[type=email]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'fixture@example.invalid');field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await client.evaluate(`document.querySelector('form').requestSubmit()`);await wait(100);
  assert.deepEqual(await client.evaluate('window.calls'),[{bookingId:'booking-fixture',email:'fixture@example.invalid'}]);
  assert.equal(await client.evaluate(`document.body.textContent.includes('If this rental can be claimed')`),true,'reissue confirmation does not disclose account existence');
  assert.equal(await client.evaluate('window.location.hash'),'', 'the old secret is removed from the address bar');
  console.log('PASS guest reissue browser: expired-link form uses exact booking/email, removes the secret and gives a non-enumerating response.');
 }finally{if(client){client.close();await fetch(`${process.env.DBC_CDP_URL||'http://localhost:9224'}/json/close/${client.tabId}`)}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
