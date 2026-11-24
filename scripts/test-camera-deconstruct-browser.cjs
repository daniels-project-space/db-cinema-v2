const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(root + '/scripts/test-membership-browser.cjs', 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-camera-'));
  await require('esbuild').build({entryPoints:[root + '/scripts/fixtures/camera-deconstruct.tsx'],outfile:dir + '/fixture.js',bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
  const server = http.createServer((req,res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type','text/javascript'); return res.end(fs.readFileSync(dir + '/fixture.js')); }
    if (req.url === '/arri-deconstruct.mp4') {
      const file = root + '/public/arri-deconstruct.mp4', size = fs.statSync(file).size;
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = match ? Number(match[1]) : 0, requestedEnd = match && match[2] ? Number(match[2]) : size - 1, end = Math.min(requestedEnd, size - 1);
      res.writeHead(match ? 206 : 200, {'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(match ? {'Content-Range':`bytes ${start}-${end}/${size}`} : {})});
      return fs.createReadStream(file,{start,end}).pipe(res);
    }
    if (req.url === '/arri-deconstruct-poster.jpg') { res.setHeader('Content-Type','image/jpeg'); return fs.createReadStream(root + '/public/arri-deconstruct-poster.jpg').pipe(res); }
    res.setHeader('Content-Type','text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#050507;color:white}header{height:93px}[data-deconstruct-track]>[data-deconstruct-stage]{position:sticky;top:93px;height:calc(100vh - 93px);overflow:hidden}video{width:100%;height:100%;object-fit:contain}</style></head><body><header></header><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
  const navigateToFreshDocument = async url => {
    const previousTimeOrigin = await browser.evaluate('performance.timeOrigin');
    await browser.cmd('Page.navigate',{url});
    for (let count=0;count<120;count++) {
      const state=await browser.evaluate('({timeOrigin:performance.timeOrigin,readyState:document.readyState})');
      if(state.timeOrigin!==previousTimeOrigin&&state.readyState==='complete')return;
      await wait(25);
    }
    throw new Error(`Navigation did not commit a fresh camera fixture document: ${url}`);
  };
  const waitFor = async expression => {
    for (let count = 0; count < 400; count++) {
      if (await browser.evaluate(expression)) return true;
      await wait(50);
    }
    return false;
  };
  const sampleFrame = async () => {
    for (let count = 0; count < 80; count++) {
      const frame = await browser.evaluate(`(() => {
        const video = document.querySelector('video');
        if (video.seeking || video.readyState < 2) return { readyState: video.readyState, seeking: video.seeking };
        const canvas = document.createElement('canvas');
        canvas.width = 240; canvas.height = 135;
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (let index = 0; index < pixels.length; index += 97) hash = Math.imul(hash ^ pixels[index], 16777619);
        const quality = video.getVideoPlaybackQuality?.();
        return { hash: hash >>> 0, currentTime: video.currentTime, readyState: video.readyState, seeking: video.seeking, paused: video.paused, droppedFrames: quality?.droppedVideoFrames ?? null, presentedFrames: quality?.totalVideoFrames ?? null };
      })()`);
      if (!frame.seeking && frame.readyState >= 2) {
        await wait(80);
        const stable = await browser.evaluate('(() => {const video=document.querySelector("video");return {currentTime:video.currentTime,readyState:video.readyState,seeking:video.seeking,paused:video.paused}})()');
        if (!stable.seeking && stable.readyState >= 2 && Math.abs(stable.currentTime - frame.currentTime) < 0.08) return frame;
      }
      await wait(50);
    }
    return browser.evaluate('(() => {const video=document.querySelector("video");return {readyState:video.readyState,seeking:video.seeking,currentTime:video.currentTime,paused:video.paused}})()');
  };
  try {
    browser = await connect('about:blank'); await browser.cmd('Page.enable'); await browser.cmd('Runtime.enable');
    for (const width of [390,768,1280]) {
      const touch = width <= 768;
      await browser.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      await browser.cmd('Emulation.setDeviceMetricsOverride',{width,height:700,deviceScaleFactor:1,mobile:touch});
      await browser.cmd('Emulation.setTouchEmulationEnabled',touch?{enabled:true,maxTouchPoints:1}:{enabled:false});
      await navigateToFreshDocument(`http://127.0.0.1:${server.address().port}`);
      assert(await waitFor('document.querySelector("video")?.readyState >= 2'), `Video metadata and first frame load at ${width}px`);
      assert(await browser.evaluate('document.querySelector("video").paused'), `The scroll-controlled video does not autoplay at ${width}px`);
      assert(await browser.evaluate('document.querySelector("video").currentSrc.endsWith("/arri-deconstruct.mp4")'), `The camera disassembly source loads at ${width}px`);
      await browser.evaluate(`(()=>{const video=document.querySelector('video');window.__cameraMediaEvents=[];for(const type of ['seeking','seeked','waiting','stalled','error','progress'])video.addEventListener(type,()=>window.__cameraMediaEvents.push({type,time:video.currentTime,readyState:video.readyState,seeking:video.seeking,networkState:video.networkState}));})()`);
      if (touch) {
        const touchPoint={x:24,y:24,id:1,radiusX:1,radiusY:1,force:1};
        await browser.cmd('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touchPoint]});
        await browser.cmd('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[touchPoint]});
        await wait(150);
        assert(await browser.evaluate('document.querySelector("video").paused'), `The mobile priming gesture does not leave the video playing at ${width}px`);
      }
      const points = [0,0.25,0.5,0.75,1], hashes = [], frameMetrics = [];
      let lastTime = 0;
      for (const progress of points) {
        const target = await browser.evaluate(`(() => {
          const track = document.querySelector('[data-deconstruct-track]');
          const stage = track.querySelector('[data-deconstruct-stage]');
          const stickyTop = parseFloat(getComputedStyle(stage).top) || 0;
          const trackDocumentTop = track.getBoundingClientRect().top + scrollY;
          const startScroll = Math.max(0, trackDocumentTop - stickyTop);
          const endScroll = trackDocumentTop + track.offsetHeight - stage.offsetHeight - stickyTop;
          const scrollable = Math.max(1, endScroll - startScroll);
          window.scrollTo({left:0,top:startScroll + scrollable * ${progress},behavior:'instant'});
          return (document.querySelector('video').duration - 0.05) * ${progress};
        })()`);
        const reached=await waitFor(`(() => {const video=document.querySelector('video');return !video.seeking&&video.readyState>=2&&Math.abs(video.currentTime-${target})<0.7})()`);
        const seekState = reached ? null : await browser.evaluate(`(() => {const video=document.querySelector('video');const ranges=[];for(let index=0;index<video.seekable.length;index++)ranges.push([video.seekable.start(index),video.seekable.end(index)]);return{target:${target},currentTime:video.currentTime,readyState:video.readyState,seeking:video.seeking,paused:video.paused,networkState:video.networkState,seekable:ranges,events:window.__cameraMediaEvents.slice(-20)}})()`);
        assert(reached, `Scroll progress ${progress} reaches its intended video time at ${width}px: ${JSON.stringify(seekState)}`);
        const frame = await sampleFrame();
        assert(!frame.seeking && frame.readyState >= 2, `A decoded frame is available at progress ${progress} on ${width}px`);
        assert(frame.currentTime + 0.08 >= lastTime, `Video time does not restart or reverse while scrolling down at ${width}px`);
        lastTime = frame.currentTime; hashes.push(frame.hash);
        if (frame.droppedFrames !== null) frameMetrics.push(frame.droppedFrames);
        if (progress === 0.5 || progress === 1) {
          const shot = await browser.cmd('Page.captureScreenshot',{format:'png'});
          fs.writeFileSync(`/tmp/dbc-camera-deconstruct-${width}-${Math.round(progress*100)}.png`,Buffer.from(shot.data,'base64'));
        }
      }
      assert(new Set(hashes).size >= 3, `The visible camera scene changes through the timeline at ${width}px`);
      console.log(`CAMERA_FRAME_QUALITY ${width}px dropped=${frameMetrics.length ? Math.max(...frameMetrics) : 'unavailable'}`);
      const settled = await sampleFrame(); await wait(500); const idle = await sampleFrame();
      assert(Math.abs(settled.currentTime-idle.currentTime)<0.2 && idle.paused, `The timeline settles without restarting at ${width}px`);
      await browser.evaluate('scrollTo({left:0,top:0,behavior:"instant"})');
      assert(await waitFor('document.querySelector("video").currentTime < 1'), `Scrolling back to the start reverses the disassembly at ${width}px`);
      await browser.evaluate('(() => {const track=document.querySelector("[data-deconstruct-track]"),stage=track.querySelector("[data-deconstruct-stage]"),top=parseFloat(getComputedStyle(stage).top)||0,documentTop=track.getBoundingClientRect().top+scrollY,end=documentTop+track.offsetHeight-stage.offsetHeight-top;scrollTo({left:0,top:end,behavior:"instant"})})()');
      assert(await waitFor('document.querySelector("video").currentTime > 8'), `Returning to the end resumes at the matching frame at ${width}px`);
    }
    await browser.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await browser.cmd('Emulation.setDeviceMetricsOverride',{width:390,height:700,deviceScaleFactor:1,mobile:true});
    await browser.cmd('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await navigateToFreshDocument(`http://127.0.0.1:${server.address().port}`);
    assert(await waitFor('!!document.querySelector("video") && !!document.querySelector("[data-deconstruct-track]")'), 'Reduced-motion camera section mounts on mobile');
    await wait(400);
    const reduced = await browser.evaluate(`(() => {
      const video=document.querySelector('video'), scrubber=document.querySelector('[data-deconstruct-track] [aria-hidden].mx-auto.mt-4'), caption=document.querySelector('[data-deconstruct-track] [style*="opacity"]');
      const poster=new Image(); poster.src=video.poster;
      return {paused:video.paused,time:video.currentTime,scrubberDisplay:scrubber&&getComputedStyle(scrubber).display,captionOpacity:caption&&getComputedStyle(caption).opacity,posterLoaded:poster.complete&&poster.naturalWidth>0};
    })()`);
    assert(reduced.paused && reduced.time < 0.05, 'Reduced motion holds the video at its poster');
    assert.equal(reduced.scrubberDisplay,'none','Reduced motion hides the animated scrubber');
    assert.equal(reduced.captionOpacity,'1','Reduced motion shows the static caption immediately');
    assert(reduced.posterLoaded,'Reduced motion loads the camera poster');
    await browser.evaluate('(() => {const track=document.querySelector("[data-deconstruct-track]"),stage=track.querySelector("[data-deconstruct-stage]"),top=parseFloat(getComputedStyle(stage).top)||0,documentTop=track.getBoundingClientRect().top+scrollY,end=documentTop+track.offsetHeight-stage.offsetHeight-top;scrollTo(0,end)})()'); await wait(700);
    assert(await browser.evaluate('document.querySelector("video").paused&&document.querySelector("video").currentTime<0.05'), 'Reduced-motion scrolling does not animate or decode the video');
    const reducedShot=await browser.cmd('Page.captureScreenshot',{format:'png'}); fs.writeFileSync('/tmp/dbc-camera-deconstruct-reduced-390.png',Buffer.from(reducedShot.data,'base64'));
    console.log('PASS camera timeline at 390/768/1280px and reduced-motion poster behavior.');
  } finally {
    if (browser) {browser.close();await fetch((process.env.DBC_CDP_URL || 'http://localhost:9224') + '/json/close/' + browser.tabId).catch(()=>{});}
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
