const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const helper = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", helper.slice(0, helper.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);

function verifyHeroRenditionAssets() {
  const renditions = {
    desktop: ["intro.mp4", "intro2.mp4", "loop.mp4"],
    portrait: ["intro-mobile-portrait.mp4", "intro2-mobile-portrait.mp4", "loop-mobile-portrait.mp4"],
    landscape: ["intro-mobile.mp4", "intro2-mobile.mp4", "loop-mobile.mp4"],
  };
  const expected = { desktop: [1920, 1080], portrait: [750, 1080], landscape: [854, 480] };
  const assets = {};
  for (const [variant, filenames] of Object.entries(renditions)) {
    assets[variant] = filenames.map(filename => {
      const result = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,pix_fmt", "-of", "json", path.join(root, "public", filename)], { encoding: "utf8" });
      if (result.error?.code === "ENOENT") return null;
      assert.equal(result.status, 0, `ffprobe reads the ${variant} video asset ${filename}: ${result.stderr}`);
      const stream = JSON.parse(result.stdout).streams[0];
      assert.deepEqual([stream.width, stream.height], expected[variant], `${filename} retains the approved ${variant} resolution`);
      assert.equal(stream.codec_name, "h264", `${filename} remains H.264 for broad browser playback`);
      assert.equal(stream.pix_fmt, "yuv420p", `${filename} remains broadly hardware-decodable yuv420p`);
      return { filename, ...stream };
    });
    if (assets[variant].every(Boolean)) {
      assert.deepEqual(assets[variant].map(asset => [asset.width, asset.height]), Array(3).fill(expected[variant]), `The first, second and looping shot all use the same ${variant} frame size`);
    }
  }
  return assets;
}

async function main() {
  const assetMetadata = verifyHeroRenditionAssets();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-hero-video-"));
  const entry = path.join(dir, "fixture.tsx");
  fs.writeFileSync(entry, `import React from "react";import{createRoot}from"react-dom/client";import{HeroCinematic}from${JSON.stringify(path.join(root, "src/components/HeroCinematic.tsx"))};createRoot(document.getElementById("root")).render(<main style={{position:"relative",height:"100vh",minHeight:640,overflow:"hidden",background:"#08080a"}}><HeroCinematic categories={[]} rating={{ratingValue:4.73,reviewCountLabel:"1300+"}}/></main>);`);
  const modules = {
    "next/link": `import React from "react";export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
    "@/components/GafferCall": `import React from "react";export function GafferCall({label,className}){return <button className={className}>{label}</button>}`,
    "@/components/icons": `import React from "react";export const IconArrowRight=props=><span aria-hidden="true" {...props}>→</span>;export const IconStar=props=><span aria-hidden="true" {...props}>★</span>`,
  };
  const plugin = {
    name: "hero-video-component-fixture",
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => modules[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: root, contents: modules[args.path] }));
    },
  };

  let browser;
  let chrome;
  let server;
  let profile;
  try {
    await require("esbuild").build({
      absWorkingDir: root,
      nodePaths: [path.join(root, "node_modules")],
      entryPoints: [entry],
      outfile: path.join(dir, "fixture.js"),
      bundle: true,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      tsconfig: path.join(root, "tsconfig.json"),
      plugins: [plugin],
      define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    });
    const globalCss = await require("postcss")([require("@tailwindcss/postcss")({ base: root })]).process(
      fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"),
      { from: path.join(root, "src/app/globals.css") },
    );
    server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/fixture.js") {
        response.setHeader("Content-Type", "application/javascript");
        response.setHeader("Cache-Control", "public, max-age=600");
        return response.end(fs.readFileSync(path.join(dir, "fixture.js")));
      }
      if (pathname === "/fixture.css") {
        response.setHeader("Content-Type", "text/css");
        return response.end(`${globalCss.css}\nbody{margin:0;background:#08080a;color:#fff}`);
      }
      if (pathname === "/") {
        response.setHeader("Content-Type", "text/html");
        response.setHeader("Cache-Control", "no-store");
        return response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
      }
      const filename = path.resolve(root, "public", `.${pathname}`);
      if (!filename.startsWith(path.resolve(root, "public") + path.sep) || !fs.existsSync(filename)) {
        response.writeHead(404).end();
        return;
      }
      const stat = fs.statSync(filename);
      const type = filename.endsWith(".mp4") ? "video/mp4" : filename.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Type", type);
      response.setHeader("Cache-Control", "public, max-age=600");
      const range = request.headers.range;
      if (range) {
        const [, startText, endText] = range.match(/bytes=(\d+)-(\d*)/) ?? [];
        const start = Number(startText ?? 0);
        const end = Math.min(Number(endText || stat.size - 1), stat.size - 1);
        response.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
        fs.createReadStream(filename, { start, end }).pipe(response);
        return;
      }
      response.setHeader("Content-Length", stat.size);
      fs.createReadStream(filename).pipe(response);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-hero-video-chrome-"));
    chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore", detached: true });
    let port;
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
      try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; }
      catch { await wait(100); }
    }
    assert(port, "A temporary Chromium process starts for the isolated hero-video fixture");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect("about:blank");
    await browser.cmd("Page.enable");
    await browser.cmd("Runtime.enable");
    await browser.cmd("Network.enable");
    await browser.cmd("Fetch.enable", { patterns: [{ urlPattern: "*intro.mp4", requestStage: "Request" }] });
    let resolveVideoRequest;
    const videoRequest = new Promise(resolve => { resolveVideoRequest = resolve; });
    const removeListener = browser.on(message => {
      if (message.method === "Fetch.requestPaused" && message.params.request.url.endsWith("/intro.mp4")) resolveVideoRequest(message.params);
    });
    await browser.cmd("Page.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 80 && !await browser.evaluate(`document.querySelectorAll('video').length===3`); attempt++) await wait(40);
    const sourceManifest = await browser.evaluate(`([...document.querySelectorAll('video')]).map(video=>[...video.querySelectorAll('source')].map(source=>({src:source.getAttribute('src'),media:source.getAttribute('media')})))`);
    assert.deepEqual(sourceManifest, [
      [{ src: "/intro.mp4", media: "(min-width: 769px)" }, { src: "/intro-mobile-portrait.mp4", media: "(max-width: 768px) and (orientation: portrait)" }, { src: "/intro-mobile.mp4", media: null }],
      [{ src: "/intro2.mp4", media: "(min-width: 769px)" }, { src: "/intro2-mobile-portrait.mp4", media: "(max-width: 768px) and (orientation: portrait)" }, { src: "/intro2-mobile.mp4", media: null }],
      [{ src: "/loop.mp4", media: "(min-width: 769px)" }, { src: "/loop-mobile-portrait.mp4", media: "(max-width: 768px) and (orientation: portrait)" }, { src: "/loop-mobile.mp4", media: null }],
    ], "The initial, second, and looping clips select matching desktop, mobile portrait and compact landscape encodes");
    const pausedMedia = await Promise.race([videoRequest, wait(7000).then(() => null)]);
    assert(pausedMedia, "The actual HeroCinematic component requests the full-resolution first segment");
    await wait(1100);
    const readyWithoutVideo = await browser.evaluate(`(()=>{const link=document.querySelector('a[href="/gear"]');const video=document.querySelector('video');return{ctaVisible:!!link&&getComputedStyle(link).opacity==="1"&&getComputedStyle(link).pointerEvents!=="none",readyState:video?.readyState,currentTime:video?.currentTime,poster:video?.poster,playControl:!!document.querySelector('[data-testid="hero-video-play"]')}})()`);
    assert.equal(readyWithoutVideo.ctaVisible, true, "The booking and how-it-works actions become visible even while the hero film is still waiting on the network");
    assert(readyWithoutVideo.readyState < 2 && readyWithoutVideo.currentTime === 0, "The first video frame remains blocked during this network simulation");
    assert(readyWithoutVideo.poster.endsWith("/intro-poster.jpg"), "A full-resolution poster remains behind the stalled video");
    const mediaSupport = await browser.evaluate(`(()=>{const video=document.querySelector('video');return{codec:video.canPlayType('video/mp4; codecs="avc1.640032"'),source:video.currentSrc}})()`);
    assert(mediaSupport.codec, "Chromium can decode the H.264 High Profile source used for Opera's Chromium playback path");
    assert(mediaSupport.source.endsWith("/intro.mp4"), "Desktop selects the full-resolution first segment");
    const initialShot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbc-hero-video-startup-network-wait.png", Buffer.from(initialShot.data, "base64"));
    await wait(2100);
    const fallback = await browser.evaluate(`!!document.querySelector('[data-testid="hero-video-play"]')`);
    assert.equal(fallback, false, "A slow but pending video request does not falsely present autoplay as blocked");
    await browser.cmd("Network.emulateNetworkConditions", { offline: false, latency: 1200, downloadThroughput: 48 * 1024, uploadThroughput: 32 * 1024, connectionType: "cellular3g" });
    await browser.evaluate(`(()=>{window.__heroPlaybackStarted=false;document.querySelector('video').addEventListener('playing',()=>window.__heroPlaybackStarted=true,{once:true})})()`);
    await browser.cmd("Fetch.continueRequest", { requestId: pausedMedia.requestId });
    removeListener();
    await browser.cmd("Fetch.disable");
    await wait(5100);
    const slowNetworkState = await browser.evaluate(`(()=>{const video=document.querySelector('video'),link=document.querySelector('a[href="/gear"]');return{started:window.__heroPlaybackStarted,button:!!document.querySelector('[data-testid="hero-video-play"]'),time:video?.currentTime??-1,source:video?.currentSrc,poster:video?.poster,cta:link&&getComputedStyle(link).opacity}})()`);
    assert(slowNetworkState.source.endsWith("/intro.mp4"), "A slow network does not switch desktop to a lower-resolution rendition");
    assert.equal(slowNetworkState.cta, "1", "Booking actions stay visible during sustained 3G playback startup");
    assert(slowNetworkState.poster.endsWith("/intro-poster.jpg"), "The full-resolution still remains available while 3G video data arrives");
    if (!slowNetworkState.started) assert.equal(slowNetworkState.button, true, "A still-unstarted film gets a fallback only after the tolerant startup window");
    const slowNetworkShot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbc-hero-video-startup-slow-network.png", Buffer.from(slowNetworkShot.data, "base64"));
    await browser.cmd("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: "none" });
    for (let attempt = 0; attempt < 80 && !await browser.evaluate("window.__heroPlaybackStarted"); attempt++) await wait(100);
    await wait(1200);
    const recoveredState = await browser.evaluate(`(()=>({started:window.__heroPlaybackStarted,button:!!document.querySelector('[data-testid="hero-video-play"]'),phase:document.querySelectorAll('video')[0]?.currentTime??-1,cta:getComputedStyle(document.querySelector('a[href="/gear"]')).opacity}))()`);
    assert.equal(recoveredState.started, true, "The film recovers and starts automatically when the network returns");
    assert(recoveredState.phase > 0.5, "The film continues beyond its initial decoded frame after the network recovers");
    assert.equal(recoveredState.cta, "1", "The visible CTA stays available after video recovery");
    assert.equal(recoveredState.button, false, "The manual fallback clears when video playback succeeds");
    const recoveryShot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbc-hero-video-startup-recovery.png", Buffer.from(recoveryShot.data, "base64"));
    await browser.evaluate(`(()=>{const video=document.querySelector('video');Object.defineProperty(video,'readyState',{configurable:true,get:()=>HTMLMediaElement.HAVE_CURRENT_DATA});video.dispatchEvent(new Event('waiting'))})()`);
    await wait(2900);
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid="hero-video-play"]')`), true, "A sustained buffer underrun surfaces the same non-blocking manual-play fallback");
    const stallShot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbc-hero-video-stall-fallback.png", Buffer.from(stallShot.data, "base64"));
    await browser.evaluate(`document.querySelector('video').dispatchEvent(new Event('playing'))`);
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid="hero-video-play"]')`), false, "A resumed playing event clears the buffering fallback");
    await browser.cmd("Network.clearBrowserCache");
    await browser.cmd("Network.setCacheDisabled", { cacheDisabled: true });
    await browser.cmd("Page.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.cmd("Fetch.enable", { patterns: [{ urlPattern: "*intro-mobile-portrait.mp4", requestStage: "Request" }] });
    let resolveMobileVideoRequest;
    const mobileVideoRequest = new Promise(resolve => { resolveMobileVideoRequest = resolve; });
    const removeMobileListener = browser.on(message => {
      if (message.method === "Fetch.requestPaused" && message.params.request.url.endsWith("/intro-mobile-portrait.mp4")) resolveMobileVideoRequest(message.params);
    });
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?mobile=1` });
    const pausedMobileMedia = await Promise.race([mobileVideoRequest, wait(7000).then(() => null)]);
    assert(pausedMobileMedia, "Portrait phones request the full-height 750 px hero rendition");
    await wait(1000);
    const mobileState = await browser.evaluate(`(()=>{const video=document.querySelector('video');const link=document.querySelector('a[href="/gear"]');return{source:video?.currentSrc,ctaVisible:!!link&&getComputedStyle(link).opacity==="1",readyState:video?.readyState,currentTime:video?.currentTime}})()`);
    assert(mobileState.source.endsWith("/intro-mobile-portrait.mp4"), "Portrait phones do not fall back to the 480p landscape segment");
    assert.equal(mobileState.ctaVisible, true, "Mobile booking actions remain visible independently of video startup");
    assert(mobileState.readyState < 2 && mobileState.currentTime === 0, "The mobile test is exercising the blocked first-frame state");
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid="hero-video-play"]')`), false, "Portrait video startup remains unobtrusive during its initial network wait");
    const mobileShot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync("/tmp/dbc-hero-video-startup-mobile.png", Buffer.from(mobileShot.data, "base64"));
    await wait(7200);
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid="hero-video-play"]')`), true, "The mobile hero also exposes manual playback when autoplay never gets a frame");
    removeMobileListener();
    await browser.cmd("Fetch.continueRequest", { requestId: pausedMobileMedia.requestId });
    await browser.cmd("Fetch.disable");
    await browser.cmd("Page.setDeviceMetricsOverride", { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true });
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?tablet-portrait=1` });
    for (let attempt = 0; attempt < 80 && !await browser.evaluate(`document.querySelector('video')?.currentSrc.endsWith('/intro-mobile-portrait.mp4')`); attempt++) await wait(40);
    const tabletPortraitState = await browser.evaluate(`(()=>({portrait:window.matchMedia('(max-width: 768px) and (orientation: portrait)').matches,source:document.querySelector('video')?.currentSrc}))()`);
    assert.equal(tabletPortraitState.portrait, true, "A 768px portrait viewport matches the portrait rendition instead of the compact landscape fallback");
    assert(tabletPortraitState.source.endsWith("/intro-mobile-portrait.mp4"), "The 768px portrait viewport selects the 750px portrait rendition");
    console.log(`PASS HeroCinematic startup, slow-network recovery, source-selection, and matching-resolution media checks; assets=${JSON.stringify(assetMetadata)}; throttled=${JSON.stringify(slowNetworkState)}; c1 time=${recoveredState.phase.toFixed(2)}s. Screenshots: /tmp/dbc-hero-video-startup-network-wait.png, /tmp/dbc-hero-video-startup-slow-network.png, /tmp/dbc-hero-video-startup-recovery.png, /tmp/dbc-hero-video-stall-fallback.png, /tmp/dbc-hero-video-startup-mobile.png`);
  } finally {
    browser?.close();
    if (chrome?.exitCode === null) {
      try { process.kill(-chrome.pid, "SIGTERM"); } catch { chrome.kill("SIGTERM"); }
      await Promise.race([new Promise(resolve => chrome.once("exit", resolve)), wait(2000)]);
    }
    if (server) await new Promise(resolve => server.close(resolve));
    if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
