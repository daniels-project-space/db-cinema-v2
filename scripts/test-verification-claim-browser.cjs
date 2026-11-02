const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(__dirname,'test-membership-browser.cjs'),'utf8');
const connect=new Function('require',source.slice(0,source.indexOf('const { ConvexHttpClient }'))+';return connect;')(require);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-claim-ui-'));
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {VerificationReuseClaim} from './src/components/rentals/VerificationReuseClaim';import ClaimPage from './src/app/account/verification-claim/page';window.fixtureCalls=[];createRoot(document.getElementById('root')).render(location.pathname==='/account/verification-claim'?<ClaimPage/>:<VerificationReuseClaim bookingId="bookings-fixture"/>);`;
 await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:path.join(directory,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'fixture',setup(build){
  build.onResolve({filter:/(_generated\/api|convex\/react|AccountProvider|next\/link)$/},args=>({path:args.path,namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:root,contents:args.path.endsWith('_generated/api')?`const refs=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>String(group)+'.'+String(method)})});export const api=refs;`:args.path==='convex/react'?`export const useQuery=()=>location.search?'profile':'available';export const useAction=ref=>async args=>{window.fixtureCalls.push({ref,args});return {ok:true}};`:args.path==='next/link'?`import React from 'react';export default ({href,children,...props})=><a href={href} {...props}>{children}</a>;`:`export const useAccount=()=>({loading:false,token:'synthetic-token'});`}));
 }}]});
 const server=http.createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(directory,'fixture.js')))}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/fixture.js"></script>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let client;
 try{client=await connect('about:blank');await client.cmd('Page.enable');await client.cmd('Runtime.enable');
  await client.cmd('Page.navigate',{url:origin+'/fixture?profile'});await wait(500);
  assert.equal(await client.evaluate('document.body.textContent.includes("update your account profile")'),true);
  assert.equal(await client.evaluate('document.querySelector("a").getAttribute("href")'),'/account#profile');
  assert.equal(await client.evaluate('document.querySelector("button")'),null,'incomplete profile cannot send a claim');
  assert.deepEqual(await client.evaluate('window.fixtureCalls'),[]);
  await client.cmd('Page.navigate',{url:origin+'/fixture'});await wait(500);
  assert.deepEqual(await client.evaluate('window.fixtureCalls'),[],'rendering cannot send an email');
  await client.evaluate('document.querySelector("button").click()');await wait(100);
  assert.deepEqual(await client.evaluate('window.fixtureCalls'),[{ref:'verificationReuseClaims.request',args:{token:'synthetic-token',bookingId:'bookings-fixture'}}]);
  assert.equal(await client.evaluate('document.body.textContent.includes("Check your email")'),true);
  await client.cmd('Page.navigate',{url:origin+'/account/verification-claim#synthetic-secret'});await wait(500);
  assert.deepEqual(await client.evaluate('window.fixtureCalls'),[{ref:'verificationReuseClaims.redeem',args:{token:'synthetic-token',secret:'synthetic-secret'}}]);
  assert.equal(await client.evaluate('location.hash'),'', 'secret removed from browser address');
  assert.equal(await client.evaluate('document.body.textContent.includes("linked to your account")'),true);
  console.log('PASS verification claim browser: explicit opt-in, exact synthetic request/redeem, fragment removal, result.');
 }finally{if(client){client.close();await fetch(`${process.env.DBC_CDP_URL||'http://localhost:9224'}/json/close/${client.tabId}`)}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
