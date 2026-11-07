const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const esbuild = require('esbuild');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = path.resolve(__dirname, '..');
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{AuthenticatedBookingDownload as Download}from'./src/components/account/AuthenticatedBookingDownload';const root=createRoot(document.getElementById('root'));window.renderDownloads=(token='synthetic-secret',booking='rental-owned')=>root.render(<><Download bookingId={booking} token={token} kind="invoice" label="Invoice"/><Download bookingId="rental-owned" token="synthetic-secret" kind="return" label="Return statement"/><Download bookingId="rental-owned" token="synthetic-secret" kind="calendar" label="Calendar"/><Download bookingId="rental-foreign" token="synthetic-secret" kind="invoice" label="Foreign invoice"/></>);window.clearDownloads=()=>root.render(null);window.renderDownloads();`;
  const bundle = await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic'});
  const requests = [];
  const server = http.createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('content-type','text/javascript'); return response.end(bundle.outputFiles[0].text); }
    if (request.url.startsWith('/api/')) {
      requests.push({url:request.url,authorization:request.headers.authorization});
      return setTimeout(() => {
        if (request.headers.authorization !== 'Bearer synthetic-secret' || request.url.includes('rental-foreign')) {response.writeHead(403);return response.end('unauthorized');}
        response.writeHead(200,{'content-type':request.url.includes('booking-ics')?'text/calendar; charset=utf-8':'application/pdf'});response.end('synthetic document');
      },150);
    }
    response.end('<div id="root"></div><script>window.downloads=[];HTMLAnchorElement.prototype.click=function(){window.downloads.push({href:this.href,name:this.download})}</script><script src="/bundle.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-download-'));
  const chrome=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{stdio:'ignore'});let client;
  try {
    let port;for(let attempt=0;attempt<100;attempt++){try{port=fs.readFileSync(`${profile}/DevToolsActivePort`,'utf8').split('\n')[0];break}catch{await wait(100)}}assert(port);
    process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;client=await connect();await client.cmd('Runtime.enable');await client.cmd('Page.enable');await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
    for(let attempt=0;attempt<100&&!await client.evaluate('document.querySelectorAll("button").length===4');attempt++)await wait(100);
    assert.equal(await client.evaluate('document.body.innerHTML.includes("synthetic-secret")'),false,'The session secret is absent from rendered markup');
    await client.evaluate('document.querySelectorAll("button")[0].click()');await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("button")[0].getAttribute("aria-busy")'),'true','The loading state is accessible');await wait(250);
    await client.evaluate('document.querySelectorAll("button")[1].click()');await wait(250);
    await client.evaluate('document.querySelectorAll("button")[2].click()');await wait(250);
    await client.evaluate('document.querySelectorAll("button")[3].click()');await wait(250);
    assert.deepEqual(requests.map(item=>item.url),['/api/invoice/rental-owned','/api/invoice/rental-owned?phase=return','/api/booking-ics/rental-owned','/api/invoice/rental-foreign']);
    assert(requests.every(item=>item.authorization==='Bearer synthetic-secret'&&!item.url.includes('synthetic-secret')),'Authentication is sent only in headers');
    const downloads=await client.evaluate('window.downloads');assert.equal(downloads.length,3,'Only owned successful documents download');assert(downloads.every(item=>item.href.startsWith('blob:')&&!item.href.includes('synthetic-secret')));assert(downloads[2].name.endsWith('.ics'));
    assert.equal(await client.evaluate('document.querySelectorAll("[role=alert]").length'),1,'A denied download displays an accessible error');
    await client.evaluate('document.querySelectorAll("button")[0].click()');await wait(25);await client.evaluate(`window.renderDownloads('new-session','another-rental')`);await wait(300);
    assert.equal(await client.evaluate('window.downloads.length'),3,'Switching account and booking cancels the previous download');
    assert.equal(await client.evaluate('document.querySelectorAll("button")[0].disabled'),false,'The replacement account can initiate its own download');
    await client.evaluate('document.querySelectorAll("button")[0].click()');await wait(25);await client.evaluate('window.clearDownloads()');await wait(300);
    assert.equal(await client.evaluate('window.downloads.length'),3,'Unmounting during logout cancels the pending download');
    console.log('PASS authenticated booking downloads: header-only token, loading and error states, return statement, calendar, and denied foreign document. Synthetic server.');
  } finally {
    if(client)client.close();if(chrome.exitCode===null){const done=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await done}server.close();await wait(100);await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
