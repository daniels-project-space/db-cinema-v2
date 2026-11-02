const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(__dirname,'test-membership-browser.cjs'),'utf8');
const connect=new Function('require',source.slice(0,source.indexOf('const { ConvexHttpClient }'))+';return connect;')(require);
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-proof-ui-'));
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {MembershipProofRepair,MembershipProviderRepair} from './src/components/admin/MembershipProofRepair';window.calls=[];createRoot(document.getElementById('root')).render(<><MembershipProofRepair token="fixture-admin" invoiceId="in_fixture"/><MembershipProviderRepair token="fixture-admin" subscriptionId="sub_fixture"/></>);`;
 await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:path.join(directory,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'proof-fixture',setup(build){
  build.onResolve({filter:/^(convex\/react$|@cvx\/_generated\/api$)/},args=>({path:args.path,namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',contents:args.path==='convex/react'?`export const useAction=ref=>async args=>{window.calls.push({ref,args});return ref.includes('retry')?'needs_review':true}`:`export const api=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>String(group)+'.'+String(method)})});`}));
 }}]});
 const server=http.createServer((request,response)=>{if(request.url==='/fixture.js'){response.setHeader('Content-Type','application/javascript');response.end(fs.readFileSync(path.join(directory,'fixture.js')))}else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let client;
 try{
  client=await connect('about:blank');await client.cmd('Page.enable');await client.cmd('Runtime.enable');await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
  for(let attempt=0;attempt<100&&!(await client.evaluate('!!document.querySelector("summary")'));attempt++)await wait(100);
  await client.evaluate('document.querySelector("summary").click()');assert.equal(await client.evaluate('document.querySelectorAll("button")[1].disabled'),true);
  await client.evaluate('document.querySelectorAll("button")[0].click()');await wait(100);assert.equal(await client.evaluate('document.querySelector("[role=status]").textContent.includes("still needs review")'),true);
  await client.evaluate(`(()=>{const field=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Verified provider records');field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await client.evaluate('document.querySelectorAll("button")[1].click()');await wait(100);
  assert.equal(await client.evaluate('document.querySelector("[role=status]").textContent.includes("evidence matched")'),true);
  await client.evaluate('document.querySelectorAll("button")[2].click()');await wait(100);
  assert.equal(await client.evaluate('[...document.querySelectorAll("[role=status]")].some(item=>item.textContent.includes("needs team review"))'),true);
  assert.deepEqual(await client.evaluate('window.calls'),[{ref:'checkout.retryMembershipWaiverProof',args:{token:'fixture-admin',invoiceId:'in_fixture'}},{ref:'checkout.resolveMembershipWaiverAmbiguity',args:{token:'fixture-admin',invoiceId:'in_fixture',reason:'Verified provider records'}},{ref:'checkout.retryMembershipProviderRead',args:{token:'fixture-admin',subscriptionId:'sub_fixture'}}]);
  console.log('PASS admin proof repair browser: explicit review reason, safe retry, authenticated arguments and truthful results.');
 }finally{if(client){client.close();await fetch(`${process.env.DBC_CDP_URL||'http://localhost:9224'}/json/close/${client.tabId}`)}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
