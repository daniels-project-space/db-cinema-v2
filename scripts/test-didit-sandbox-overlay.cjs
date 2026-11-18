// Uses an existing explicitly synthetic Didit sandbox case. No email is sent.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),esbuild=require('esbuild'),postcss=require('postcss');
const source=fs.readFileSync('scripts/test-membership-browser.cjs','utf8');
const connect=new Function('require',source.slice(0,source.indexOf('const { ConvexHttpClient }'))+'\nreturn connect;')(require);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  if(!process.env.DIDIT_SANDBOX_API_KEY) throw Error('A Didit sandbox key is required.');
  const headers={'x-api-key':process.env.DIDIT_SANDBOX_API_KEY,'content-type':'application/json'};
  const list=await (await fetch('https://verification.didit.me/v3/sessions/?limit=25',{headers})).json();
  const item=list.results?.find(x=>x.vendor_data==='dbc-branding-synthetic');
  if(!item) throw Error('The synthetic sandbox case was not found.');
  let decision=await (await fetch(`https://verification.didit.me/v3/session/${item.session_id}/decision/`,{headers})).json();
  if(decision.status!=='Declined'){
    const simulated=await fetch(`https://verification.didit.me/v3/session/${item.session_id}/simulate/`,{method:'POST',headers,body:JSON.stringify({new_status:'Declined',risk:'COULD_NOT_RECOGNIZE_DOCUMENT',node_id:'ocr',send_webhooks:false})});
    if(!simulated.ok) throw Error('Could not reset the synthetic sandbox case.');
  }
  const workflow=await (await fetch(`https://verification.didit.me/v3/workflows/${decision.workflow_id}/`,{headers})).json();
  const nodes=Object.entries(workflow.workflow_graph?.nodes||{}).filter(([,node])=>node.node_type==='feature').map(([id,node])=>({node_id:id,feature:node.feature==='PROOF_OF_ADDRESS'?'POA':node.feature}));
  if(nodes.length!==4) throw Error('The synthetic workflow has changed.');
  const preview=await (await fetch(`https://verification.didit.me/v3/session/${item.session_id}/resubmission-preview/`,{method:'POST',headers,body:JSON.stringify({new_status:'Resubmitted',nodes_to_resubmit:nodes,email_language:'en'})})).json();
  if(preview.will_be_sent!==false||preview.not_sent_reason!=='sandbox'||!preview.preview_token||!preview.recipient) throw Error('The provider did not confirm a non-sending sandbox preview.');
  const update=await fetch(`https://verification.didit.me/v3/session/${item.session_id}/update-status/`,{method:'PATCH',headers,body:JSON.stringify({new_status:'Resubmitted',nodes_to_resubmit:nodes,email_language:'en',send_email:true,email_address:preview.recipient,email_preview_token:preview.preview_token,comment:'Synthetic interface test'})});
  if(!update.ok) throw Error('Could not reopen the synthetic sandbox case.');
  decision=await (await fetch(`https://verification.didit.me/v3/session/${item.session_id}/decision/`,{headers})).json();
  if(!/^https:\/\/verify\.didit\.me\/(?:[a-z-]+\/)?session\/[A-Za-z0-9_-]+$/.test(decision.session_url)) throw Error('Sandbox session URL is invalid.');
  const mocks={name:'sandbox-overlay',setup(build){
    build.onResolve({filter:/^(next\/link|convex\/react|@cvx\/|@\/components\/account\/AccountProvider|@\/components\/icons)/},args=>({path:args.path,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'jsx',resolveDir:process.cwd(),contents:args.path==='next/link'?`import React from 'react';export default function Link({href,children,...p}){return <a href={href} {...p}>{children}</a>}`:`import React from 'react';export const api={didit:{bookingSession:'booking',retryRejected:'retry'}};export const useAction=()=>async()=>({url:globalThis.fixtureSessionUrl});export const useAccount=()=>({token:'fixture'});export const IconCheck=()=>null;`}));
  }};
  const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {IdVerify} from './src/components/IdVerify';createRoot(document.getElementById('root')).render(<IdVerify bookingId="synthetic" status="rejected" note="We could not complete the verification. Please contact the team from your rental conversation so we can help."/>);`;
  const bundle=await esbuild.build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,platform:'browser',outdir:'out',loader:{'.css':'local-css'},plugins:[mocks]});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,componentCss=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
  const css=await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css','utf8'),{from:path.resolve('src/app/globals.css')});
  const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="background:#111"><main id="root"></main><script src="/bundle.js"></script></body></html>';
  const server=http.createServer((req,res)=>{const files={'/':['text/html',html],'/style.css':['text/css',css.css+'\n'+componentCss],'/bundle.js':['text/javascript',js]},f=files[req.url];res.writeHead(f?200:404,{'Content-Type':f?.[0]??'text/plain'});res.end(f?.[1]??'Not found')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'didit-sandbox-overlay-'));
  const chrome=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${dir}`,'about:blank'],{stdio:'ignore'});
  let client;
  try{
    let port;for(let n=0;n<100;n++){try{port=fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split('\n')[0];break}catch{await delay(100)}}assert(port);
    process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;client=await connect();await client.cmd('Page.enable');
    await client.cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await delay(1000);
    await client.evaluate(`globalThis.fixtureSessionUrl=${JSON.stringify(decision.session_url)}`);
    assert(await client.evaluate(`document.body.innerText.includes('Try verification again')`),'retry button must be visible');
    await client.evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.innerText.includes('Try verification again')).click()`);
    await delay(12000);
    const frames=await client.cmd('Page.getFrameTree');
    const targets=await client.cmd('Target.getTargets');
    const image=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-didit-sandbox-overlay.png',Buffer.from(image.data,'base64'));
    const state=await client.evaluate(`({hasFrame:!!document.querySelector('iframe'),text:document.body.innerText})`);
    const realFrame=JSON.stringify(frames).includes('verify.didit.me') || (targets.targetInfos||[]).some(t=>t.type==='iframe' && /^https:\/\/verify\.didit\.me\//.test(t.url));
    assert(state.hasFrame && realFrame,'the real sandbox provider frame must load');
    // The sandbox welcome screen's blue button is visible in the saved image.
    // Tap it in the rendered page to exercise Didit's own retry control.
    await client.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:195,y:635,button:'left',clickCount:1});
    await client.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:195,y:635,button:'left',clickCount:1});
    await delay(5000);
    const after=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-didit-sandbox-overlay-after.png',Buffer.from(after.data,'base64'));
    assert.notEqual(after.data,image.data,'the provider interface must change after tapping its retry control');
    console.log('PASS real synthetic Didit sandbox frame opened from the visible website retry button; screenshot captured. No email sent.');
  } finally {if(client)client.close();if(chrome.exitCode===null){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await exited}server.close();await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:200})}
})().catch(error=>{console.error(error.message);process.exitCode=1});
