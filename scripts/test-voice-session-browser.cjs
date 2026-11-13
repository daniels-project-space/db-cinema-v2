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
    client.on(event => {
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') errors.push(event.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '));
      if (event.method === 'Runtime.exceptionThrown') errors.push(`${event.params.exceptionDetails.text}: ${event.params.exceptionDetails.exception?.description ?? ''}`);
    });
    await client.cmd('Network.enable');
    await client.cmd('Network.setBlockedURLs', {urls:['*convex.cloud*', '*convex.site*', '*elevenlabs.io*', ...(process.env.DBC_TEST_WORKLET_FAILURE === '1' ? ['*/voice-worklets/*'] : [])]});
    await client.cmd('Browser.grantPermissions', {origin, permissions:['audioCapture']});
    await client.cmd('Page.addScriptToEvaluateOnNewDocument', {source:`(() => {
      // Some headless Chrome builds omit mediaDevices entirely. The product
      // asks for audio after a user gesture, so provide the same synthetic
      // device surface before overriding getUserMedia below.
      if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} });
      if (${process.env.DBC_TEST_DOUBLE_CLICK === '1'}) {
        const query = navigator.permissions.query.bind(navigator.permissions);
        window.__permissionChecks = 0;
        let released = false;
        const status = new EventTarget(); status.state = 'granted';
        navigator.permissions.query = descriptor => descriptor.name === 'microphone' ? (window.__permissionChecks++, released ? Promise.resolve(status) : new Promise(resolve => { window.__resolvePermission = () => { released = true; resolve(status); }; })) : query(descriptor);
      }
      if (${process.env.DBC_TEST_GENERIC_FAILURE === '1'}) localStorage.removeItem('dbc_gaffer_overrides_blocked_at_v2');
      if (${process.env.DBC_TEST_MIC_DENIED !== '1'}) {
        const audio = new AudioContext();
        const oscillator = audio.createOscillator();
        const destination = audio.createMediaStreamDestination();
        oscillator.frequency.value = 440;
        oscillator.connect(destination);
        oscillator.start();
        window.__syntheticMicContext = audio;
        navigator.mediaDevices.getUserMedia = async constraints => {
          if (constraints?.video) throw new DOMException('No synthetic camera', 'NotFoundError');
          return destination.stream;
        };
      }
      if (${process.env.DBC_TEST_MIC_DENIED === '1'}) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Synthetic refusal', 'NotAllowedError'); };
      if (${process.env.DBC_TEST_WORKLET_FAILURE === '1'}) {
        const audio = new AudioContext();
        Object.getPrototypeOf(audio.audioWorklet).addModule = async () => { throw new Error('Synthetic worklet initialization failure'); };
        void audio.close();
      }
      const NativeSocket = window.WebSocket;
      window.__voiceSockets = [];
      window.WebSocket = class extends EventTarget {
        constructor(url, protocols) {
          super();
          if (/\.convex\.(cloud|site)(?:[/:?]|$)/.test(String(url))) return new NativeSocket('ws://127.0.0.1:9/blocked-convex');
          if (!String(url).startsWith('wss://api.elevenlabs.io/')) return new NativeSocket(url, protocols);
          this.readyState = 0; this.sent = []; window.__voiceSockets.push(this);
          if (${process.env.DBC_TEST_GENERIC_FAILURE === '1'} && window.__voiceSockets.length === 1) {
            setTimeout(() => { this.readyState = 3; this.dispatchEvent(new CloseEvent('close', {code:1011,reason:'Synthetic generic failure'})); }, 10);
          } else setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }, ${process.env.DBC_TEST_RECONNECT === '1' ? 'window.__voiceSockets.length === 2 ? 3000 : 10' : '10'});
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
    for (let attempt=0;attempt<150&&!(await client.evaluate(`Object.keys([...document.querySelectorAll('button[aria-label="Start a voice call with Gaffer"]')].at(-1)??{}).some(key=>key.startsWith('__reactProps$'))`));attempt++) await delay(100);
    const hydrated = await client.evaluate(`Object.keys([...document.querySelectorAll('button[aria-label="Start a voice call with Gaffer"]')].at(-1)??{}).some(key=>key.startsWith('__reactProps$'))`);
    assert(hydrated, `The targeted voice button must hydrate before testing a call. ${JSON.stringify({url:origin,errors,body:(await client.evaluate('document.body.innerText')).slice(0,700)})}`);
    await client.evaluate(`document.documentElement.style.scrollBehavior='auto';[...document.querySelectorAll('button[aria-label="Start a voice call with Gaffer"]')].at(-1).scrollIntoView({block:'center',behavior:'instant'})`);
    await delay(300);
    const position = await client.evaluate(`(() => {const button=[...document.querySelectorAll('button[aria-label="Start a voice call with Gaffer"]')].at(-1),rect=button.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
    const target = await client.evaluate(`(() => {const el=document.elementFromPoint(${position.x},${position.y});return {tag:el?.tagName,outer:el?.outerHTML.slice(0,250)}})()`);
    const screenshot = await client.cmd('Page.captureScreenshot', {format:'png'}); fs.writeFileSync('/tmp/dbc-voice-session-test.png', Buffer.from(screenshot.data,'base64'));
    await client.cmd('Input.dispatchMouseEvent', {type:'mouseMoved',...position});
    await client.cmd('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...position});
    await client.cmd('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...position});
    if (process.env.DBC_TEST_DOUBLE_CLICK === '1') {
      await client.cmd('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...position});
      await client.cmd('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...position});
      assert.equal(await client.evaluate('window.__permissionChecks'),1,'Two rapid clicks start only one permission check');
      await client.evaluate('window.__resolvePermission()');
    }
    // Gaffer now explains microphone access in its own modal before opening
    // Chrome's permission prompt. Browser-granted synthetic audio does not
    // bypass that user gesture, so drive the same visible button a renter
    // would use before asserting connection or failure behavior.
    if (process.env.DBC_TEST_MIC_DENIED !== '1' && process.env.DBC_TEST_DOUBLE_CLICK !== '1') {
      for (let attempt=0;attempt<80&&!(await client.evaluate(`!!(document.querySelector('#mic-ask-title') || document.querySelector('button[data-state=live]'))`));attempt++) await delay(100);
      const micTitle = await client.evaluate(`document.querySelector('#mic-ask-title')?.textContent?.trim() ?? ''`);
      if (micTitle === 'Gaffer needs your mic') {
        const allowButton = await client.evaluate(`(() => { const button=[...document.querySelectorAll('[role=dialog] button')].find(item=>item.textContent.includes('Allow microphone')); if(!button)return false; button.click(); return true; })()`);
        assert.notEqual(allowButton, false, 'The microphone explainer exposes its real allow action');
        for (let attempt=0;attempt<100&&!(await client.evaluate(`!document.querySelector('#mic-ask-title') || document.body.innerText.includes('Audio couldn\\'t start on this device') || document.body.innerText.includes('Couldn\\'t start the call')`));attempt++) await delay(100);
      }
    }
    if (process.env.DBC_TEST_WORKLET_FAILURE === '1') {
      for (let attempt=0;attempt<150&&!(await client.evaluate('document.body.innerText.includes("Audio couldn\u0027t start on this device")'));attempt++) await delay(100);
      assert(await client.evaluate('document.body.innerText.includes("Audio couldn\u0027t start on this device")'),'Audio initialization failure explains the problem visibly');
      assert.equal(await client.evaluate('window.__voiceSockets.length'),1,'An audio failure is not retried as an override failure');
      assert.equal(await client.evaluate('window.__voiceSockets[0].readyState'),3,'Failed setup closes the synthetic provider socket');
      console.log('PASS actionable audio failure with one closed synthetic provider connection.');
      return;
    }
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
    const started = await client.evaluate(`({live:!!document.querySelector('button[data-state=live]'), sockets:window.__voiceSockets.length, labels:[...document.querySelectorAll('button[aria-label*="voice call"]')].map(button=>({label:button.getAttribute('aria-label'),state:button.dataset.state,hydrated:Object.keys(button).some(key=>key.startsWith('__reactProps$'))})), micDialog:document.querySelector('#mic-ask-title')?.textContent, alerts:[...document.querySelectorAll('[role=alert],[role=dialog]')].map(item=>item.textContent.slice(0,250))})`);
    assert(started.live, `The actual voice control starts with a synthetic provider and microphone: ${JSON.stringify({target,position,started,errors})}`);
    assert.equal(await client.evaluate('window.__voiceSockets.length'),process.env.DBC_TEST_GENERIC_FAILURE === '1' ? 2 : 1,'A generic initial rejection retains the one-time fallback');
    if (process.env.DBC_TEST_RECONNECT === '1') {
      await client.evaluate('window.__voiceSockets[0].close()');
      for (let attempt=0;attempt<50&&!(await client.evaluate('window.__voiceSockets.length === 2'));attempt++) await delay(100);
      assert.equal(await client.evaluate('window.__voiceSockets.length'),2,'A dropped call starts one replacement connection');
      assert(await client.evaluate('!!document.querySelector("button[data-state=connecting]")'),'The call does not claim to be live while reconnecting');
      assert.equal(await client.evaluate('document.querySelector("button[data-state=connecting]")?.getAttribute("aria-label")'),'Cancel connection to Gaffer','The reconnecting control has an accessible cancel label');
      assert.equal(await client.evaluate('[...document.querySelectorAll("span")].some(span => /^On call ·/.test(span.textContent.trim()))'),false,'The chat launcher does not claim the reconnecting call is live');
      const reconnectScreenshot = await client.cmd('Page.captureScreenshot', {format:'png'});
      fs.writeFileSync(`/tmp/dbc-voice-reconnect-${process.env.DBC_TEST_MOBILE === '1' ? 'mobile' : 'desktop'}.png`, Buffer.from(reconnectScreenshot.data, 'base64'));
      for (let attempt=0;attempt<80&&!(await client.evaluate('!!document.querySelector("button[data-state=live]")'));attempt++) await delay(100);
      assert(await client.evaluate('!!document.querySelector("button[data-state=live]")'),'The replacement connection becomes live');
    }
    await client.evaluate('document.querySelector("button[data-state=live]").click()');
    for(let attempt=0;attempt<100&&!(await client.evaluate('!!document.querySelector("button[data-state=idle]")'));attempt++) await delay(100);
    assert(await client.evaluate('!!document.querySelector("button[data-state=idle]")'),'Ending the call returns to idle');
    assert.equal(await client.evaluate('window.__voiceSockets.at(-1).readyState'),3,'Ending closes the synthetic connection');
    console.log('PASS actual Gaffer button and SDK with real browser audio worklets, a synthetic microphone and mocked provider; no paid call.');
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`);
  }
})().catch(error=>{console.error(error);process.exitCode=1});
