const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const esbuild=require('esbuild');
const postcss=require('postcss');
const root=path.resolve(__dirname,'..');
const helper=fs.readFileSync(path.join(__dirname,'test-membership-browser.cjs'),'utf8');
const connect=new Function('require',helper.slice(0,helper.indexOf('const { ConvexHttpClient }'))+';return connect;')(require);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-membership-invoice-ui-'));
  const entry=`import React,{useSyncExternalStore}from'react';import{createRoot}from'react-dom/client';import{MembershipInvoiceRecovery}from'./src/components/admin/MembershipInvoiceRecovery';window.__useSyncExternalStore=useSyncExternalStore;window.__fixture={rows:[{invoiceId:'in_ready',reason:'processing_error',createdAt:1700000000000,retry:{state:'available'}},{invoiceId:'in_missing',reason:'snapshot_not_configured',createdAt:1700000000000,retry:{state:'not_retryable'}},{invoiceId:'in_cooldown',reason:'processing_error',createdAt:1700000000000,retry:{state:'cooldown',availableAt:Date.now()+60000}},{invoiceId:'in_daily',reason:'processing_error',createdAt:1700000000000,retry:{state:'daily_limit',availableAt:Date.now()+86400000}},{invoiceId:'in_disabled',reason:'processing_error',createdAt:1700000000000,retry:{state:'feature_off'}}],status:'CanLoadMore',moreCalls:[],calls:[]};createRoot(document.getElementById('root')).render(<MembershipInvoiceRecovery token='admin-fixture' accountId='accounts_fixture'/>);`;
  await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:path.join(directory,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'membership-ui-fixture',setup(build){
    build.onResolve({filter:/^convex\/react$|^@cvx\/_generated\/(api|dataModel)$/},args=>({path:args.path,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>{
      if(args.path==='convex/react')return{loader:'js',contents:`const rows=()=>window.__useSyncExternalStore(callback=>{window.addEventListener('fixture:change',callback);return()=>window.removeEventListener('fixture:change',callback)},()=>window.__fixture.rows,()=>window.__fixture.rows);export const useQuery=()=>rows();export const usePaginatedQuery=()=>({results:rows(),status:window.__fixture.status,loadMore:count=>window.__fixture.moreCalls.push(count)});export const useAction=(ref)=>async(args)=>{window.__fixture.calls.push({ref,args});if(ref==='checkout.adminInspectMembershipInvoice')return args.invoiceId==='in_ready'?{invoice:{id:'in_ready',status:'paid',currency:'gbp',amountPaidPence:4900,billingReason:'subscription_cycle'},receipt:null,tierCheck:{state:'ready',earnedCreditPence:4900}}:{invoice:{id:'in_missing',status:'paid',currency:'gbp',amountPaidPence:4900,billingReason:'subscription_cycle'},receipt:null,tierCheck:{state:'review',reason:'snapshot_not_configured'}};if(ref==='checkout.adminRetryMembershipInvoice'){window.__fixture.rows=window.__fixture.rows.filter(row=>row.invoiceId!==args.invoiceId);window.dispatchEvent(new Event('fixture:change'));return{state:'resolved'}}throw Error('Unexpected action '+ref)}`};
      if(args.path==='@cvx/_generated/api')return{loader:'js',contents:`export const api=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>String(group)+'.'+String(method)})})`};
      return{loader:'js',contents:'export {}'};
    });
  }}]});
  const css=(await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')})).css;
  const server=http.createServer((request,response)=>{if(request.url==='/fixture.js'){response.setHeader('content-type','application/javascript');return response.end(fs.readFileSync(path.join(directory,'fixture.js')))}if(request.url==='/fixture.css'){response.setHeader('content-type','text/css');return response.end(css)}response.setHeader('content-type','text/html');response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body style="background:#111;color:white"><main id="root" style="max-width:440px;margin:20px auto;padding:12px"></main><script src="/fixture.js"></script>')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let client,browser;
  try{
    if(!process.env.DBC_CDP_URL){const profile=path.join(directory,'chrome');browser=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(portFile);i++)await wait(100);if(!fs.existsSync(portFile))throw Error('Temporary Chrome did not start');process.env.DBC_CDP_URL=`http://127.0.0.1:${fs.readFileSync(portFile,'utf8').split('\n')[0]}`;}
    client=await connect('about:blank');await client.cmd('Page.enable');await client.cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
    for(let i=0;i<100&&!await client.evaluate(`!!document.querySelector('[data-testid="membership-invoice-recovery"]')`);i++)await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="membership-invoice-recovery"] summary').click()`);await wait(100);
    assert.equal(await client.evaluate(`document.querySelectorAll('button[data-testid^="membership-credit-sync-"]').length`),1,'Only the invoice that can be retried exposes an action');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-invoice-recovery"] summary')?.textContent.includes('Plan credit')`),true,'The expanded customer rail distinguishes subscription rewards from direct account balance');
    const planCreditLabel=await client.evaluate(`(()=>{const label=document.querySelector('[data-testid="membership-invoice-recovery"] summary .truncate.font-medium');return{text:label?.textContent.trim()??'',scrollWidth:label?.scrollWidth??0,clientWidth:label?.clientWidth??0}})()`);
    assert.equal(planCreditLabel.text,'Plan credit','The narrow mobile rail shows the shorter recovery label');
    assert(planCreditLabel.scrollWidth<=planCreditLabel.clientWidth,'The visible recovery label fits without truncation');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-invoice-recovery"] summary')?.getAttribute('aria-label')`),'Subscription credit recovery','Assistive technology retains the full single-purpose label');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-invoice-recovery"] summary')?.textContent.includes('5+')`),true,'The summary signals that more than the current page needs attention');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-invoice-recovery"] summary span[aria-label]')?.getAttribute('aria-label')`),'5+ subscription credit invoices to review','The compact count remains clear to assistive technology');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-in_ready"]')?.textContent`),'Retry','The retry action has one short action label');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-state-in_ready"]')?.textContent`),'Ready','Retry state is a separate compact badge');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-in_cooldown"]')`),null,'A cooldown shows its state without a dead retry button');
    assert.match(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-state-in_cooldown"]')?.getAttribute('aria-label')??''`),/Retry after/);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-in_daily"]')`),null,'The daily limit shows its state without a dead retry button');
    assert.match(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-state-in_daily"]')?.getAttribute('aria-label')??''`),/Daily limit/);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-in_disabled"]')`),null,'Recovery-off state has no unavailable retry button');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-state-in_disabled"]')?.textContent`),'Disabled');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-state-in_disabled"]')?.getAttribute('aria-label')`),'Recovery disabled');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-invoice-load-more"]')?.textContent`),'Load more invoice reviews','The next page has a visible affordance');
    await client.evaluate(`document.querySelector('[data-testid="membership-invoice-load-more"]').click()`);
    assert.deepEqual(await client.evaluate(`window.__fixture.moreCalls`),[30],'The more affordance requests the next page');
    assert.equal(await client.evaluate(`window.__fixture.calls.length`),0,'Disabled retries do not inspect or retry Stripe invoices');
    const compact=await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="membership-invoice-recovery"]');return{text:card?.innerText??'',buttons:card?.querySelectorAll('button').length??0}})()`);
    assert.doesNotMatch(compact.text,/in_(?:ready|missing|cooldown|daily|disabled)/,'Provider invoice references stay out of the visible panel copy');
    assert.equal(compact.buttons,2,'Only the ready retry and next-page action are visible');
    await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-in_ready"]').click()`);for(let i=0;i<100&&!await client.evaluate(`document.querySelector('[role="status"]')?.textContent.includes('£49.00 synced')`);i++)await wait(25);
    assert(await client.evaluate(`document.querySelector('[role="status"]')?.textContent.includes('£49.00')`),'A matched paid invoice reports the credit it synced');
    assert(await client.evaluate(`document.querySelector('[data-testid="membership-invoice-recovery"] summary')?.textContent.includes('4+')`),'A resolved invoice leaves the pending count');
    assert(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-status"]')?.textContent.includes('£49.00 synced')`),'The one success message remains visible outside the still-pending invoice row');
    const retriesAfterValid=await client.evaluate(`window.__fixture.calls.filter(x=>x.ref==='checkout.adminRetryMembershipInvoice').length`);assert.equal(retriesAfterValid,1);
    assert.equal(await client.evaluate(`window.__fixture.calls.find(x=>x.ref==='checkout.adminRetryMembershipInvoice')?.args.invoiceId`),'in_ready','The hidden machine reference still targets the correct invoice');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-in_missing"]')`),null,'A setup issue does not show a disabled retry button');
    assert(await client.evaluate(`Array.from(document.querySelectorAll('[data-testid="membership-invoice-recovery"] article')).some(row=>row.textContent.includes('Setup needed'))`),'A price-history issue has one concise status label');
    const retriesAfterUnsafe=await client.evaluate(`window.__fixture.calls.filter(x=>x.ref==='checkout.adminRetryMembershipInvoice').length`);assert.equal(retriesAfterUnsafe,1,'No credit retry occurs without a safe price match');
    fs.writeFileSync('/tmp/dbc-membership-invoice-recovery-phone-expanded.png',Buffer.from((await client.cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await client.evaluate(`window.__fixture.rows=[];window.dispatchEvent(new Event('fixture:change'))`);await wait(50);
    assert(await client.evaluate(`document.querySelector('[data-testid="membership-credit-sync-status"]')?.textContent.includes('£49.00 synced')`),'The successful credit readback stays visible briefly when the final pending row disappears');
    const overflow=await client.evaluate(`document.documentElement.scrollWidth>innerWidth`);assert.equal(overflow,false,'Compact section fits a phone viewport');
    fs.writeFileSync('/tmp/dbc-membership-invoice-recovery-phone.png',Buffer.from((await client.cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
    console.log('PASS subscription invoice recovery UI: paid invoice is scoped, eligible credit sync runs once, unmatched historical pricing does not retry, and phone layout fits. Synthetic data only.');
  }finally{if(client){client.close();try{await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`)}catch{}}if(browser&&browser.exitCode===null){const exited=new Promise(resolve=>browser.once('exit',resolve));browser.kill();await exited}await new Promise(resolve=>server.close(resolve));await fs.promises.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
})().catch(error=>{console.error(error);process.exitCode=1});
