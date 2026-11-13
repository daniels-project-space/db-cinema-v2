const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const esbuild = require('esbuild');
const postcss = require('postcss');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const source = fs.readFileSync('scripts/test-membership-browser.cjs', 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + '\nreturn connect;')(require);

(async () => {
  const mocks = { name: 'synthetic-review-data', setup(build) {
    build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|next\/image)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'convex/react' ? 'export const useQuery=()=>globalThis.__reviews;' : args.path === 'next/image' ? 'export default function Image(){return null}' : 'export const api={reviews:{listNativePublished:{}}};', loader: 'js' }));
  } };
  const bundle = await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ReviewCarousel} from './src/components/ReviewCarousel';let root;globalThis.accelerateReviews=()=>{if(window.__realReviewInterval)return;window.__realReviewInterval=window.setInterval.bind(window);window.__realClearReviewInterval=window.clearInterval.bind(window);window.setInterval=(callback,delay,...args)=>{if(delay!==12000)return window.__realReviewInterval(callback,delay,...args);const id=window.__realReviewInterval(()=>{window.__realClearReviewInterval(id);if(!window.__reviewAutoTicked){window.__reviewAutoTicked=true;callback()}},300,...args);return id}};globalThis.setFixture=count=>{if(root)root.unmount();window.__reviewAutoTicked=false;globalThis.__reviews=Array.from({length:count},(_,index)=>({_id:String(index),source:'native',author:'Test renter '+index,rating:index%5+1,text:index===0?'A deliberately long synthetic renter review. '.repeat(36):'Synthetic rental review number '+index+'.',incentivized:false}));root=createRoot(document.getElementById('root'));root.render(React.createElement(ReviewCarousel));};`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, platform: 'browser', plugins: [mocks] });
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="background:#151515;color:white"><main id="root"></main><script src="/bundle.js"></script></body></html>`;
  const server = http.createServer((request, response) => { const files = { '/': ['text/html', html], '/style.css': ['text/css', css.css], '/bundle.js': ['text/javascript', bundle.outputFiles[0].text] }; const item = files[request.url]; response.writeHead(item ? 200 : 404, { 'Content-Type': item?.[0] ?? 'text/plain' }); response.end(item?.[1] ?? 'Not found'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-review-browser-'));
  const chrome = spawn('/opt/google/chrome/chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${temporary}`, 'about:blank'], { stdio: 'ignore' });
  let client;
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(path.join(temporary, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { await delay(100); } }
    assert(port, 'Chrome must start'); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect(); await client.cmd('Page.enable'); await client.cmd('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('typeof setFixture === "function"'); attempt++) await delay(100);
    await client.evaluate('accelerateReviews()');
    for (const width of [320, 390, 430, 1280]) for (const count of [1, 50, 100]) {
      await client.cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await client.evaluate(`setFixture(${count})`); await delay(350);
      const state = await client.evaluate(`(() => {const cards=[...document.querySelectorAll('[data-testid=review-card]')],quote=cards[0]?.querySelector('blockquote'),footer=cards[0]?.querySelector('figcaption'),qr=quote?.getBoundingClientRect(),fr=footer?.getBoundingClientRect();return {cards:cards.length,overflow:document.documentElement.scrollWidth>innerWidth,cardBounds:cards.map(card=>{const r=card.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,height:r.height}}),quote:quote?.textContent,quoteClipped:quote&&getComputedStyle(quote).webkitLineClamp==='5',quoteFooterOverlap:!!qr&&!!fr&&qr.bottom>fr.top,next:!!document.querySelector('[aria-label="Next reviews"]'),controls:[...document.querySelectorAll('[aria-label="Next reviews"], [aria-label="Previous reviews"]')].map(button=>{const rect=button.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.width>=40})}})()`);
      assert.equal(state.cards, Math.min(count, width < 768 ? 1 : 3), `${count} reviews at ${width}px`); assert(!state.overflow, `No horizontal overflow at ${width}px`); assert.equal(state.next, count > state.cards); assert(state.controls.every(Boolean), `Pagination controls remain visible at ${width}px`);assert(state.cardBounds.every(box=>box.left>=0&&box.right<=width),`No half-clipped review cards at ${width}px`);assert.equal(state.quoteFooterOverlap,false,`Long review text does not collide with its attribution at ${width}px`);assert.equal(state.quoteClipped,true,'Long review text remains inside the five-line card');
      if (count > 1) { const initial=await client.evaluate('document.querySelector("[data-testid=review-card] blockquote").textContent');await client.evaluate('document.querySelector("[data-testid=review-card]").dispatchEvent(new MouseEvent("mouseenter",{bubbles:true}))');await delay(650);const advanced=await client.evaluate('document.querySelector("[data-testid=review-card] blockquote").textContent');assert.notEqual(advanced,initial,`Reviews auto-advance while hovered at ${width}px`);await client.evaluate('document.querySelector("[aria-label=\\"Next reviews\\"]").click()'); await delay(350); assert.notEqual(await client.evaluate('document.querySelector("[data-testid=review-card] blockquote").textContent'), 'Synthetic rental review number 0.'); }
      const screenshot = await client.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`/tmp/dbc-review-${width}-${count}.png`, Buffer.from(screenshot.data, 'base64'));
    }
    console.log('PASS synthetic native carousel: 1, 50 and 100 reviews at 320/390/430/1280px; correct visible count, no clipped cards or quote overlap, touch controls, manual navigation, and automatic advance while hovered. No network or customer data.');
  } finally { if (client) client.close(); if (chrome.exitCode === null) { const exited = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await exited; } server.close(); fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
