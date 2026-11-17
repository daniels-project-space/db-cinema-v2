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
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-chat-attachment-preview-'));
  const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{ChatAttachmentPreview}from'./src/components/rentals/ChatAttachmentPreview';window.__requests=[];window.fetch=async(url,options)=>{window.__requests.push({url:String(url),authorization:options?.headers?.Authorization});const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d');context.fillStyle='#bd946e';context.fillRect(0,0,640,480);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));return new Response(blob,{status:200,headers:{'Content-Type':'image/png'}})};createRoot(document.getElementById('root')).render(<><ChatAttachmentPreview token='secret-fixture-token' id='attachment_image' name='camera-test.png' contentType='image/png' bookingId='booking_fixture' accountId='account_fixture' admin/><ChatAttachmentPreview token='secret-fixture-token' id='attachment_pdf' name='rental-note.pdf' contentType='application/pdf' bookingId='booking_fixture' accountId='account_fixture' admin/></>);`;
  await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:path.join(directory,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}','process.env.NEXT_PUBLIC_CONVEX_URL':'"https://fixture.convex.cloud"'}});
  const css=(await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')})).css;
  const server=http.createServer((request,response)=>{if(request.url==='/fixture.js'){response.setHeader('content-type','application/javascript');return response.end(fs.readFileSync(path.join(directory,'fixture.js')))}if(request.url==='/fixture.css'){response.setHeader('content-type','text/css');return response.end(css)}response.setHeader('content-type','text/html');response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body style="background:#111;color:white"><main id="root" style="width:min(100% - 24px,360px);margin:20px auto"></main><script src="/fixture.js"></script>')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let client,browser;
  try{
    if(!process.env.DBC_CDP_URL){const profile=path.join(directory,'chrome');browser=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(portFile);i++)await wait(100);if(!fs.existsSync(portFile))throw Error('Temporary Chrome did not start');process.env.DBC_CDP_URL=`http://127.0.0.1:${fs.readFileSync(portFile,'utf8').split('\n')[0]}`;}
    client=await connect('about:blank');await client.cmd('Page.enable');await client.cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
    for(let i=0;i<100&&!await client.evaluate(`!!document.querySelector('[data-testid="chat-attachment-attachment_image"] img')`);i++)await wait(50);
    assert(await client.evaluate(`(()=>{const image=document.querySelector('[data-testid="chat-attachment-attachment_image"] img');return image?.complete&&image.naturalWidth===640&&image.alt==='camera-test.png'&&image.getBoundingClientRect().width<=364})()`),'Verified image appears inline, sized for the phone, with its filename');
    const request=await client.evaluate(`window.__requests[0]`);assert(request.url.includes('/chat-attachment?')&&request.url.includes('bookingId=booking_fixture')&&request.url.includes('accountId=account_fixture')&&request.url.includes('admin=1')&&request.url.includes('preview=attachment_image'));assert.equal(request.authorization,'Bearer secret-fixture-token');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="chat-attachment-attachment_pdf"] img')`),null,'Non-image files are not embedded as images');assert(await client.evaluate(`document.querySelector('[data-testid="chat-attachment-attachment_pdf"]').textContent.includes('rental-note.pdf')`),'Other file types keep a download tile');
    await client.evaluate(`document.querySelector('[data-testid="chat-attachment-attachment_image"] button').click()`);for(let i=0;i<100&&await client.evaluate(`window.__requests.filter(x=>x.url.includes('download=')).length===0`);i++)await wait(25);
    const download=await client.evaluate(`window.__requests.find(x=>x.url.includes('download='))`);assert(download?.url.includes('download=attachment_image')&&download.authorization==='Bearer secret-fixture-token','Download uses the same authenticated, scoped route');
    assert.equal(await client.evaluate(`document.documentElement.scrollWidth>innerWidth`),false,'Message preview fits the phone width');fs.writeFileSync('/tmp/dbc-chat-attachment-preview-phone.png',Buffer.from((await client.cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
    console.log('PASS chat attachment display: authenticated lazy image preview, secure download, non-image file tile and phone width; synthetic image only.');
  }finally{if(client){client.close();try{await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`)}catch{}}if(browser&&browser.exitCode===null){const exited=new Promise(resolve=>browser.once('exit',resolve));browser.kill();await exited}await new Promise(resolve=>server.close(resolve));await fs.promises.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
})().catch(error=>{console.error(error);process.exitCode=1});
