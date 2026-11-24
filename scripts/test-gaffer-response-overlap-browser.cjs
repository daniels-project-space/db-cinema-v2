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
    '@/components/gaffer/useGafferTools': `export const useGafferTools=()=>({clientTools:{lookup:async()=>window.lookupFactory?window.lookupFactory():'synthetic tool result'},dynamicVariables:{},noteCustomerMessage:value=>window.customerMessages.push(value),resetPriceRequest(){},noteAgentAlignment(){},noteAgentMessage:value=>window.agentAnswers.push(value),resetSpokenFocus(){}});`,
    '@/components/gaffer/callContext': `export const pageBrief=()=>({intent:'gear',mode:'sales',brief:'synthetic page',opening:'Hello'});export const isSignOff=()=>false;`,
    '@/components/gaffer/hintTiming': `export const createHintController=()=>({reset(){},noteTalking(){}});`,
    '@/components/gaffer/micPermission': `export const micState=async()=> 'granted';export const requestMic=async()=>({ok:true});`,
    '@elevenlabs/client': `export const Conversation={startSession:async config=>{window.voiceConfig=config;const session={mode:'listening',output:{interrupts:0,played:[],interrupt(){this.interrupts++},playAudio(audio){this.played.push(Array.from(new Uint8Array(audio)))}},connection:{lastInterruptTimestamp:0,handleMessage(event){if(event.type==='interruption'){this.lastInterruptTimestamp=event.interruption_event.event_id;config.onInterruption({event_id:event.interruption_event.event_id});session.updateMode('listening');session.output.interrupt()}}},updateMode(mode){if(this.mode===mode)return;this.mode=mode;config.onModeChange({mode})},sendContextualUpdate:value=>window.updates.push(value),sendUserMessage:value=>window.userMessages.push(value),endSession:async()=>config.onDisconnect()};window.voiceSession=session;config.onConversationCreated?.(session);config.onConversationMetadata({conversation_id:'overlap-fixture'});config.onConnect();return session}};`,
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

    await client.evaluate(`(()=>{const c=window.voiceConfig;const s=window.voiceSession;const output=s.output;c.onMessage({source:'user',event_id:90,message:'Tell me one clear answer.'});s.updateMode('speaking');c.onAgentChatResponsePart({type:'start',event_id:91});const first=Uint8Array.of(1,2,3);c.onAudio(btoa(String.fromCharCode(...first)));output.playAudio(first.buffer);c.onAgentChatResponsePart({type:'start',event_id:92});const overlap=Uint8Array.of(4,5,6);c.onAudio(btoa(String.fromCharCode(...overlap)));output.playAudio(overlap.buffer);window.audioAfterOverlap=output.played.slice();c.onMessage({source:'user',event_id:94,message:'Please stop and answer my new question.'});s.connection.handleMessage({type:'interruption',interruption_event:{event_id:95}});const delayed=Uint8Array.of(6,6,6);c.onAudio(btoa(String.fromCharCode(...delayed)));output.playAudio(delayed.buffer);window.audioCountAfterDelayedChunk=output.played.length;c.onAgentChatResponsePart({type:'start',event_id:96,response_id:'replacement-response'});const replacement=Uint8Array.of(7,7,7);c.onAudio(btoa(String.fromCharCode(...replacement)));output.playAudio(replacement.buffer);window.audioCountBeforeInterruption=output.played.length-1;window.audioAfterReplacement=output.played.at(-1)})()`);
    assert.deepEqual(await client.evaluate('window.audioAfterOverlap'), [[1, 2, 3]], 'Audio from an overlapping response is suppressed while the original answer remains intact');
    assert.equal(await client.evaluate('window.audioCountAfterDelayedChunk'), await client.evaluate('window.audioCountBeforeInterruption'), 'Delayed audio after caller-first interruption is blocked');
    assert.deepEqual(await client.evaluate('window.audioAfterReplacement'), [7,7,7], 'Audio resumes only after a fresh response start is accepted');
    await client.evaluate('window.telemetry=[];window.voiceSession.output.played=[]');

    // A single caller turn gets response A. A second provider response starts
    // while A is speaking, then emits late text/stop/final events. None may
    // reset A's stream or replace its answer.
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onMessage({source:'user',event_id:100,message:'Can I extend this rental?'});window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'start',event_id:101,response_id:'response-A'});c.onAgentChatResponsePart({type:'delta',event_id:102,response_id:'response-A',text:'A: I can check the requested '});c.onAgentResponseCorrection({event_id:103,original_agent_response:'A: I can check the requested',corrected_agent_response:'B: the booking is cancelled.'});c.onAgentChatResponsePart({type:'start',event_id:104,response_id:'response-B'});c.onAgentChatResponsePart({type:'delta',event_id:105,response_id:'response-B',text:'B: the booking is cancelled.'});c.onAgentChatResponsePart({type:'stop',event_id:106,response_id:'response-B'});c.onMessage({source:'ai',event_id:107,message:'B: the booking is cancelled.'});window.updatesBeforeInterim=window.updates.length;window.agentMode='listening';c.onModeChange({mode:'listening'});window.intermediateUpdateCount=window.updates.length;window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'delta',event_id:108,response_id:'response-A',text:'dates and show the available extension options.'});c.onMessage({source:'ai',event_id:109,message:'A: I can check the requested dates and show the available extension options.'});window.answersBeforeAudioDone=window.agentAnswers.slice();c.onAgentChatResponsePart({type:'stop',event_id:110,response_id:'response-A'});window.agentMode='listening';c.onModeChange({mode:'listening'})})()`);
    assert.deepEqual(await client.evaluate('window.answersBeforeAudioDone'), ['A: I can check the requested dates and show the available extension options.'], 'Only the matching active response transcript is accepted');
    const correctionTrace = await client.evaluate(`window.telemetry.filter(e=>e.kind==='agent_correction').map(e=>({providerEventId:e.providerEventId,originalResponseChars:e.originalResponseChars,correctedResponseChars:e.correctedResponseChars}))`);
    assert.equal(correctionTrace.length, 1, 'A mid-speech correction is observed without mutating the active transcript');
    assert.equal(correctionTrace[0].providerEventId, 103);
    assert(correctionTrace[0].originalResponseChars > 0 && correctionTrace[0].correctedResponseChars > 0, 'Correction telemetry records lengths only');
    assert(!JSON.stringify(correctionTrace).includes('booking is cancelled'), 'Correction telemetry never contains or substitutes provider text');
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

    // Match the installed SDK's actual wire types: text_response_part and
    // agent_response expose event_id, but no response_id. A second start makes
    // subsequent deltas ambiguous; its final message must never replace the
    // earlier conclusion, and its stop must still release the caller turn.
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onMessage({source:'user',event_id:120,message:'Can I extend this rental?'});window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'start',event_id:121});c.onAgentChatResponsePart({type:'delta',event_id:122,text:'A: I can check the requested dates'});c.onAgentChatResponsePart({type:'start',event_id:123});c.onAgentChatResponsePart({type:'delta',event_id:124,text:'B: the booking is cancelled.'});c.onAgentChatResponsePart({type:'stop',event_id:125});c.onMessage({source:'ai',event_id:126,message:'B: the booking is cancelled.'});window.agentMode='listening';c.onModeChange({mode:'listening'})})()`);
    assert.deepEqual(await client.evaluate('window.agentAnswers'), [
      'A: I can check the requested dates and show the available extension options.',
      'C: I will check the dates and confirm the available choices.',
    ], 'Actual SDK payloads without response IDs cannot replace the prior conclusion with an overlapping answer');
    assert.equal(await client.evaluate('document.querySelectorAll("output")[1].textContent'), 'false', 'The ambiguous response closes cleanly after audio ends');
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onMessage({source:'user',event_id:130,message:'What dates are available?'});window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'start',event_id:131});c.onAgentChatResponsePart({type:'delta',event_id:132,text:'D: I will check the dates.'});c.onAgentChatResponsePart({type:'stop',event_id:133});c.onMessage({source:'ai',event_id:134,message:'D: I will check the dates.'});window.agentMode='listening';c.onModeChange({mode:'listening'})})()`);
    assert.deepEqual(await client.evaluate('window.agentAnswers'), [
      'A: I can check the requested dates and show the available extension options.',
      'C: I will check the dates and confirm the available choices.',
      'D: I will check the dates.',
    ], 'A later caller turn still accepts its own response after an ambiguous turn is discarded');
    // A provider interruption can arrive before any new caller transcript.
    // It closes the current answer but must not, by itself, authorize the
    // agent to start speaking a new conclusion for the same caller turn.
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onMessage({source:'user',event_id:140,message:'Can I change the return time?'});window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'start',event_id:141});c.onAgentChatResponsePart({type:'delta',event_id:142,text:'E: I can check the requested return time.'});c.onAgentChatResponsePart({type:'stop',event_id:143});c.onMessage({source:'ai',event_id:144,message:'E: I can check the requested return time.'});window.agentMode='listening';c.onModeChange({mode:'listening'});window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onInterruption({event_id:145});c.onAgentChatResponsePart({type:'start',event_id:146});c.onAgentChatResponsePart({type:'delta',event_id:147,text:'F: The booking is cancelled.'});c.onAgentChatResponsePart({type:'stop',event_id:148});c.onMessage({source:'ai',event_id:149,message:'F: The booking is cancelled.'});window.agentMode='listening';c.onModeChange({mode:'listening'})})()`);
    assert.deepEqual((await client.evaluate('window.agentAnswers')).slice(-1), ['E: I can check the requested return time.'], 'An interruption without a new caller turn cannot start or replace the answer');

    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onMessage({source:'user',event_id:150,message:'Actually, can I return at 7pm?'});window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'start',event_id:151});c.onAgentChatResponsePart({type:'delta',event_id:152,text:'G: I will check the 7pm return time.'});c.onAgentChatResponsePart({type:'stop',event_id:153});c.onMessage({source:'ai',event_id:154,message:'G: I will check the 7pm return time.'});window.agentMode='listening';c.onModeChange({mode:'listening'})})()`);
    assert.deepEqual((await client.evaluate('window.agentAnswers')).slice(-1), ['G: I will check the 7pm return time.'], 'A genuine caller turn reopens the response gate normally');

    assert.equal(await client.evaluate('window.voiceConfig.clientTools.lookup({}).then(value=>{window.toolResult=value;return value})'), 'synthetic tool result',
      'The synthetic client tool result returns through the real wrapped call');
    await client.evaluate(`(()=>{const c=window.voiceConfig;window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'start',event_id:161});c.onAgentChatResponsePart({type:'delta',event_id:162,text:'H: The tool result confirms the request.'});c.onAgentChatResponsePart({type:'stop',event_id:163});c.onMessage({source:'ai',event_id:164,message:'H: The tool result confirms the request.'});window.agentMode='listening';c.onModeChange({mode:'listening'})})()`);
    assert.deepEqual((await client.evaluate('window.agentAnswers')).slice(-1), ['H: The tool result confirms the request.'], 'A completed tool result can authorize its one same-turn continuation');

    // Parallel results are one logical answer. A partial result must not
    // authorize an early conclusion while a sibling lookup is still pending.
    await client.evaluate(`(()=>{window.lookupResolvers=[];window.lookupFactory=()=>new Promise(resolve=>window.lookupResolvers.push(resolve));const c=window.voiceConfig;c.onMessage({source:'user',event_id:170,message:'Can I extend and add another lens?'});window.pendingLookups=[c.clientTools.lookup({}),c.clientTools.lookup({})]})()`);
    for (let attempt = 0; attempt < 30 && await client.evaluate('window.lookupResolvers.length < 2'); attempt++) await wait(10);
    assert.equal(await client.evaluate('window.lookupResolvers.length'), 2, 'Both synthetic item lookups are in flight');
    await client.evaluate('window.lookupResolvers.shift()("first item is available")');
    await wait(10);
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onAgentChatResponsePart({type:'start',event_id:171});c.onAgentChatResponsePart({type:'delta',event_id:172,text:'I: Both items are available.'});c.onAgentChatResponsePart({type:'stop',event_id:173});c.onMessage({source:'ai',event_id:174,message:'I: Both items are available.'})})()`);
    assert.equal(await client.evaluate('window.agentAnswers.includes("I: Both items are available.")'), false, 'A partial tool set cannot trigger a premature conclusion');
    assert.equal(await client.evaluate('window.lookupResolvers.length'), 1, 'The sibling lookup remains pending');
    await client.evaluate('window.lookupResolvers.shift()("second item is available")');
    await wait(10);
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onAgentChatResponsePart({type:'start',event_id:175});c.onAgentChatResponsePart({type:'delta',event_id:176,text:'J: Both items are available.'});c.onAgentChatResponsePart({type:'stop',event_id:177});c.onMessage({source:'ai',event_id:178,message:'J: Both items are available.'});window.agentMode='listening';c.onModeChange({mode:'listening'})})()`);
    assert.equal(await client.evaluate('window.agentAnswers.at(-1)'), 'J: Both items are available.', 'A complete tool set may deliver one coherent answer');
    assert.equal(await client.evaluate('window.userMessages.length'), 0);

    // Response text can begin before the SDK switches to speaking mode. An
    // interruption in that gap must invalidate the text stream too; relying
    // only on the mode callback leaves its stale final message eligible.
    const answersBeforePreAudioInterruption = await client.evaluate('window.agentAnswers.length');
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onMessage({source:'user',event_id:190,message:'Can I move pickup later?'});c.onAgentChatResponsePart({type:'start',event_id:191});c.onAgentChatResponsePart({type:'delta',event_id:192,text:'K: I can check the later pickup time.'});c.onInterruption({event_id:193});c.onAgentChatResponsePart({type:'delta',event_id:194,text:' The booking is already confirmed.'});c.onAgentChatResponsePart({type:'stop',event_id:195});c.onMessage({source:'ai',event_id:196,message:'K: I can check the later pickup time. The booking is already confirmed.'});c.onModeChange({mode:'listening'})})()`);
    assert.equal(await client.evaluate('window.agentAnswers.length'), answersBeforePreAudioInterruption,
      'An interruption before the speaking-mode edge invalidates the in-progress response and its late final transcript');

    // The provider can associate a caller transcript and its answer with the
    // same turn event ID. A late transcript for that turn must not be treated
    // as a second caller turn that interrupts the answer still playing.
    const answersBeforeLateSameTurnTranscript = await client.evaluate('window.agentAnswers.length');
    const customerMessagesBeforeLateSameTurnTranscript = await client.evaluate('window.customerMessages.length');
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onMessage({source:'user',event_id:200,message:'Can you check my rental dates?'});window.agentMode='speaking';c.onModeChange({mode:'speaking'});c.onMessage({source:'ai',event_id:200,message:'A: I will check those dates.'});c.onMessage({source:'user',event_id:200,message:'Can you check my rental dates?'});c.onMessage({source:'ai',event_id:201,message:'B: the rental is cancelled.'})})()`);
    assert.equal(await client.evaluate('window.customerMessages.length'), customerMessagesBeforeLateSameTurnTranscript + 1,
      'A repeated user transcript with the answered turn ID is not recorded as a new caller turn');
    assert.deepEqual((await client.evaluate('window.agentAnswers')).slice(answersBeforeLateSameTurnTranscript),
      ['A: I will check those dates.'],
      'A late same-turn transcript cannot authorize a second conclusion while the first answer is speaking');

    const answersBeforeLateTranscriptAfterAgentEvent = await client.evaluate('window.agentAnswers.length');
    const customerMessagesBeforeLateTranscriptAfterAgentEvent = await client.evaluate('window.customerMessages.length');
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onMessage({source:'user',event_id:210,message:'Can you check the return time?'});c.onMessage({source:'ai',event_id:211,message:'A: I will check the return time.'});c.onMessage({source:'user',event_id:211,message:'Can you check the return time?'});c.onMessage({source:'ai',event_id:212,message:'B: the booking is already changed.'})})()`);
    assert.equal(await client.evaluate('window.customerMessages.length'), customerMessagesBeforeLateTranscriptAfterAgentEvent + 1,
      'A transcript no newer than the last agent event is not accepted as another turn');
    assert.deepEqual((await client.evaluate('window.agentAnswers')).slice(answersBeforeLateTranscriptAfterAgentEvent),
      ['A: I will check the return time.'],
      'An out-of-order transcript cannot authorize a second response after the matching agent event');
    const answersBeforeStaleInterruption = await client.evaluate('window.agentAnswers.length');
    await client.evaluate(`(()=>{const c=window.voiceConfig;const s=window.voiceSession;c.onMessage({source:'user',event_id:220,message:'Can I extend the camera?'});s.updateMode('speaking');c.onAgentChatResponsePart({type:'start',event_id:221,response_id:'current'});c.onAgentChatResponsePart({type:'delta',event_id:222,response_id:'current',text:'I can check the extension.'});window.interruptsBeforeStale=s.output.interrupts;window.interruptTimestampBeforeStale=s.connection.lastInterruptTimestamp;s.connection.handleMessage({type:'interruption',interruption_event:{event_id:219}});window.staleInterruptionUiMode=s.mode})()`);
    assert.equal(await client.evaluate('window.voiceSession.output.interrupts'), await client.evaluate('window.interruptsBeforeStale'),
      'A stale interruption cannot stop the active audio output');
    assert.equal(await client.evaluate('window.staleInterruptionUiMode'), 'speaking', 'A stale interruption cannot switch the active provider session to listening');
    assert.equal(await client.evaluate('window.voiceSession.connection.lastInterruptTimestamp'), await client.evaluate('window.interruptTimestampBeforeStale'),
      'A stale interruption is dropped before the SDK can rewind its internal audio cutoff');
    await wait(20);
    assert.equal(await client.evaluate('document.querySelectorAll("output")[1].textContent'), 'true', 'The caller-facing speaking state remains active through a stale interruption');
    await client.evaluate(`(()=>{const c=window.voiceConfig;const s=window.voiceSession;c.onAgentChatResponsePart({type:'stop',event_id:223,response_id:'current'});c.onMessage({source:'ai',event_id:224,response_id:'current',message:'I can check the extension.'});s.updateMode('listening')})()`);
    assert.deepEqual((await client.evaluate('window.agentAnswers')).slice(answersBeforeStaleInterruption),
      ['I can check the extension.'], 'The active answer completes normally after the stale interruption is rejected');
    assert.equal(await client.evaluate('window.voiceSession.mode'), 'listening', 'The real audio-completion listening edge is still accepted after the stale event');
    await client.evaluate(`(()=>{const c=window.voiceConfig;const output=window.voiceSession.output;window.audioResponseStartsBefore=window.telemetry.filter(e=>e.kind==='agent_response_start').length;c.onMessage({source:'user',event_id:225,message:'Please continue.'});c.onAgentChatResponsePart({type:'start',event_id:226,response_id:'audio-playback-test'});window.audioResponseStartsAfter=window.telemetry.filter(e=>e.kind==='agent_response_start').length;c.onAudio('AQID');output.playAudio(new Uint8Array([1,2,3]).buffer);output.playAudio(new Uint8Array([4,5,6]).buffer)})()`);
    assert.equal(await client.evaluate('window.audioResponseStartsAfter'), await client.evaluate('window.audioResponseStartsBefore') + 1, 'A fresh caller turn authorizes its response start');
    assert.deepEqual(await client.evaluate('window.voiceSession.output.played'), [[1,2,3]],
      'Only audio chunks approved by the SDK callback reach playback; stale websocket audio is dropped');
    await client.evaluate(`(()=>{const c=window.voiceConfig;const output=window.voiceSession.output;window.longAudioExpected=[];window.longAudioStart=output.played.length;for(let index=0;index<96;index++){const bytes=Uint8Array.of(index,index^255,(index*17)&255);const encoded=btoa(String.fromCharCode(...bytes));c.onAudio(encoded);output.playAudio(bytes.buffer);window.longAudioExpected.push(Array.from(bytes))}})()`);
    assert.deepEqual(await client.evaluate('window.voiceSession.output.played.slice(window.longAudioStart)'),
      await client.evaluate('window.longAudioExpected'),
      'A long spoken response with more than 32 sequential SDK audio callbacks plays every approved chunk');

    await client.evaluate(`(()=>{const c=window.voiceConfig;const s=window.voiceSession;window.interruptCountBeforeValid=s.output.interrupts;c.onMessage({source:'user',event_id:230,message:'Actually, please stop there.'});s.updateMode('speaking');c.onAgentChatResponsePart({type:'start',event_id:231,response_id:'current-valid'});c.onAgentChatResponsePart({type:'delta',event_id:232,response_id:'current-valid',text:'I will check that now.'});const interruptedChunk=Uint8Array.of(240,241,242);c.onAudio(btoa(String.fromCharCode(...interruptedChunk)));const before=s.output.played.length;s.connection.handleMessage({type:'interruption',interruption_event:{event_id:233}});s.output.playAudio(interruptedChunk.buffer);window.interruptedChunkPlayed=s.output.played.length>before;const delayedChunk=Uint8Array.of(242,242,242);c.onAudio(btoa(String.fromCharCode(...delayedChunk)));s.output.playAudio(delayedChunk.buffer);window.delayedChunkPlayed=s.output.played.at(-1)?.[0]===242;c.onMessage({source:'user',event_id:234,message:'Please continue with the date check.'});c.onAgentChatResponsePart({type:'start',event_id:235,response_id:'replacement-valid'});const validChunk=Uint8Array.of(243,244,245);c.onAudio(btoa(String.fromCharCode(...validChunk)));s.output.playAudio(validChunk.buffer);window.validChunkPlayed=s.output.played.at(-1);window.validInterruptionUiMode=s.mode;window.validInterruptTimestamp=s.connection.lastInterruptTimestamp})()`);
    assert.equal(await client.evaluate('window.voiceSession.output.interrupts'), await client.evaluate('window.interruptCountBeforeValid') + 1, 'A valid interruption for the active response still stops playback');
    assert.equal(await client.evaluate('window.validInterruptionUiMode'), 'listening', 'A valid interruption still updates the provider mode');
    assert.equal(await client.evaluate('window.validInterruptTimestamp'), 233, 'A current interruption still advances the SDK audio cutoff');
    assert.equal(await client.evaluate('window.interruptedChunkPlayed'), false, 'A queued audio chunk cannot leak past a valid interruption');
    assert.equal(await client.evaluate('window.delayedChunkPlayed'), false, 'Audio arriving after interruption but before the replacement response start remains suppressed');
    assert.deepEqual(await client.evaluate('window.validChunkPlayed'), [243,244,245], 'Current audio is accepted normally after the interruption');
    await wait(20);
    assert.equal(await client.evaluate('document.querySelectorAll("output")[1].textContent'), 'false', 'A valid interruption still updates the caller-facing speaking state');

    const answersBeforeFinalOnlyOverlap = await client.evaluate('window.agentAnswers.length');
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onMessage({source:'user',event_id:240,message:'Can you check the pickup time?'});c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'start',event_id:241,response_id:'spoken'});c.onAgentChatResponsePart({type:'delta',event_id:242,response_id:'spoken',text:'I will check the pickup time.'});c.onAgentChatResponsePart({type:'start',event_id:243,response_id:'overlapping-final-only'});c.onMessage({source:'ai',event_id:244,message:'The booking has been cancelled.'});c.onMessage({source:'ai',event_id:245,message:'I will check the pickup time.'});c.onAgentChatResponsePart({type:'stop',event_id:246,response_id:'spoken'});c.onModeChange({mode:'listening'})})()`);
    assert.deepEqual((await client.evaluate('window.agentAnswers')).slice(answersBeforeFinalOnlyOverlap),
      ['I will check the pickup time.'],
      'A final-only overlapping response cannot replace the currently spoken answer when the SDK omits response IDs');

    const answersBeforeStaleStart = await client.evaluate('window.agentAnswers.length');
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onMessage({source:'user',event_id:250,message:'What is the pickup time now?'});c.onAgentChatResponsePart({type:'start',event_id:249,response_id:'late-prior-turn'});c.onAgentChatResponsePart({type:'delta',event_id:251,response_id:'late-prior-turn',text:'Old answer: the booking is cancelled.'});c.onAgentChatResponsePart({type:'stop',event_id:252,response_id:'late-prior-turn'});c.onMessage({source:'ai',event_id:253,message:'Old answer: the booking is cancelled.'});c.onModeChange({mode:'speaking'});c.onAgentChatResponsePart({type:'start',event_id:250,response_id:'current-turn'});c.onAgentChatResponsePart({type:'delta',event_id:254,response_id:'current-turn',text:'L: I can check the current pickup time.'});c.onAgentChatResponsePart({type:'stop',event_id:255,response_id:'current-turn'});c.onMessage({source:'ai',event_id:256,response_id:'current-turn',message:'L: I can check the current pickup time.'});c.onModeChange({mode:'listening'})})()`);
    assert.deepEqual((await client.evaluate('window.agentAnswers')).slice(answersBeforeStaleStart),
      ['L: I can check the current pickup time.'],
      'An out-of-order prior-turn response start cannot seize the latest caller turn or replace its conclusion');

    // Reproduce a real interruption/tool race: the caller cuts in while a
    // lookup is running, asks a new question, receives its answer, then the
    // old tool finally returns and tries to continue its previous conclusion.
    await client.evaluate(`(()=>{window.lookupResolvers=[];window.lookupFactory=()=>new Promise(resolve=>window.lookupResolvers.push(resolve));const c=window.voiceConfig;c.onMessage({source:'user',event_id:260,message:'Is the old pickup slot available?'});window.supersededLookup=c.clientTools.lookup({})})()`);
    for (let attempt = 0; attempt < 30 && await client.evaluate('window.lookupResolvers.length < 1'); attempt++) await wait(10);
    assert.equal(await client.evaluate('window.lookupResolvers.length'), 1, 'The first caller turn has one pending lookup');
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onInterruption({event_id:261});c.onAgentChatResponsePart({type:'start',event_id:262});c.onAgentChatResponsePart({type:'delta',event_id:263,text:'A: The old pickup slot is available.'});c.onMessage({source:'ai',event_id:264,message:'A: The old pickup slot is available.'});c.onModeChange({mode:'speaking'});const audio=Uint8Array.of(9,8,7);c.onAudio(btoa(String.fromCharCode(...audio)));window.interruptedToolAudioStart=window.voiceSession.output.played.length;window.voiceSession.output.playAudio(audio.buffer)})()`);
    assert.equal(await client.evaluate('window.agentAnswers.at(-1)'), 'L: I can check the current pickup time.', 'An interrupted lookup cannot publish an old conclusion before the new caller turn arrives');
    assert.equal(await client.evaluate('window.voiceSession.output.played.length'), await client.evaluate('window.interruptedToolAudioStart'), 'Audio from an interrupted tool response is suppressed');
    await client.evaluate(`window.voiceConfig.onMessage({source:'user',event_id:270,message:'Actually, how do I cancel my rental?'})`);
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onAgentChatResponsePart({type:'start',event_id:271,response_id:'cancellation-answer'});c.onAgentChatResponsePart({type:'delta',event_id:272,response_id:'cancellation-answer',text:'C: You can cancel from your rental page.'});c.onAgentChatResponsePart({type:'stop',event_id:273,response_id:'cancellation-answer'});c.onMessage({source:'ai',event_id:274,response_id:'cancellation-answer',message:'C: You can cancel from your rental page.'});c.onModeChange({mode:'listening'})})()`);
    await client.evaluate('window.lookupResolvers.shift()("The old pickup slot is available")');
    const supersededToolResult = await client.evaluate('window.supersededLookup');
    assert.match(supersededToolResult, /outdated|superseded|latest question/i,
      'A completed lookup from a superseded caller turn is explicitly marked stale instead of returning old facts');
    await client.evaluate(`(()=>{const c=window.voiceConfig;c.onAgentChatResponsePart({type:'start',event_id:275,response_id:'stale-tool-continuation'});c.onAgentChatResponsePart({type:'delta',event_id:276,response_id:'stale-tool-continuation',text:'D: The old pickup slot is available.'});c.onAgentChatResponsePart({type:'stop',event_id:277,response_id:'stale-tool-continuation'});c.onMessage({source:'ai',event_id:278,response_id:'stale-tool-continuation',message:'D: The old pickup slot is available.'})})()`);
    assert.deepEqual((await client.evaluate('window.agentAnswers')).slice(-1),
      ['C: You can cancel from your rental page.'],
      'A late continuation from the old tool cannot interrupt or replace the completed new-turn answer');
    console.log('PASS synthetic browser overlap regression: overlapping starts, interruption-only starts, and partial parallel-tool results cannot replace a spoken answer; complete results and genuine caller turns still work.');
  } finally {
    if (client) client.close();
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await done; }
    server.close(); await wait(100); await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
