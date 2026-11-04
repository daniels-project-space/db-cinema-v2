const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const esbuild = require('esbuild');
const postcss = require('postcss');
const root = path.resolve(__dirname, '..');
const helper = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', helper.slice(0, helper.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-handover-'));
  const photo='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect width=%2240%22 height=%2240%22 fill=%22%23cba%22/%3E%3C/svg%3E';
  const booking = {_id:'booking-fixture',status:'confirmed',guestEmail:'fixture@example.invalid',fulfilment:'pickup',total:100,depositAmount:0,rentalRefunds:[],controlsSnapshot:'fixture-snapshot',lineItems:[{listingId:'camera',title:'Camera with a deliberately long descriptive equipment title for the responsive layout',heroImage:photo,qty:1,start:Date.UTC(2030,0,1),end:Date.UTC(2030,0,2),pickupTime:'10:00',returnTime:'18:00',lineTotal:50},{listingId:'lens',title:'Lens',heroImage:photo,qty:1,start:Date.UTC(2030,0,1),end:Date.UTC(2030,0,2),pickupTime:'11:00',returnTime:'18:00',lineTotal:50}]};
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {RentalOrderTools} from './src/components/admin/RentalOrderTools';window.fixtureCalls=[];createRoot(document.getElementById('root')).render(<RentalOrderTools token="fixture-token" bookingId="booking-fixture" showReturn={false}/>);`;
  await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:path.join(directory,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'synthetic-only',setup(build){
    build.onResolve({filter:/(_generated\/api|convex\/react|ReturnRentalForm|ReturnInspectionHistory|RentalManagerDelivery|RentalRequestHistory|SavedCardCharges|OperatorCancellationStatus)$/},args=>({path:args.path,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:root,contents:args.path.endsWith('_generated/api')?`const refs=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>String(group)+'.'+String(method)})});export const api=refs;`:args.path==='convex/react'?`export const useQuery=(ref)=>ref==='rentalOperations.details'?${JSON.stringify(booking)}:null;export const useMutation=ref=>async args=>{window.fixtureCalls.push({ref,args});return {detail:'Updated'};};export const useAction=useMutation;export const usePaginatedQuery=()=>({results:[],status:'Exhausted',loadMore:()=>{}});`:`export const ReturnRentalForm=()=>null,ReturnInspectionHistory=()=>null,RentalManagerDelivery=()=>null,SmartImage=()=>null,RentalRequestHistory=()=>null,SavedCardCharges=()=>null,OperatorCancellationStatus=()=>null;`}));
  }}]});
  const css=(await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')})).css + (fs.existsSync(path.join(directory,'fixture.css'))?fs.readFileSync(path.join(directory,'fixture.css'),'utf8'):'');
  const server=http.createServer((request,response)=>{if(request.url==='/fixture.js'){response.setHeader('Content-Type','application/javascript');response.end(fs.readFileSync(path.join(directory,'fixture.js')))}else if(request.url==='/fixture.css'){response.setHeader('Content-Type','text/css');response.end(css)}else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body style="background:#111;color:white"><main id="root" style="max-width:700px;margin:auto;padding:16px"></main><script src="/fixture.js"></script>')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  let client, browser;const errors=[];
  try {
    if(!process.env.DBC_CDP_URL){const profile=path.join(directory,'chrome');browser=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});const portFile=path.join(profile,'DevToolsActivePort');for(let attempt=0;attempt<100&&!fs.existsSync(portFile);attempt++)await wait(100);if(!fs.existsSync(portFile))throw Error('Temporary Chrome did not start');process.env.DBC_CDP_URL=`http://127.0.0.1:${fs.readFileSync(portFile,'utf8').split('\n')[0]}`;}
    client=await connect('about:blank');await client.cmd('Page.enable');await client.cmd('Runtime.enable');client.on(event=>{if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.text)});
    for(const device of [{name:'desktop',width:1440,height:1000,mobile:false},{name:'mobile',width:390,height:844,mobile:true}]){
      await client.cmd('Emulation.setDeviceMetricsOverride',{...device,deviceScaleFactor:1});await client.cmd('Page.navigate',{url:origin});
      for(let attempt=0;attempt<100&&!(await client.evaluate(`[...document.querySelectorAll('button')].some(button=>button.textContent==='Change return time')`));attempt++)await wait(100);
      const photoProof=await client.evaluate(`(()=>{const strip=document.querySelector('[aria-label="Booked equipment images"]');strip?.focus();return {images:[...strip.querySelectorAll('img')].map(image=>({alt:image.alt,src:image.getAttribute('src')})),focus:document.activeElement===strip}})()`);
      assert.equal(photoProof.images.length,2);assert.equal(photoProof.images[0].src,photoProof.images[1].src);assert.match(photoProof.images[0].alt,/deliberately long/);assert.equal(photoProof.images[1].alt,'Lens');assert(photoProof.focus);
      assert.equal(await client.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,'Long equipment title does not overflow');
      const imageScreenshot=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-admin-summary-'+device.name+'.png',Buffer.from(imageScreenshot.data,'base64'));
      await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Change return time').click()`);await wait(100);
      assert.equal(await client.evaluate(`document.querySelectorAll('fieldset input[type=checkbox]:checked').length`),3);
      await client.evaluate(`document.querySelectorAll('fieldset input[type=checkbox]')[2].click()`);await wait(100);
      assert.equal(await client.evaluate(`document.querySelectorAll('fieldset input[type=checkbox]:checked').length`),1);
      assert.equal(await client.evaluate(`document.documentElement.scrollWidth<=window.innerWidth`),true);
      const screenshot=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-handover-'+device.name+'.png',Buffer.from(screenshot.data,'base64'));
      await client.evaluate(`(()=>{const select=document.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'19:00');select.dispatchEvent(new Event('change',{bubbles:true}));const note=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(note,'Agreed later return');note.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(100);
      await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Save return time').click()`);await wait(100);
      const call=(await client.evaluate('window.fixtureCalls')).at(-1);assert.equal(call.ref,'rentalOperations.changeHandoverTimes');assert.deepEqual(call.args.lineIndexes,[0]);assert.equal(call.args.kind,'return');assert.equal(call.args.time,'19:00');
    }
    assert.deepEqual(errors,[]);console.log('PASS synthetic desktop/mobile handover controls, all-items selection and exact return mutation.');
  } finally {if(client){client.close();await fetch(`${process.env.DBC_CDP_URL||'http://localhost:9224'}/json/close/${client.tabId}`)}if(browser&&browser.exitCode===null){const exited=new Promise(resolve=>browser.once('exit',resolve));browser.kill();await exited;}await new Promise(resolve=>server.close(resolve));await wait(300);await fs.promises.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
})().catch(error=>{console.error(error);process.exitCode=1});
