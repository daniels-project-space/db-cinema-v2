const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-suspension-'));
  const booking = {_id:'booking-fixture', status:'returned', idVerifyStatus:'verified', diditSessionId:'didit-fixture', guestEmail:'fixture@example.invalid', total:100, depositAmount:0, lineItems:[{title:'Synthetic camera', start:Date.UTC(2030,0,1), end:Date.UTC(2030,0,2), qty:1}]};
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {RentalWorkspace} from './src/components/admin/RentalWorkspace'; window.fixtureCalls=[]; createRoot(document.getElementById('root')).render(<RentalWorkspace token="test-token" bookingId="booking-fixture" onClose={()=>{}} onChat={()=>{}}/>);`;
  await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:path.join(directory,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'synthetic-only',setup(build){
    build.onResolve({filter:/(_generated\/api|convex\/react|RentalKit|RentalOrderTools|DroneLicence|RentalVerificationSummary|AccountDocuments)$/},args=>({path:args.path,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:root,contents:args.path.endsWith('_generated/api')?`const refs=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>String(group)+'.'+String(method)})});export const api=refs;`:args.path==='convex/react'?`export const useQuery=()=>(${JSON.stringify(booking)});export const useMutation=ref=>async args=>{window.fixtureCalls.push({ref,args})};export const useAction=useMutation;`:`export const RentalKit=()=>null,RentalOrderTools=()=>null,AdminDroneLicence=()=>null,RentalVerificationSummary=()=>null,AccountDocuments=()=>null;`}));
  }}]});
  const cssDir=path.join(root,'.next/static/chunks');
  const css=fs.existsSync(cssDir)?fs.readdirSync(cssDir).filter(file=>file.endsWith('.css')).map(file=>fs.readFileSync(path.join(cssDir,file),'utf8')).join('\n'):'';
  const server=http.createServer((request,response)=>{if(request.url==='/fixture.js'){response.setHeader('Content-Type','application/javascript');response.end(fs.readFileSync(path.join(directory,'fixture.js')))}else if(request.url==='/fixture.css'){response.setHeader('Content-Type','text/css');response.end(css)}else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body style="background:#111"><main id="root"></main><script src="/fixture.js"></script>')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let client; const errors=[];
  try {
    client=await connect('about:blank'); await client.cmd('Page.enable'); await client.cmd('Runtime.enable');
    client.on(event=>{if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.text)});
    for(const device of [{name:'desktop',width:1440,height:1000,mobile:false},{name:'mobile',width:390,height:844,mobile:true}]){
      await client.cmd('Emulation.setDeviceMetricsOverride',{...device,deviceScaleFactor:1});
      await client.cmd('Page.navigate',{url:origin});
      for(let attempts=0;attempts<100 && !(await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Verification')`));attempts++)await wait(100);
      await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Verification').click()`); await wait(100);
      assert.equal(await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Suspend verification reuse').disabled`),true);
      assert.equal(await client.evaluate(`document.body.textContent.includes('It does not delete documents or complete an erasure request.')`),true);
      await client.evaluate(`(()=>{const element=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,'Privacy request received');element.dispatchEvent(new Event('input',{bubbles:true}))})()`); await wait(100);
      assert.equal(await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Suspend verification reuse').disabled`),false);
      await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Suspend verification reuse').scrollIntoView({block:'center'})`); await wait(100);
      const screenshot=await client.cmd('Page.captureScreenshot',{format:'png'}); fs.writeFileSync('/tmp/dbc-verification-suspension-'+device.name+'.png',Buffer.from(screenshot.data,'base64'));
      await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Suspend verification reuse').click()`); await wait(100);
      assert.deepEqual(await client.evaluate('window.fixtureCalls'),[{ref:'bookings.adminSuspendVerificationReuse',args:{token:'test-token',bookingId:'booking-fixture',reason:'Privacy request received'}}]);
      assert.equal(await client.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true,'Horizontal overflow on '+device.name);
      console.log(device.name+': reason gate, warning, exact synthetic mutation and layout passed');
    }
    assert.deepEqual(errors,[]);
  } finally {
    if(client){client.close();await fetch(`${process.env.DBC_CDP_URL||'http://localhost:9224'}/json/close/${client.tabId}`)}
    await new Promise(resolve=>server.close(resolve)); fs.rmSync(directory,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
