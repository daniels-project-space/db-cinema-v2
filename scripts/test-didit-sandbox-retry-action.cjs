// Explicit synthetic sandbox fixture only. This is an integration test with mocked authentication, database, decline details and preview presentation.
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),esbuild=require('esbuild'),postcss=require('postcss');
const browserSource=fs.readFileSync('scripts/test-membership-browser.cjs','utf8');
const connect=new Function('require',browserSource.slice(0,browserSource.indexOf('const { ConvexHttpClient }'))+'\nreturn connect;')(require);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const {load}=require(process.cwd()+'/scripts/lib/rentalTestHarness.cjs');
const key=process.env.DIDIT_SANDBOX_API_KEY,workflow=process.env.DIDIT_SANDBOX_WORKFLOW_ID;
if(!key||!workflow||!process.env.DIDIT_SANDBOX_APPLICATION_ID)throw Error('Sandbox credentials required');
Object.assign(process.env,{DIDIT_API_KEY:key,DIDIT_WORKFLOW_ID:workflow,DIDIT_APPLICATION_ID:process.env.DIDIT_SANDBOX_APPLICATION_ID,DIDIT_WEBHOOK_SECRET:'test-only',DIDIT_ENVIRONMENT:'sandbox'});
const real=global.fetch,base='https://verification.didit.me/v3/',headers={'x-api-key':key,'content-type':'application/json'};
async function request(url,body){const r=await real(base+url,{method:'POST',headers,body:JSON.stringify(body)});if(!r.ok)throw Error(`${url} failed ${r.status}`);return r.json()}
(async()=>{
 const bookingId='synthetic-retry-qualification', email='retry-qualification@example.invalid';
 const lists=await(await real(base+'sessions/?limit=100',{headers})).json();let item=lists.results?.find(x=>x.vendor_data===`dbc-booking-${bookingId}`);
 if(!item)throw Error('The designated synthetic sandbox fixture is missing.');
 const d=await(await real(base+`session/${item.session_id}/decision/`,{headers})).json();
 // simulate is sandbox-only; require it to succeed before any resubmission.
 if(d.status==='Declined')await request(`session/${item.session_id}/simulate/`,{new_status:'Approved',send_webhooks:false});
 await request(`session/${item.session_id}/simulate/`,{new_status:'Declined',risk:'COULD_NOT_RECOGNIZE_DOCUMENT',send_webhooks:false});
 const w=await(await real(base+`workflows/${workflow}/`,{headers})).json();const features=Object.entries(w.workflow_graph.nodes).filter(([,v])=>v.node_type==='feature');const ocr=features.find(([,v])=>v.feature==='OCR')[0];
 const account={_id:'account-1',email};const booking={_id:bookingId,accountId:account._id,guestEmail:email,status:'pending_verification',checkoutPaidAt:100,verificationProvider:'didit',diditSessionId:item.session_id,idVerifyStatus:'rejected',diditEventId:'event-1',diditEventAt:123,securityPolicyVersion:'2026-11-setup-intent-v1',savedCardStatus:'saved'};
 let sentPreview=false,mutated=false,dropResponse=false,updateCount=0;
 global.fetch=async(url,opts={})=>{const response=await real(url,opts);if(url.endsWith('/update-status/')){updateCount++;if(dropResponse){dropResponse=false;assert(response.ok);throw Error('Synthetic lost response after Didit accepted update')}}if(url.endsWith('/decision/')){const data=await response.json();if(data.status==='Declined'){data.decision_trace={decided_by:'automatic'};data.id_verifications=[{node_id:ocr,status:'Declined',warnings:[{risk:'COULD_NOT_RECOGNIZE_DOCUMENT',log_type:'error'}]}];data.liveness_checks=[];data.face_matches=[];data.poa_verifications=[]}return new Response(JSON.stringify(data),{status:response.status})}if(url.endsWith('/resubmission-preview/')){const data=await response.json();assert.equal(data.will_be_sent,false);assert.equal(data.not_sent_reason,'sandbox');sentPreview=true;data.will_be_sent=true;data.subject='Complete verification with DB Cinema Rentals';return new Response(JSON.stringify(data),{status:response.status})}return response};
 const {retryRejected}=load('convex/didit.ts');
 const ctx={runQuery:async ref=>ref==='accounts._byToken'?account:booking,runMutation:async(ref,args)=>{if(ref==='diditReviewClaims.claimRenterRetry')booking.diditRetryNotice={requestId:args.requestId,sessionId:args.sessionId,startedAt:Date.now()};if(ref==='bookings.setDiditResult'){assert(args.providerRetryRequestId);booking.idVerifyStatus='requires_input';mutated=true}return true}};
 const result=await retryRejected.handler(ctx,{bookingId,accountToken:'synthetic'});
 assert(sentPreview&&mutated&&/^https:\/\/verify\.didit\.me\//.test(result.url));
 await request(`session/${item.session_id}/simulate/`,{new_status:'Declined',risk:'COULD_NOT_RECOGNIZE_DOCUMENT',send_webhooks:false});
 booking.idVerifyStatus='rejected';delete booking.diditRetryNotice;dropResponse=true;
 await assert.rejects(retryRejected.handler(ctx,{bookingId,accountToken:'synthetic'}),/Synthetic lost response/);
 const countAfterLost=updateCount;
 const recovered=await retryRejected.handler(ctx,{bookingId,accountToken:'synthetic'});
 assert(/^https:\/\/verify\.didit\.me\//.test(recovered.url));assert.equal(updateCount,countAfterLost,'recovering a lost response must not send a second provider update');
 // Drive the rendered website component through a local adapter to the real
 // action above. Auth/database and sandbox decline/preview flags remain mocked.
 await request(`session/${item.session_id}/simulate/`,{new_status:'Declined',risk:'COULD_NOT_RECOGNIZE_DOCUMENT',send_webhooks:false});
 booking.idVerifyStatus='rejected';delete booking.diditRetryNotice;
 const mocks={name:'retry-action-ui',setup(build){
  build.onResolve({filter:/^(next\/link|convex\/react|@cvx\/|@\/components\/account\/AccountProvider|@\/components\/icons)/},args=>({path:args.path,namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'jsx',resolveDir:process.cwd(),contents:args.path==='next/link'?`import React from 'react';export default function Link({href,children,...p}){return <a href={href} {...p}>{children}</a>}`:`import React from 'react';export const api={didit:{bookingSession:'booking',retryRejected:'retry'}};export const useAction=()=>async()=>{const r=await fetch('/retry',{method:'POST'});if(!r.ok)throw Error('retry failed');return r.json()};export const useAccount=()=>({token:'fixture'});export const IconCheck=()=>null;`}));
 }};
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {IdVerify} from './src/components/IdVerify';import {diditFailureReason} from './shared/diditFailureReason';const note=diditFailureReason({id_verifications:[{status:'Declined',warnings:[{risk:'COULD_NOT_RECOGNIZE_DOCUMENT',log_type:'error'}]}]});createRoot(document.getElementById('root')).render(<IdVerify bookingId="synthetic" status="rejected" note={note}/>);`;
 const bundle=await esbuild.build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,platform:'browser',outdir:'out',loader:{'.css':'local-css'},plugins:[mocks]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,componentCss=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
 const css=await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css','utf8'),{from:path.resolve('src/app/globals.css')});
 const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="background:#111"><main id="root"></main><script src="/bundle.js"></script></body></html>';
 let actionRequests=0;
 const server=http.createServer(async(req,res)=>{if(req.url==='/retry'&&req.method==='POST'){actionRequests++;try{const data=await retryRejected.handler(ctx,{bookingId,accountToken:'synthetic'});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data))}catch{res.writeHead(500);res.end('Retry failed')}return}const files={'/':['text/html',html],'/style.css':['text/css',css.css+'\n'+componentCss],'/bundle.js':['text/javascript',js]},f=files[req.url];res.writeHead(f?200:404,{'Content-Type':f?.[0]??'text/plain'});res.end(f?.[1]??'Not found')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'didit-sandbox-action-ui-'));
 const chrome=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${dir}`,'about:blank'],{stdio:'ignore'});
 let client;
 try{
  let port;for(let n=0;n<100;n++){try{port=fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0];break}catch{await delay(100)}}assert(port);
  process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;client=await connect();await client.cmd('Page.enable');await client.cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await delay(1000);
  assert(await client.evaluate(`document.body.innerText.includes('Try verification again')`));
  assert(await client.evaluate(`document.body.innerText.includes('could not verify your photo ID')`),'the provider warning must appear as clear customer guidance');
  const before=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-didit-action-button.png',Buffer.from(before.data,'base64'));
  await client.evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.innerText.includes('Try verification again')).click()`);
  await delay(12000);
  const frameTree=await client.cmd('Page.getFrameTree'),targets=await client.cmd('Target.getTargets');
  assert.equal(actionRequests,1,'the visible button must invoke the actual retry action once');
  assert(JSON.stringify(frameTree).includes('verify.didit.me')||(targets.targetInfos||[]).some(t=>t.type==='iframe'&&/^https:\/\/verify\.didit\.me\//.test(t.url)),'the real provider overlay must open');
  const image=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-didit-action-overlay.png',Buffer.from(image.data,'base64'));
  await client.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:195,y:635,button:'left',clickCount:1});await client.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:195,y:635,button:'left',clickCount:1});
  await delay(5000);const after=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-didit-action-overlay-after.png',Buffer.from(after.data,'base64'));
  assert.notEqual(after.data,image.data,'Didit’s visible retry control must advance the overlay');
 }finally{if(client)client.close();if(chrome.exitCode===null){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await exited}server.close();await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:200})}
 console.log('PASS website retry button -> retry action -> Didit sandbox preview and token-fenced update -> real overlay and retry control, including lost-response recovery. No sandbox email sent. Mocked: account/database, automatic-decline report and preview branding/delivery flags.');
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>{global.fetch=real});
