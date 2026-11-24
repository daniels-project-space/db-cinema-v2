const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");

const root = path.resolve(__dirname, "..");
const browserSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", browserSource.slice(0, browserSource.indexOf("const { ConvexHttpClient")) + "\nreturn connect;")(require);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForCondition(check, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {}
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function navigateToFreshDocument(browser, url) {
  const previousTimeOrigin = await browser.evaluate("performance.timeOrigin").catch(() => null);
  await browser.cmd("Page.navigate", { url });
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const documentState = await browser.evaluate("({ readyState: document.readyState, timeOrigin: performance.timeOrigin, href: location.href })");
      if (documentState.readyState === "complete" && documentState.href === url && documentState.timeOrigin !== previousTimeOrigin) return;
    } catch {}
    await delay(25);
  }
  throw new Error(`Navigation did not reach a fresh loaded document: ${url}`);
}
async function removeChromeProfileWithRetry(directory) {
  const retryableCodes = new Set(["ENOTEMPTY", "EBUSY", "EPERM"]);
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!retryableCodes.has(error?.code) || attempt === 7) throw error;
      await delay(150 * (attempt + 1));
    }
  }
}

(async () => {
  const siteHeader = fs.readFileSync(path.join(root, "src/components/SiteHeader.tsx"), "utf8");
  const homePage = fs.readFileSync(path.join(root, "src/app/page.tsx"), "utf8");
  const hero = fs.readFileSync(path.join(root, "src/components/HeroCinematic.tsx"), "utf8");
  assert.doesNotMatch(siteHeader, /href:\s*["']\/#reviews["'][^\n]*label:\s*["']Reviews["']/, "Reviews are not duplicated into the top navigation");
  assert.match(hero, /href="\/#reviews"[\s\S]*?data-testid="hero-review-link"[\s\S]*?aria-label=\{`Rated \$\{rating\.ratingValue\.toFixed\(2\)\} out of 5 from \$\{rating\.reviewCountLabel\} renter reviews; read all reviews`\}[\s\S]*?data-testid="hero-review-summary"[\s\S]*?rating\.reviewCountLabel/, "The hero restores the precise rating-and-review-count link to the existing review section");
  const bookingCta = hero.indexOf("Book rental gear");
  const heroReviewLink = hero.indexOf('data-testid="hero-review-link"');
  assert(bookingCta >= 0 && heroReviewLink > bookingCta, "The short review line stays below the booking controls in the hero");
  assert.doesNotMatch(hero.match(/data-testid="hero-review-link"[\s\S]*?<\/Link>/)?.[0] ?? "", /min-h-11|rounded-full/, "The hero review link stays a simple text line, not a large tile");
  const catalogue = homePage.indexOf("<HomeCategoryGrid categories={categories} />");
  const reviewSection = homePage.indexOf('id="reviews"');
  const reviewCarousel = homePage.indexOf("<ReviewCarousel", reviewSection);
  const stats = homePage.indexOf("<HomeStats", reviewSection);
  const filmFund = homePage.indexOf("<FilmFundInvite", reviewSection);
  const hyggloProfile = homePage.indexOf('id="hygglo-profile-title"', reviewSection);
  assert(catalogue >= 0 && reviewSection > catalogue, "The full reviews section remains below the catalogue");
  assert(reviewSection >= 0 && reviewCarousel > reviewSection && stats > reviewCarousel, "The rating and review totals remain after the reviews carousel");
  assert(filmFund > stats && hyggloProfile > filmFund, "Film Fund remains before the Hygglo profile link at the bottom");
  assert(homePage.includes('href="https://hygglo.com/uk/users/dbcinemarentals"') && homePage.includes("Explore our Hygglo profile"), "Keep the dedicated bottom tile linked to the public profile as the review-source path");

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-home-review-showcase-"));
  const mocks = {
    name: "home-review-showcase-fixture",
    setup(build) {
      build.onResolve({ filter: /^(next\/(image|link)|convex\/react|@cvx\/_generated\/api)$/ }, args => ({ path: args.path, namespace: "home-review-fixture" }));
      build.onResolve({ filter: /^@\/components\/icons$/ }, () => ({ path: "icons", namespace: "home-review-fixture" }));
      build.onLoad({ filter: /.*/, namespace: "home-review-fixture" }, args => {
        const modules = {
          "next/image": `import React from "react";export default function Image({fill,sizes,style,...props}){return React.createElement("img",{...props,style:fill?{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",...style}:style})}`,
          "next/link": `import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}`,
          "convex/react": `export function useQuery(){return globalThis.__nativeReviews}`,
          "@cvx/_generated/api": `export const api={reviews:{listNativePublished:"reviews:listNativePublished"}}`,
          icons: `import React from "react";const make=(glyph)=>function Icon(props){return React.createElement("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",...props},React.createElement("path",{d:glyph}))};export const IconStar=make("M12 2l3 7h7l-5.5 4.5 2 8L12 17l-6.5 4.5 2-8L2 9h7z");export const IconChevronLeft=make("M15 18l-6-6 6-6");export const IconChevronRight=make("M9 18l6-6-6-6")`,
        };
        return { loader: "jsx", resolveDir: root, contents: modules[args.path] };
      });
    },
  };
  await esbuild.build({ entryPoints: [path.join(__dirname, "fixtures/home-review-showcase.tsx")], outfile: path.join(directory, "fixture.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), plugins: [mocks], define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
  const css = await postcss([require("@tailwindcss/postcss")({ base: root })]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#08080a;color:white}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
  const image = path.join(root, "public/images/home/maintained-cinema-gear-20261028.webp");
  let brokenPhotoRequests = 0;
  let brokenNativePhotoRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); return response.end(fs.readFileSync(path.join(directory, "fixture.js"))); }
    if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); return response.end(css.css); }
    if (request.url === "/images/home/maintained-cinema-gear-20261028.webp") { response.setHeader("Content-Type", "image/webp"); return fs.createReadStream(image).pipe(response); }
    const requestUrl = new URL(request.url, "http://localhost");
    if (requestUrl.pathname === "/broken-review-photo.jpg") {
      brokenPhotoRequests++;
      if (requestUrl.searchParams.get("source") === "native") brokenNativePhotoRequests++;
      response.writeHead(404);
      return response.end("Synthetic missing review photo");
    }
    response.setHeader("Content-Type", "text/html"); response.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const chromeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-home-review-chrome-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${chromeDir}`, "about:blank"], { stdio: "ignore" });
  let browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(path.join(chromeDir, "DevToolsActivePort"), "utf8").split("\n")[0]; break; } catch { await delay(100); } }
    assert(port, "Chrome starts for the local visual fixture");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect();
    await browser.cmd("Page.enable");
    await browser.cmd("Runtime.enable");
    await browser.cmd("Network.enable");
    await browser.cmd("Network.setCacheDisabled", { cacheDisabled: true });
    await browser.cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    for (const [width, height] of [[320, 1250], [359, 1250], [360, 1250], [390, 1250], [420, 1250], [639, 1250], [640, 1200], [1024, 1200], [1440, 1200], [2560, 1440]]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: width < 768 ? 3 : 1, mobile: width < 768 });
      const url = `http://127.0.0.1:${server.address().port}/?view=${width}`;
      const priorPhotoRequests = brokenPhotoRequests;
      const priorNativePhotoRequests = brokenNativePhotoRequests;
      await navigateToFreshDocument(browser, url);
      const featuredCard = '[data-testid="hygglo-trust-card"]';
      try {
        await waitForCondition(() => browser.evaluate(`!!document.querySelector('${featuredCard}')`), `the featured review tile at ${width}px`);
      } catch (error) {
        const pageState = await browser.evaluate(`(() => ({readyState:document.readyState,href:location.href,root:document.querySelector('#root')?.innerHTML.slice(0,1200),body:document.body.innerText.slice(0,500)}))()`);
        throw new Error(`${error.message}; page state: ${JSON.stringify(pageState)}`);
      }
      const emptyReviewFallback = await browser.evaluate(`(() => {const card=document.querySelector('[data-testid="empty-review-fallback"] [data-testid="hygglo-trust-card"]');return{href:card?.getAttribute('href'),label:card?.getAttribute('aria-label'),copy:card?.textContent,eye:!!card?.querySelector('[data-testid="review-eye-glyph"]')}})()`);
      assert.equal(emptyReviewFallback.href, "/#reviews", `An empty review feed leaves a useful link at ${width}px`);
      assert.equal(emptyReviewFallback.label, "Explore renter reviews", `The empty-feed fallback is truthfully labelled at ${width}px`);
      assert.match(emptyReviewFallback.copy, /Real stories from London crews/);
      assert(emptyReviewFallback.eye, `The empty-feed fallback preserves the standalone eye mark at ${width}px`);
      await browser.evaluate(`document.querySelector('${featuredCard}')?.scrollIntoView({block:"center",behavior:"instant"})`);
      await waitForCondition(
        () => browser.evaluate(`!!document.querySelector('${featuredCard} [data-testid="reviewer-avatar-fallback"]') && !document.querySelector('${featuredCard} img[src^="/broken-review-photo.jpg"]')`),
        `the featured tile's broken-photo fallback at ${width}px`,
      );
      assert(brokenPhotoRequests > priorPhotoRequests, `The browser requests the intentionally missing reviewer photo at ${width}px`);
      assert(await browser.evaluate(`!!document.querySelector('${featuredCard} [data-testid="reviewer-avatar-fallback"]')`), `The featured tile's missing source photo falls back to reviewer initials at ${width}px`);
      assert.equal(await browser.evaluate(`document.querySelectorAll('${featuredCard} img[src^="/broken-review-photo.jpg"]').length`), 0, `The featured tile replaces its failed source image rather than showing a broken-image icon at ${width}px`);
      await browser.evaluate('document.querySelector("[data-testid=review-carousel]")?.scrollIntoView({block:"center",behavior:"instant"})');
      await waitForCondition(() => brokenNativePhotoRequests > priorNativePhotoRequests, `the native review's broken-photo request at ${width}px`);
      assert(brokenNativePhotoRequests > priorNativePhotoRequests, `The native review carousel requests its failed-photo fixture at ${width}px`);
      await waitForCondition(
        () => browser.evaluate(`(() => {const avatar=document.querySelector('[data-testid="review-card"] figcaption > span');return Boolean(avatar && !avatar.querySelector('img') && avatar.textContent.trim()==="C")})()`),
        `the native review card's initials fallback at ${width}px`,
      );
      assert.equal(await browser.evaluate('document.querySelector("[data-testid=review-card] figcaption > span img[src^=\\"/broken-review-photo.jpg\\"]")'), null, `The native review card replaces its failed source image rather than showing a broken-image icon at ${width}px`);
      const nativeAvatar = await browser.evaluate(`(() => {const avatar=document.querySelector('[data-testid="review-card"] figcaption > span');return{hasImage:Boolean(avatar?.querySelector('img')),initials:avatar?.textContent.trim()}})()`);
      assert.deepEqual(nativeAvatar, { hasImage: false, initials: "C" }, `A failed native reviewer photo safely falls back to initials at ${width}px`);
      const card = '[data-testid="hygglo-trust-card"]';
      const initial = await browser.evaluate(`(() => {const tile=document.querySelector('${card}'),eye=tile.querySelector('[data-testid="review-eye-glyph"]'),label=tile.querySelector('span.inline-flex'),panel=tile.querySelector('.hygglo-trust-review-panel'),quote=tile.querySelector('blockquote'),r=tile.getBoundingClientRect(),e=eye.getBoundingClientRect(),l=label.getBoundingClientRect();return{href:tile.getAttribute('href'),height:r.height,eye:{width:e.width,height:e.height,left:e.left,right:e.right},label:{text:label.textContent.trim(),left:l.left,right:l.right,width:label.clientWidth,scrollWidth:label.scrollWidth},tile:{left:r.left,right:r.right},blur:getComputedStyle(panel).backdropFilter,lineClamp:getComputedStyle(quote).webkitLineClamp,rows:document.querySelectorAll('[data-testid=hygglo-review-row]').length,trackState:getComputedStyle(document.querySelector('.hygglo-review-track')).animationPlayState}})()`);
      assert.equal(initial.href, "/#reviews", `Featured tile links to the review section at ${width}px`);
      assert.equal(initial.label.text, "Trust that is earned", `The complete trust label remains present at ${width}px`);
      assert(initial.label.scrollWidth <= initial.label.width && initial.label.left >= initial.tile.left && initial.label.right <= initial.eye.left && initial.eye.right <= initial.tile.right, `The trust label and standalone eye stay fully inside the tile without clipping or overlap at ${width}px: ${JSON.stringify(initial)}`);
      assert(initial.eye.width >= 36 && initial.eye.height >= 36, `The standalone eye stays large at ${width}px: ${JSON.stringify(initial)}`);
      assert.match(initial.blur, /blur\(/, `The review sits on a frosted glass card at ${width}px`);
      assert.equal(initial.lineClamp, width < 640 ? "2" : "3", `The featured review uses a responsive quote clamp at ${width}px`);
      assert.equal(initial.rows, 3, `All 100 source reviews render into three marquee rows at ${width}px`);
      assert.equal(await browser.evaluate(`Array.from(document.querySelectorAll('[data-testid="hygglo-review-card"]')).some(card=>/hygglo/i.test(card.textContent))`), false, `Individual review cards do not display the marketplace name at ${width}px`);
      assert.equal(initial.trackState, "running", `The review marquee starts moving at ${width}px`);
      if ([320, 390, 1024, 1440, 2560].includes(width)) {
        const screenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        fs.writeFileSync(`/tmp/dbcinema-home-review-${width}.png`, Buffer.from(screenshot.data, "base64"));
      }
      if (width === 390) {
        const beforeRotation = await browser.evaluate(`(() => {const tile=document.querySelector('${card}'),panel=tile.querySelector('.hygglo-trust-review-panel'),quote=tile.querySelector('blockquote'),tileRect=tile.getBoundingClientRect(),panelRect=panel.getBoundingClientRect();return{text:quote.textContent,width:tileRect.width,height:tileRect.height,panelTop:panelRect.top,panelHeight:panelRect.height}})()`);
        await delay(4200);
        const afterRotation = await browser.evaluate(`(() => {const tile=document.querySelector('${card}'),panel=tile.querySelector('.hygglo-trust-review-panel'),quote=tile.querySelector('blockquote'),tileRect=tile.getBoundingClientRect(),panelRect=panel.getBoundingClientRect();return{text:quote.textContent,width:tileRect.width,height:tileRect.height,panelTop:panelRect.top,panelHeight:panelRect.height}})()`);
        assert.notEqual(afterRotation.text, beforeRotation.text, "The featured quote advances to another renter review on mobile");
        for (const key of ["width", "height", "panelTop", "panelHeight"])
          assert(Math.abs(afterRotation[key] - beforeRotation[key]) < 1, `Review rotation does not shift the featured card or frosted panel on mobile: ${JSON.stringify({beforeRotation,afterRotation})}`);
      }
      const dimensions = await browser.evaluate(`(() => {const tile=document.querySelector('${card}'),quote=tile.querySelector('blockquote'),height=tile.getBoundingClientRect().height;quote.textContent='Long synthetic review. '.repeat(100);return{before:height,after:tile.getBoundingClientRect().height,quote:quote.getBoundingClientRect().height,scroll:quote.scrollHeight}})()`);
      assert.equal(dimensions.before, dimensions.after, `A long featured review cannot expand its card at ${width}px`);
      assert(dimensions.scroll > dimensions.quote, `Long text is clipped within the quote window at ${width}px`);
      const avatarPoint = await browser.evaluate(`(() => {const tile=document.querySelector('${card}'),panel=tile.querySelector('.hygglo-trust-review-panel'),avatar=panel.querySelector('[data-testid="reviewer-avatar-fallback"], img'),rect=avatar.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
      await browser.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: avatarPoint.x, y: avatarPoint.y });
      const hoveredAvatar = await browser.evaluate(`(() => {const tile=document.querySelector('${card}'),panel=tile.querySelector('.hygglo-trust-review-panel'),avatar=panel.querySelector('[data-testid="reviewer-avatar-fallback"], img'),tileRect=tile.getBoundingClientRect(),panelRect=panel.getBoundingClientRect(),avatarRect=avatar.getBoundingClientRect();return{tileHeight:tileRect.height,panelInside:panelRect.left>=tileRect.left&&panelRect.right<=tileRect.right&&panelRect.top>=tileRect.top&&panelRect.bottom<=tileRect.bottom,avatarInside:avatarRect.left>=panelRect.left&&avatarRect.right<=panelRect.right&&avatarRect.top>=panelRect.top&&avatarRect.bottom<=panelRect.bottom,avatarSquare:Math.abs(avatarRect.width-avatarRect.height)<1,avatarRound:getComputedStyle(avatar).borderRadius,avatarWidth:avatarRect.width,avatarHeight:avatarRect.height,avatarFit:avatar.tagName==='IMG'?getComputedStyle(avatar).objectFit:'fallback'}})()`);
      assert.equal(hoveredAvatar.tileHeight, dimensions.before, `Hovering a review photo cannot resize the featured tile at ${width}px`);
      assert(hoveredAvatar.panelInside && hoveredAvatar.avatarInside, `The frosted review panel and renter avatar stay within their card bounds on hover at ${width}px: ${JSON.stringify(hoveredAvatar)}`);
      assert(hoveredAvatar.avatarSquare && Number.parseFloat(hoveredAvatar.avatarRound) >= Math.min(hoveredAvatar.avatarWidth, hoveredAvatar.avatarHeight) / 2, `The renter photo remains a circular, non-distorting avatar at ${width}px: ${JSON.stringify(hoveredAvatar)}`);
      if (hoveredAvatar.avatarFit !== "fallback") assert.equal(hoveredAvatar.avatarFit, "cover", `The source reviewer photo keeps its intended crop at ${width}px`);
      const rail = await browser.evaluate(`(() => {const track=document.querySelector('.hygglo-review-track'),row=document.querySelector('[data-testid=hygglo-review-row]'),rect=row.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
      await browser.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: rail.x, y: rail.y });
      assert.equal(await browser.evaluate('getComputedStyle(document.querySelector(".hygglo-review-track")).animationPlayState'), "running", `The marquee does not pause when hovered at ${width}px`);
      await browser.evaluate(`document.querySelector('[aria-label="Rental and review figures"]').scrollIntoView({block:"center",behavior:"instant"})`);
      await delay(1600);
      const figures = await browser.evaluate(`Array.from(document.querySelectorAll('[aria-label="Rental and review figures"] [aria-hidden="true"].tabular-nums')).map(node=>node.textContent)`);
      assert.deepEqual(figures, ["4.73", "1,300+", "175"], `The visible profile rating, review lower bound, and item count finish counting at ${width}px`);
    }
    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 3, mobile: true });
    await browser.cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await navigateToFreshDocument(browser, `http://127.0.0.1:${server.address().port}/?view=390&motion=reduced`);
    await waitForCondition(() => browser.evaluate(`!!document.querySelector('[data-testid="hygglo-trust-card"]')`), "the reduced-motion mobile review tile");
    const reducedMotionBefore = await browser.evaluate(`(() => {const tile=document.querySelector('[data-testid="hygglo-trust-card"]'),eye=tile.querySelector('[data-testid="review-eye-glyph"]'),quote=tile.querySelector('blockquote'),panel=tile.querySelector('.hygglo-trust-review-panel'),tileRect=tile.getBoundingClientRect(),panelRect=panel.getBoundingClientRect();return{text:quote.textContent,width:tileRect.width,height:tileRect.height,panelTop:panelRect.top,panelHeight:panelRect.height,eyeAnimation:getComputedStyle(eye).animationName,irisAnimation:getComputedStyle(eye.querySelector('.review-eye-iris')).animationName,quoteAnimation:getComputedStyle(quote).animationName,edgeAnimation:getComputedStyle(tile,'::after').animationName}})()`);
    assert.equal(reducedMotionBefore.eyeAnimation, "none", "Reduced motion disables the eye pulse");
    assert.equal(reducedMotionBefore.irisAnimation, "none", "Reduced motion disables eye movement");
    assert.equal(reducedMotionBefore.quoteAnimation, "none", "Reduced motion disables the quote entrance transition");
    assert.equal(reducedMotionBefore.edgeAnimation, "none", "Reduced motion disables the tile-edge animation");
    const reducedMotionScreenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync("/tmp/dbcinema-home-review-390-reduced.png", Buffer.from(reducedMotionScreenshot.data, "base64"));
    await delay(4200);
    const reducedMotionAfter = await browser.evaluate(`(() => {const tile=document.querySelector('[data-testid="hygglo-trust-card"]'),quote=tile.querySelector('blockquote'),panel=tile.querySelector('.hygglo-trust-review-panel'),tileRect=tile.getBoundingClientRect(),panelRect=panel.getBoundingClientRect();return{text:quote.textContent,width:tileRect.width,height:tileRect.height,panelTop:panelRect.top,panelHeight:panelRect.height}})()`);
    assert.equal(reducedMotionAfter.text, reducedMotionBefore.text, "Reduced motion leaves the featured review stable instead of auto-rotating");
    for (const key of ["width", "height", "panelTop", "panelHeight"])
      assert(Math.abs(reducedMotionAfter[key] - reducedMotionBefore[key]) < 1, `The reduced-motion tile remains geometrically stable: ${JSON.stringify({reducedMotionBefore,reducedMotionAfter})}`);
    console.log("PASS home review showcase fixture: frosted featured card, standalone eye, clamped quote, full moving reviews, count-up figures, section order, and no top-nav Reviews link.");
  } finally {
    if (browser) {
      try { await browser.cmd("Browser.close"); } catch {}
    }
    browser?.close();
    const chromeExited = chrome.exitCode !== null
      ? Promise.resolve()
      : new Promise(resolve => chrome.once("exit", resolve));
    if (chrome.exitCode === null) chrome.kill("SIGTERM");
    await Promise.race([chromeExited, delay(3000)]);
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
    await removeChromeProfileWithRetry(chromeDir);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
