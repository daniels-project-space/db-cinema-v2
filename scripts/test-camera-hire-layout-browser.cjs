const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const helper = fs.readFileSync(root + '/scripts/test-membership-browser.cjs', 'utf8');
const connect = new Function('require', helper.slice(0, helper.indexOf('const { ConvexHttpClient }')) + ';return connect;')(require);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-camera-hire-'));
  await require('esbuild').build({entryPoints: [root + '/src/components/CameraHirePage.tsx'], outfile: dir + '/page.js', bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', plugins: [{name: 'link', setup(build) {
    build.onResolve({filter: /^next\/link$/}, () => ({path: 'link', namespace: 'fixture'}));
    build.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({loader: 'tsx', resolveDir: root, contents: 'import React from "react";export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}'}));
  }}]});
  const React = require('react');
  const {CameraHirePage} = require(dir + '/page.js');
  const markup = require('react-dom/server').renderToString(React.createElement(CameraHirePage, {
    description: 'Compare cinema and mirrorless camera kits for hire in London.',
    tips: ['Choose the camera for your shoot.', 'Check the included accessories.'], guide: 'camera-hire',
    rows: [{slug: 'camera-one', title: 'A longer camera listing for a complete production kit'}],
    offers: [{slug: 'camera-one', title: 'A longer camera listing for a complete production kit', daily: 47, minimumRentalDays: 1}]
  }));
  const css = fs.readFileSync(dir + '/page.css', 'utf8');
  const server = http.createServer((req, res) => {res.setHeader('content-type', 'text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}body,h1,h2,h3,p,ol,ul{margin:0}ol,ul{padding:0;list-style:none}a{color:inherit;text-decoration:none}body{font-family:Arial,sans-serif}${css}</style></head><body>${markup}</body></html>`)});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await connect('about:blank');
    await browser.cmd('Page.enable'); await browser.cmd('Runtime.enable');
    for (const width of [320, 1440]) {
      await browser.cmd('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: width < 600});
      await browser.cmd('Page.navigate', {url: `http://127.0.0.1:${server.address().port}`});
      await new Promise(resolve => setTimeout(resolve, 250));
      assert(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'));
      assert(await browser.evaluate(`document.querySelector('a[href="/gear?cat=Cameras"]') !== null`));
      assert(await browser.evaluate(`document.querySelector('a[href="/gear/camera-one"]') !== null`));
      await browser.evaluate(`document.querySelector('nav[aria-label="Breadcrumb"] a[href="/gear"]').focus()`);
      await browser.cmd('Input.dispatchKeyEvent', {type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9});
      await browser.cmd('Input.dispatchKeyEvent', {type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9});
      assert(await browser.evaluate(`(() => {const action=document.querySelector('a[href="/gear?cat=Cameras"]');return document.activeElement === action && action.matches(':focus-visible') && getComputedStyle(action).outlineStyle !== 'none'})()`));
      if (width === 320) assert(await browser.evaluate(`(() => {const heading=document.querySelector('#camera-options').getBoundingClientRect();const link=Array.from(document.querySelectorAll('a')).find(element=>element.textContent.includes('All cameras')).getBoundingClientRect();return link.top >= heading.bottom && link.height >= 44})()`));
      await browser.evaluate('document.querySelector("summary").click()');
      assert(await browser.evaluate('document.querySelector("details").open'));
      await browser.evaluate('document.querySelector("summary").click(); window.scrollTo(0,0)');
      const shot = await browser.cmd('Page.captureScreenshot', {format:'png'});
      fs.writeFileSync(`/tmp/dbc-camera-hire-refined-${width}.png`, Buffer.from(shot.data, 'base64'));
      await browser.evaluate('document.querySelector("#camera-options").scrollIntoView()');
      const offersShot = await browser.cmd('Page.captureScreenshot', {format:'png'});
      fs.writeFileSync(`/tmp/dbc-camera-hire-offers-refined-${width}.png`, Buffer.from(offersShot.data, 'base64'));
    }
    await browser.cmd('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion', value:'reduce'}]});
    assert(await browser.evaluate(`(() => {const aperture=document.querySelector('svg[viewBox="0 0 200 200"]');return getComputedStyle(aperture).animationName === 'none' && getComputedStyle(aperture.parentElement).animationName === 'none'})()`));
    await browser.evaluate('window.scrollTo(0,0)');
    const visibleAction = await browser.evaluate(`(() => {const rect=document.querySelector('a[href="/gear?cat=Cameras"]').getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
    await browser.cmd('Input.dispatchMouseEvent', {type:'mouseMoved', x:visibleAction.x, y:visibleAction.y});
    assert(await browser.evaluate(`getComputedStyle(document.querySelector('a[href="/gear?cat=Cameras"]')).transform === 'none'`));
    console.log('PASS camera hire layout, links, directory and reduced motion at 320 and 1440 px (synthetic listings).');
  } finally {
    if(browser){browser.close();await fetch((process.env.DBC_CDP_URL||'http://localhost:9224')+'/json/close/'+browser.tabId,{signal:AbortSignal.timeout(2000)}).catch(()=>{});}
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(error => {console.error(error);process.exitCode=1});
