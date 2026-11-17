const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const esbuild = require('esbuild');
const postcss = require('postcss');
const source = fs.readFileSync('scripts/test-membership-browser.cjs', 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + '\nreturn connect;')(require);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const mocks = {name:'synthetic-verification',setup(build){
    build.onResolve({filter:/^(next\/link|next\/navigation|convex\/react|@cvx\/|@\/components\/|\.\/DroneLicence|\.\/VerificationReuseClaim|\.\/useVerificationRefresh)/},args=>args.path==='@/components/IdVerify'?undefined:({path:args.path,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'jsx',resolveDir:process.cwd(),contents:args.path==='next/link'?`import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`:`import React from 'react';export const api={bookings:{verificationProgress:'fixture'},checkout:{retrySavedCard:'fixture'},didit:{bookingSession:'fixture'}},useRouter=()=>({}),useQuery=()=>globalThis.fixtureBooking,useAction=()=>()=>{},useAccount=()=>({token:'fixture-token',loading:false}),SmartImage=()=>null,IconCheck=()=>null,IconLock=()=>null,ManagementShell=({children,subtitle})=><><p>{subtitle}</p>{children}</>,DroneLicenceUpload=()=>null,VerificationReuseClaim=()=>null,useVerificationRefresh=()=>null;`}));
  }};
  const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {VerificationProgress} from './src/components/rentals/VerificationProgress';let root;globalThis.setFixture=(status,mode,fulfilment='pickup',scheduled=false,approved=false,savedCard=false,verificationStatus='required',checks=null,archiveReady=approved)=>{globalThis.fixtureBooking={_id:'synthetic-booking',status,fulfilment,idVerifyStatus:approved?'verified':verificationStatus,verificationChecks:checks,verificationExpiresAt:approved?Date.now()+86400000:null,verificationArchiveReady:archiveReady,depositHoldAmount:savedCard?0:100,depositHoldStatus:scheduled?'scheduled':'pending',securityHoldPolicyVersion:scheduled?'2026-10-pickup-hold-v1':null,securityPolicyVersion:savedCard?'2026-10-saved-card-v1':null,savedCardStatus:savedCard?'saved':null,savedCardLimit:1000,depositAmount:0,verificationAvailable:scheduled,lineItems:[],subtotal:100,total:100};if(!root)root=createRoot(document.getElementById('root'));root.render(<VerificationProgress bookingId="synthetic-booking" presentation={mode}/>)};`;
  const bundle=await esbuild.build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,platform:'browser',outdir:'out',loader:{'.css':'local-css'},plugins:[mocks]});
  const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,componentCss=bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text??'';
  const css=await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css','utf8'),{from:path.resolve('src/app/globals.css')});
  const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="background:#111"><main id="root"></main><script src="/bundle.js"></script></body></html>';
  const server=http.createServer((request,response)=>{const files={'/':['text/html',html],'/style.css':['text/css',css.css+'\n'+componentCss],'/bundle.js':['text/javascript',js]},file=files[request.url];response.writeHead(file?200:404,{'Content-Type':file?.[0]??'text/plain'});response.end(file?.[1]??'Not found')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-verification-ui-'));
  const chrome=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${temp}`,'about:blank'],{stdio:'ignore'});
  let client;
  try{
    let port;for(let attempt=0;attempt<100;attempt++){try{port=fs.readFileSync(path.join(temp,'DevToolsActivePort'),'utf8').split('\n')[0];break}catch{await delay(100)}}assert(port);process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;
    client=await connect();await client.cmd('Page.enable');await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});for(let attempt=0;attempt<100&&!await client.evaluate('typeof setFixture === "function"');attempt++)await delay(100);
    for(const width of [320,390,640,1440])for(const mode of ['embedded','page'])for(const status of ['confirmed','pending_payment']){
      await client.cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});await client.evaluate(`setFixture(${JSON.stringify(status)},${JSON.stringify(mode)})`);await delay(150);
      const state=await client.evaluate(`({text:document.body.innerText,href:document.querySelector('a[href*="#chat"]')?.getAttribute('href'),overflow:document.documentElement.scrollWidth>innerWidth})`);
      assert.equal(state.overflow,false,`No horizontal overflow at ${width}px`);
      if(status==='confirmed'){assert(state.text.includes('Verification is unavailable right now.'));assert(!state.text.includes('Complete your rental payment'));assert.equal(state.href,'/account?rental=synthetic-booking#chat')}else assert(state.text.includes('Complete your rental payment before verification can begin.'));
      const image=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`/tmp/dbc-verification-unavailable-${width}-${mode}-${status}.png`,Buffer.from(image.data,'base64'));
    }
    for(const width of [320,390,640,1440])for(const fulfilment of ['delivery','pickup']){
      await client.cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});await client.evaluate(`setFixture('confirmed','page',${JSON.stringify(fulfilment)},true)`);await delay(150);
      const state=await client.evaluate(`({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth})`);
      assert.equal(state.overflow,false);assert(state.text.includes(`Ready for ${fulfilment}`));assert(state.text.includes(`Complete verification to get ready for ${fulfilment}.`));assert(state.text.includes(`Card hold at ${fulfilment}`));
      const image=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`/tmp/dbc-verification-fulfilment-${width}-${fulfilment}.png`,Buffer.from(image.data,'base64'));
      await client.evaluate(`setFixture('confirmed','page',${JSON.stringify(fulfilment)},true,true)`);await delay(150);
      const approved=await client.evaluate('document.body.innerText');assert(approved.includes(`Your documents are approved. Check your ${fulfilment} and card hold below.`));
      await client.evaluate(`setFixture('confirmed','page',${JSON.stringify(fulfilment)},true,true,true)`);await delay(150);
      const savedCard=await client.evaluate('document.body.innerText');assert(savedCard.includes(`Your documents are approved. Check your ${fulfilment} and saved-card setup below.`));
    }
    for(const width of [320,390,640,1440])for(const [status,headline,detail] of [['processing','Verification in progress','Open verification to continue, or return later for an update.'],['manual_review','Verification needs review','Review needed'],['requires_input','Documents needed','Please replace the requested document to continue.'],['rejected','Verification needs attention','Verification could not be completed. Message the team for help.']]){
      await client.cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});await client.evaluate(`setFixture('confirmed','page','pickup',true,false,false,${JSON.stringify(status)})`);await delay(150);
      const state=await client.evaluate(`({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth})`);assert(!state.overflow);assert(state.text.includes(headline),status);assert(state.text.includes(detail),status);
      if(status==='processing'){assert(!state.text.includes('Required'),'Unknown feature states must not be displayed as missing documents');assert(state.text.includes('Continue verification'),'An opened but unfinished session can still be continued');assert(!state.text.includes('documents are being checked'))}
      const image=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`/tmp/dbc-verification-state-${width}-${status}.png`,Buffer.from(image.data,'base64'));
    }
    await client.evaluate(`setFixture('confirmed','page','pickup',true,false,false,'processing',{identity:'waiting',selfie:'approved',address:'waiting'})`);await delay(150);
    const knownChecks=await client.evaluate('document.body.innerText');assert(knownChecks.includes('Required'),'Provider-reported missing documents stay visible');assert(knownChecks.includes('Continue verification'));
    for(const width of [320,390,640,1440]){
      await client.cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});await client.evaluate(`setFixture('confirmed','page','pickup',true,true,false,'required',null,false)`);await delay(150);
      const pending=await client.evaluate(`({text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth})`);assert(!pending.overflow);assert(pending.text.includes('Your verification is approved. Document storage is not yet confirmed.'));assert(pending.text.includes('Your identity and address verification is approved. Document storage has not yet been confirmed.'));assert(pending.text.includes('Identity and address verified'));assert(!pending.text.includes('Required'),'An approved provider result does not ask for documents again when storage is unconfirmed');assert(!pending.text.includes('Verification could not be completed'));assert(!pending.text.includes('All set'));
      const image=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`/tmp/dbc-verification-archive-pending-${width}.png`,Buffer.from(image.data,'base64'));
    }
    console.log('PASS verification UI at 320px, 390px, 640px and 1440px: help link, payment gate, status states, archive messaging and no overflow; synthetic data only.');
  }finally{if(client)client.close();if(chrome.exitCode===null){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await exited}server.close();await delay(500);await fs.promises.rm(temp,{recursive:true,force:true,maxRetries:20,retryDelay:200})}
})().catch(error=>{console.error(error);process.exitCode=1});
