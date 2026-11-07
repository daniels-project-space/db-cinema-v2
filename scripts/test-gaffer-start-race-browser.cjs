const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const esbuild = require('esbuild');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = path.resolve(__dirname, '..');
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{GafferSessionProvider,useGafferSession}from'./src/components/gaffer/GafferSession';function Control(){const call=useGafferSession();return <><button onClick={()=>call.toggle()}>Call</button><button onClick={()=>call.end()}>End</button><output>{call.state}</output></>}createRoot(document.getElementById('root')).render(<GafferSessionProvider><Control/></GafferSessionProvider>);`;
  const fixtures = {
    'convex/react': `export const useMutation=()=>async()=>{};`,
    '@cvx/_generated/api': `export const api={analytics:{track:'track'}};`,
    '@/lib/session': `export const getSessionId=()=> 'fixture';`,
    'next/navigation': `export const usePathname=()=>'/gear';`,
    '@/components/gaffer/useGafferTools': `export const useGafferTools=()=>({clientTools:{lookup:()=>new Promise(resolve=>window.resolveOldTool=resolve)},dynamicVariables:{},noteCustomerMessage(){},resetPriceRequest(){},noteAgentAlignment(){},noteAgentMessage(){},resetSpokenFocus(){}});`,
    '@/components/gaffer/callContext': `export const pageBrief=()=>({intent:'gear',mode:'sales',brief:'fixture',opening:'Hello'});export const isSignOff=message=>message==='goodbye';`,
    '@/components/gaffer/hintTiming': `export const createHintController=()=>({reset(){},noteTalking(){}});`,
    '@/components/gaffer/micPermission': `export const micState=()=>{window.checks++;return new Promise(resolve=>window.resolvePermission=resolve)};export const requestMic=async()=>({ok:true});`,
    '@elevenlabs/client': `export const Conversation={startSession:async config=>{window.starts++;const sessionNumber=window.starts;window.voiceConfig=config;const session={sendContextualUpdate(value){window.updates.push({sessionNumber,value})},endSession:async()=>{window.ends++;config.onDisconnect()}};config.onConnect();return session}};`,
  };
  const bundle = await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'fixtures',setup(build){build.onResolve({filter:/.*/},args=>fixtures[args.path]?{path:args.path,namespace:'fixture'}:undefined);build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:fixtures[args.path]}));}}]});
  const server = http.createServer((request,response)=>{if(request.url==='/bundle.js'){response.setHeader('content-type','text/javascript');return response.end(bundle.outputFiles[0].text)}response.setHeader('content-type','text/html');response.end('<div id="root"></div><script>window.checks=0;window.starts=0;window.ends=0;window.updates=[];navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){}}]})</script><script src="/bundle.js"></script>')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-voice-race-'));
  const chrome=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{stdio:'ignore'});let client;
  try {
    let port;for(let attempt=0;attempt<100;attempt++){try{port=fs.readFileSync(`${profile}/DevToolsActivePort`,'utf8').split('\n')[0];break}catch{await wait(100)}}assert(port);
    process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;client=await connect();const errors=[];client.on(event=>{if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.exception?.description??event.params.exceptionDetails.text)});await client.cmd('Runtime.enable');await client.cmd('Page.enable');await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
    for(let attempt=0;attempt<100&&!await client.evaluate('document.querySelectorAll("button").length===2');attempt++)await wait(100);
    assert.equal(await client.evaluate('document.querySelectorAll("button").length'),2,errors.join('\n'));await client.evaluate(`(()=>{const button=document.querySelector('button');button.click();button.click()})()`);assert.equal(await client.evaluate('window.checks'),1);
    await client.evaluate(`window.resolvePermission('granted')`);for(let attempt=0;attempt<100&&!await client.evaluate('window.starts===1');attempt++)await wait(100);
    assert.equal(await client.evaluate('window.starts'),1);assert.equal(await client.evaluate('document.querySelector("output").textContent'),'live');
    await client.evaluate(`void (window.oldToolPromise=window.voiceConfig.clientTools.lookup({query:'synthetic previous call'}))`);
    await client.evaluate(`(()=>{const config=window.voiceConfig;config.onModeChange({mode:'speaking'});config.onMessage({source:'user',message:'goodbye'})})()`);await wait(5250);assert.equal(await client.evaluate('window.ends'),0,'The no-response backstop must not cut off speech already underway');await client.evaluate(`(()=>{window.voiceConfig.onInterruption({event_id:0});window.voiceConfig.onModeChange({mode:'listening'})})()`);
    await client.evaluate(`(()=>{const config=window.voiceConfig;config.onMessage({source:'user',message:'goodbye'});config.onModeChange({mode:'speaking'});config.onModeChange({mode:'listening'});config.onInterruption({event_id:1})})()`);await wait(650);assert.equal(await client.evaluate('window.ends'),0,'An interruption cancels an already-scheduled farewell tail, even before the caller transcript');
    await client.evaluate(`(()=>{const config=window.voiceConfig;config.onMessage({source:'user',message:'goodbye'});config.onModeChange({mode:'speaking'});config.onInterruption({event_id:2});config.onModeChange({mode:'listening'})})()`);await wait(5250);assert.equal(await client.evaluate('window.ends'),0,'An interruption before the mode change cancels the five-second backstop and prevents a farewell tail');
    await client.evaluate(`(()=>{const config=window.voiceConfig;config.onMessage({source:'user',message:'goodbye'});config.onModeChange({mode:'speaking'});config.onModeChange({mode:'listening'});config.onModeChange({mode:'speaking'})})()`);await wait(650);assert.equal(await client.evaluate('window.ends'),0,'Speech resuming during the farewell tail must not be cut off');
    await wait(5000);assert.equal(await client.evaluate('window.ends'),0,'A long goodbye must not be cut off by the no-response backstop');
    await client.evaluate(`window.voiceConfig.onInterruption({event_id:3})`);
    await client.evaluate(`(()=>{const config=window.voiceConfig;config.onMessage({source:'user',message:'goodbye'});config.onModeChange({mode:'speaking'});config.onModeChange({mode:'listening'})})()`);await wait(650);assert.equal(await client.evaluate('window.ends'),1,'An uninterrupted farewell still ends the call');
    await client.evaluate(`document.querySelector('button').click()`);assert.equal(await client.evaluate('window.checks'),2);await client.evaluate(`document.querySelectorAll('button')[1].click()`);await client.evaluate(`window.resolvePermission('granted')`);await wait(100);assert.equal(await client.evaluate('window.starts'),1);assert.equal(await client.evaluate('document.querySelector("output").textContent'),'idle');
    await client.evaluate(`document.querySelector('button').click()`);assert.equal(await client.evaluate('window.checks'),3);await client.evaluate(`window.resolvePermission('granted')`);for(let attempt=0;attempt<100&&!await client.evaluate('window.starts===2');attempt++)await wait(100);
    assert.equal(await client.evaluate('window.starts'),2);await client.evaluate(`window.resolveOldTool('private result from prior call')`);await wait(100);
    assert.equal(await client.evaluate(`window.updates.some(update=>update.sessionNumber===2&&update.value.includes('private result from prior call'))`),false,'A delayed result from an ended call must not enter the next call');
    await client.evaluate(`void (window.retryToolPromise=window.voiceConfig.clientTools.lookup({query:'synthetic reconnect'}))`);
    await client.evaluate(`window.voiceConfig.onDisconnect()`);for(let attempt=0;attempt<100&&!await client.evaluate('window.starts===3');attempt++)await wait(100);
    assert.equal(await client.evaluate('window.starts'),3);await client.evaluate(`window.resolveOldTool('result from interrupted connection')`);await wait(100);
    assert.equal(await client.evaluate(`window.updates.some(update=>update.sessionNumber===3&&update.value.includes('result from interrupted connection'))`),true,'A result from the same call must reach its replacement connection');
    await wait(5100);
    await client.evaluate(`(()=>{window.voiceConfig.onMessage({source:'user',message:'goodbye'});window.voiceConfig.onDisconnect()})()`);
    for(let attempt=0;attempt<100&&!await client.evaluate(`document.querySelector('output').textContent==='idle'`);attempt++)await wait(20);
    assert.equal(await client.evaluate(`document.querySelector('output').textContent`),'idle');
    await client.evaluate(`document.querySelector('button').click()`);await client.evaluate(`window.resolvePermission('granted')`);
    for(let attempt=0;attempt<100&&!await client.evaluate('window.starts===4');attempt++)await wait(20);
    assert.equal(await client.evaluate('window.starts'),4);await wait(5200);
    assert.equal(await client.evaluate('window.ends'),1,'A previous disconnected call’s farewell timer must not end a new call');
    await client.evaluate(`window.voiceConfig.onDisconnect()`);
    for(let attempt=0;attempt<100&&!await client.evaluate('window.starts===5');attempt++)await wait(20);
    assert.equal(await client.evaluate('window.starts'),5);
    await client.evaluate(`(()=>{window.voiceConfig.onMessage({source:'user',message:'goodbye'});window.voiceConfig.onDisconnect()})()`);
    await wait(200);
    assert.equal(await client.evaluate('window.starts'),5,'A goodbye during the override probe must not reconnect');
    assert.equal(await client.evaluate(`document.querySelector('output').textContent`),'idle');
    console.log('PASS real React browser lifecycle: repeated starts create one synthetic session; cancelled permission checks cannot start one.');
  } finally {
    if(client)client.close();if(chrome.exitCode===null){const done=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await done}server.close();await wait(100);await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
