const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + '\nreturn connect;')(require);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const client = await connect();
  const origin = process.env.DBC_TEST_URL || 'http://127.0.0.1:41901';
  const errors = [];
  try {
    await client.cmd('Page.enable');
    await client.cmd('Runtime.enable');
    if (process.env.DBC_TEST_MOBILE === '1') await client.cmd('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
    client.on(event => { if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') errors.push(event.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ')); });
    await client.cmd('Network.enable');
    await client.cmd('Network.setBlockedURLs', {urls:['*convex.cloud*', '*convex.site*', '*elevenlabs.io*']});
    await client.cmd('Browser.grantPermissions', {origin, permissions:['audioCapture']});
    await client.cmd('Page.addScriptToEvaluateOnNewDocument', {source:`(() => {
      if (${process.env.DBC_TEST_MIC_DENIED === '1'}) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Synthetic refusal', 'NotAllowedError'); };
      const NativeSocket = window.WebSocket;
      window.__voiceSockets = [];
      window.WebSocket = class extends EventTarget {
        constructor(url, protocols) {
          super();
          if (!String(url).startsWith('wss://api.elevenlabs.io/')) return new NativeSocket(url, protocols);
          this.readyState = 0; this.sent = []; window.__voiceSockets.push(this);
          setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }, 10);
        }
        send(value) {
          this.sent.push(value);
          if (this.sent.length === 1) setTimeout(() => this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify({type:'conversation_initiation_metadata', conversation_initiation_metadata_event:{conversation_id:'synthetic',agent_output_audio_format:'pcm_16000',user_input_audio_format:'pcm_16000'}})})), 10);
        }
        close() { this.readyState = 3; this.dispatchEvent(new CloseEvent('close', {code:1000,reason:'synthetic end'})); }
      };
      window.WebSocket.CONNECTING=0; window.WebSocket.OPEN=1; window.WebSocket.CLOSING=2; window.WebSocket.CLOSED=3;
    })();`});
    await client.cmd('Page.navigate', {url:origin});
    for (let attempt=0;attempt<100&&!(await client.evaluate('!!document.querySelector("button[aria-label=\\"Start a voice call with Gaffer\\"]")'));attempt++) await delay(100);
    for (let attempt=0;attempt<150&&!(await client.evaluate(`Object.keys(document.querySelector('button[aria-label="Start a voice call with Gaffer"]')).some(key=>key.startsWith('__reactProps$'))`));attempt++) await delay(100);
    await client.evaluate(`document.documentElement.style.scrollBehavior='auto';[...document.querySelectorAll('button[aria-label="Start a voice call with Gaffer"]')].at(-1).scrollIntoView({block:'center',behavior:'instant'})`);
    await delay(300);
    const position = await client.evaluate(`(() => {const button=[...document.querySelectorAll('button[aria-label="Start a voice call with Gaffer"]')].at(-1),rect=button.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
    const target = await client.evaluate(`(() => {const el=document.elementFromPoint(${position.x},${position.y});return {tag:el?.tagName,outer:el?.outerHTML.slice(0,250)}})()`);
    const screenshot = await client.cmd('Page.captureScreenshot', {format:'png'}); fs.writeFileSync('/tmp/dbc-voice-session-test.png', Buffer.from(screenshot.data,'base64'));
    await client.cmd('Input.dispatchMouseEvent', {type:'mouseMoved',...position});
    await client.cmd('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...position});
    await client.cmd('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...position});
    if (process.env.DBC_TEST_MIC_DENIED === '1') {
      for (let attempt=0;attempt<100&&!(await client.evaluate('document.body.innerText.includes("Microphone blocked")'));attempt++) await delay(100);
      assert(await client.evaluate('document.body.innerText.includes("Microphone blocked")'),'A denied microphone explains the actual problem visibly');
      assert.equal(await client.evaluate('window.__voiceSockets.length'),0,'No provider connection is attempted with a denied microphone');
      const failureScreenshot=await client.cmd('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(`/tmp/dbc-voice-denied-${process.env.DBC_TEST_MOBILE === '1'?'mobile':'desktop'}.png`,Buffer.from(failureScreenshot.data,'base64'));
      console.log('PASS visible microphone refusal with no provider connection.');
      return;
    }
    for (let attempt=0;attempt<150&&!(await client.evaluate('!!document.querySelector("button[data-state=live]")'));attempt++) await delay(100);
    const started = await client.evaluate(`({live:!!document.querySelector('button[data-state=live]'), sockets:window.__voiceSockets.length, labels:[...document.querySelectorAll('button[aria-label*="voice call"]')].map(button=>button.getAttribute('aria-label')), alerts:[...document.querySelectorAll('[role=alert],[role=dialog]')].map(item=>item.textContent.slice(0,250))})`);
    assert(started.live, `The actual voice control starts with a synthetic provider and microphone: ${JSON.stringify({target,position,started,errors})}`);
    assert.equal(await client.evaluate('window.__voiceSockets.length'),1,'One synthetic connection is established');
    await client.evaluate('document.querySelector("button[data-state=live]").click()');
    for(let attempt=0;attempt<100&&!(await client.evaluate('!!document.querySelector("button[data-state=idle]")'));attempt++) await delay(100);
    assert(await client.evaluate('!!document.querySelector("button[data-state=idle]")'),'Ending the call returns to idle');
    assert.equal(await client.evaluate('window.__voiceSockets[0].readyState'),3,'Ending closes the synthetic connection');
    console.log('PASS actual Gaffer button and SDK with real browser audio worklets, a synthetic microphone and mocked provider; no paid call.');
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
