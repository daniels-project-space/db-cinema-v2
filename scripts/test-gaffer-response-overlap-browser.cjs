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
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{GafferSessionProvider,useGafferSession}from'./src/components/gaffer/GafferSession';function Control(){const call=useGafferSession();return <><button onClick={()=>call.toggle()}>Call</button><output>{call.state}</output><output>{String(call.speaking)}</output></>}createRoot(document.getElementById('root')).render(<GafferSessionProvider><Control/></GafferSessionProvider>);`;
  const fixtures = {
    'convex/react': `export const useMutation=()=>async args=>{window.telemetry.push(args)};`,
    '@cvx/_generated/api': `export const api={analytics:{track:'track',recordGafferCallTelemetry:'recordGafferCallTelemetry'}};`,
    '@/lib/session': `export const getSessionId=()=> 'synthetic';`,
    'next/navigation': `export const usePathname=()=>'/gear';`,
    '@/components/gaffer/useGafferTools': `export const useGafferTools=()=>({clientTools:{},dynamicVariables:{},noteCustomerMessage:value=>window.customerMessages.push(value),resetPriceRequest(){},noteAgentAlignment(){},noteAgentMessage:value=>window.agentAnswers.push(value),resetSpokenFocus(){}});`,
    '@/components/gaffer/callContext': `export const pageBrief=()=>({intent:'gear',mode:'sales',brief:'synthetic page',opening:'Hello'});export const isSignOff=()=>false;`,
    '@/components/gaffer/hintTiming': `export const createHintController=()=>({reset(){},noteTalking(){}});`,
    '@/components/gaffer/micPermission': `export const micState=async()=> 'granted';export const requestMic=async()=>({ok:true});`,
    '@elevenlabs/client': `export const Conversation={startSession:async config=>{window.voiceConfig=config;const session={sendContextualUpdate:value=>window.updates.push(value),sendUserMessage:value=>window.userMessages.push(value),endSession:async()=>config.onDisconnect()};config.onConversationMetadata({conversation_id:'overlap-fixture'});config.onConnect();return session}};`,
  };
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': '{}' },
    plugins: [{ name: 'fixtures', setup(build) {
      build.onResolve({ filter: /.*/ }, args => fixtures[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: fixtures[args.path] }));
    } }],
  });
  const server = http.createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('content-type', 'text/javascript'); return response.end(bundle.outputFiles[0].text); }
    response.setHeader('content-type', 'text/html');
    response.end('<div id="root"></div><script>window.telemetry=[];window.agentAnswers=[];window.customerMessages=[];window.userMessages=[];window.updates=[];window.agentMode=null;navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){}}]})</script><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-gaffer-overlap-'));
  const chrome = spawn('/opt/google/chrome/chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { stdio: 'ignore' });
  let client;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, 'utf8').split('\n')[0]; break; } catch { await wait(100); } }
    assert(port, 'Synthetic Chrome must expose a debugging port');
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect(`http://127.0.0.1:${server.address().port}`);
    for (let attempt = 0; attempt < 100 && !await client.evaluate('document.querySelector("button") !== null'); attempt++) await wait(50);
    await client.evaluate('document.querySelector("button").click()');
    for (let attempt = 0; attempt < 100 && !await client.evaluate('document.querySelectorAll("output")[0].textContent === "live"'); attempt++) await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("output")[0].textContent'), 'live');
    await client.evaluate('window.initialUpdateCount=window.updates.length');

    // A single caller turn gets response A. A second provider response starts
    // while A is speaking, then emits late text/stop/final events. None may
    // reset A's stream or replace its answer.
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onMessage({source:'user',event_id:100,message:'Can I extend this rental?'});window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'start',event_id:101,response_id:'response-A'});c.onAgentChatResponsePart({type:'delta',event_id:102,response_id:'response-A',text:'A: I can check the requested '});c.onAgentChatResponsePart({type:'start',event_id:103,response_id:'response-B'});c.onAgentChatResponsePart({type:'delta',event_id:104,response_id:'response-B',text:'B: the booking is cancelled.'});c.onAgentChatResponsePart({type:'stop',event_id:105,response_id:'response-B'});c.onMessage({source:'ai',event_id:106,message:'B: the booking is cancelled.'});window.updatesBeforeInterim=window.updates.length;window.agentMode='listening';c.onModeChange({mode:'listening'});window.intermediateUpdateCount=window.updates.length;window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'delta',event_id:107,response_id:'response-A',text:'dates and show the available extension options.'});c.onMessage({source:'ai',event_id:108,message:'A: I can check the requested dates and show the available extension options.'});window.answersBeforeAudioDone=window.agentAnswers.slice();c.onAgentChatResponsePart({type:'stop',event_id:109,response_id:'response-A'});window.agentMode='listening';c.onModeChange({mode:'listening'})})()`);
    assert.deepEqual(await client.evaluate('window.answersBeforeAudioDone'), ['A: I can check the requested dates and show the available extension options.'], 'Only the matching active response transcript is accepted');
    assert.equal(await client.evaluate('window.intermediateUpdateCount'), await client.evaluate('window.updatesBeforeInterim'), 'A brief listening edge during one answer does not flush new context or release the turn');
    const responseEvents = await client.evaluate(`window.telemetry.filter(e=>e.event==='agent_response_start'||e.event==='agent_response_stop'||e.kind==='agent_response_start'||e.kind==='agent_response_stop').map(e=>({event:e.event,kind:e.kind,providerEventId:e.providerEventId}))`);
    assert.equal(responseEvents.filter(event => (event.event ?? event.kind) === 'agent_response_start').length, 1, `The overlapping B start is rejected; telemetry=${JSON.stringify(responseEvents)}`);
    assert.equal(responseEvents.filter(event => (event.event ?? event.kind) === 'agent_response_stop').length, 1, `The overlapping B stop cannot finish A; telemetry=${JSON.stringify(responseEvents)}`);
    assert.deepEqual(await client.evaluate('window.userMessages'), [], 'The client does not inject a competing user message to restart Gaffer');

    // Late events from B remain stale after A completes; a genuine new caller
    // turn can still start response C normally.
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onAgentChatResponsePart({type:'stop',event_id:109,response_id:'response-B'});c.onMessage({source:'user',event_id:111,message:'What dates are available?'});c.onMessage({source:'ai',event_id:112,message:'B: the booking is cancelled.'});window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'start',event_id:113,response_id:'response-C'});c.onAgentChatResponsePart({type:'delta',event_id:114,response_id:'response-C',text:'C: I will check the dates and confirm the available choices.'});c.onAgentChatResponsePart({type:'stop',event_id:115,response_id:'response-C'});c.onMessage({source:'ai',event_id:116,message:'C: I will check the dates and confirm the available choices.'});window.agentMode='listening';c.onModeChange({mode:'listening'})})()`);
    assert.deepEqual(await client.evaluate('window.agentAnswers'), [
      'A: I can check the requested dates and show the available extension options.',
      'C: I will check the dates and confirm the available choices.',
    ], 'Late B events are ignored and the next caller turn accepts its own coherent response');
    assert.equal(await client.evaluate('window.userMessages.length'), 0);
    console.log('PASS synthetic browser overlap regression: stale/overlapping response IDs cannot reset, finish, or replace the active spoken turn; a new caller turn still works.');
  } finally {
    if (client) client.close();
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await done; }
    server.close(); await wait(100); await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
