const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(__dirname,'test-membership-browser.cjs'),'utf8');
const connect=new Function('require',source.slice(0,source.indexOf('const { ConvexHttpClient }'))+';return connect;')(require);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-fund-prize-'));
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import Page from './src/app/film-fund/page';createRoot(document.getElementById('root')).render(<><div style={{height:1100}}/><Page/></>);`;
 await esbuild.build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},outfile:path.join(directory,'fixture.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'fixture',setup(build){
  build.onResolve({filter:/(_generated\/api|^convex\/react$|^next\/link$|^next\/image$|\/SiteHeader$|\/FilmFundApplication$)/},args=>({path:args.path,namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:root,contents:args.path.endsWith('_generated/api')?`export const api={filmFund:{schedule:'schedule',notify:'notify'}};`:args.path==='convex/react'?`export const useQuery=()=>({rounds:[]});export const useMutation=()=>async()=>({});`:args.path==='next/link'?`import React from 'react';export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>}`:args.path==='next/image'?`import React from 'react';export default function Image({fill,priority,sizes,...props}){return <img {...props} style={fill?{...props.style,position:'absolute',inset:0,width:'100%',height:'100%'}:props.style}/ >}`:`export const SiteHeader=()=>null,FilmFundApplication=()=>null;`}));
 }}]});
 const server=http.createServer((request,response)=>{if(request.url==='/fixture.js'){response.setHeader('Content-Type','application/javascript');response.end(fs.readFileSync(path.join(directory,'fixture.js')))}else if(request.url==='/fixture.css'){response.setHeader('Content-Type','text/css');response.end(fs.readFileSync(path.join(directory,'fixture.css')))}else if(request.url==='/images/film-fund/crew-on-set.webp'){response.setHeader('Content-Type','image/webp');response.end(fs.readFileSync(path.join(root,'public/images/film-fund/crew-on-set.webp')))}else {response.setHeader('Content-Type','text/html');response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#11140f;color:white;font-family:Arial}main{max-width:1200px;margin:auto;padding:32px 20px}.fund-section-heading{margin-bottom:30px}.fund-hero-grid{display:grid;grid-template-columns:1fr 1fr;gap:36px;max-width:1200px;margin:auto}.fund-photo-wrap{position:relative;aspect-ratio:1.2;overflow:hidden}.fund-crew-image{object-fit:cover}.fund-prizes{margin-top:48px}@media(max-width:767px){.fund-hero-grid{grid-template-columns:1fr}.fund-photo-wrap{aspect-ratio:1.3}}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=19358;process.env.DBC_CDP_URL=`http://localhost:${port}`;
 const chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox',`--remote-debugging-port=${port}`,`--user-data-dir=${directory}/chrome`,'about:blank'],{stdio:'ignore'});
 let client;try{
  for(let attempt=0;attempt<100;attempt++){try{await fetch(`${process.env.DBC_CDP_URL}/json/version`);break}catch{await wait(100)}}
  client=await connect('about:blank');await client.cmd('Page.enable');await client.cmd('Runtime.enable');
  for(const width of [320,390,1440]){
   await client.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
   await client.cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
   await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
   for(let attempt=0;attempt<100&&!(await client.evaluate(`document.querySelector('[data-ready]') !== null`));attempt++)await wait(100);
   const initial=await client.evaluate(`(()=>{const chart=document.querySelector('[data-ready]');return {ready:chart.dataset.ready,visible:chart.dataset.visible,text:chart.textContent}})()`);
   assert.equal(initial.ready,'true');assert.equal(initial.visible,'false');assert(initial.text.includes('First place')&&initial.text.includes('Second place')&&initial.text.includes('7')&&initial.text.includes('2')&&initial.text.includes('Days of gear'));
   await client.evaluate(`document.querySelector('[data-ready]').scrollIntoView({block:'center'})`);
   for(let attempt=0;attempt<50&&!(await client.evaluate(`document.querySelector('[data-visible]').dataset.visible==='true'`));attempt++)await wait(100);
   assert.equal(await client.evaluate(`document.querySelector('[data-visible]').dataset.visible`),'true');
   const peakScales=[0,0];for(let attempt=0;attempt<48;attempt++){const transforms=await client.evaluate(`([...document.querySelectorAll('[data-prize-bar]')].map(bar=>getComputedStyle(bar).transform))`);for(let index=0;index<transforms.length;index++){const matrix=transforms[index].match(/^matrix\(([^)]+)\)$/);if(matrix)peakScales[index]=Math.max(peakScales[index],Number(matrix[1].split(',')[3]));}await wait(25);}assert(peakScales.every(scale=>scale>1.02),`both prizes visibly spring past their resting height before settling: ${JSON.stringify(peakScales)}`);
   const result=await client.evaluate(`(()=>{const chart=document.querySelector('[data-ready]');const bars=[...chart.querySelectorAll('[data-prize-bar]')];const values=[...chart.querySelectorAll('[data-prize-value]')];const articles=[...chart.querySelectorAll('article')];const hero=document.querySelector('.fund-crew-image');return {scroll:document.documentElement.scrollWidth,width:innerWidth,articles:articles.map(el=>({text:el.textContent,rect:el.getBoundingClientRect().toJSON()})),bars:bars.map(el=>el.getBoundingClientRect().toJSON()),values:values.map(el=>({rect:el.getBoundingClientRect().toJSON(),text:el.textContent,font:getComputedStyle(el.querySelector('strong')).fontSize})),hero:hero&&{loaded:hero.complete&&hero.naturalWidth>0,width:hero.getBoundingClientRect().width}}})()`);
   assert.equal(result.articles.length,2);assert(result.articles[0].text.includes('First place')&&result.articles[0].text.includes('7'));assert(result.articles[1].text.includes('Second place')&&result.articles[1].text.includes('2'));
   assert(result.scroll<=result.width,`no horizontal overflow at ${width}`);
   assert.equal(result.bars.length,2);assert(Math.abs(result.bars[1].height/result.bars[0].height-2/7)<.02,'bar heights match the actual seven and two day awards');
   assert.equal(result.values.length,2);assert(result.values.every((value,index)=>value.text.includes(index===0?'7':'2')&&value.text.includes('Days of gear')),'both animated labels show their award days');assert(result.values.every(value=>parseFloat(value.font)>=34),'award amounts remain readable at compact phone widths');
   assert(result.values.every((value,index)=>value.rect.bottom<=result.bars[index].top+1),'value labels sit above their bars without overlap');
   assert(result.hero?.loaded&&result.hero.width>0,'the original crew image remains visible above the prize chart');
   const screenshot=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`/tmp/dbc-filmfund-prizes-${width}.png`,Buffer.from(screenshot.data,'base64'));
  }
  await client.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
  for(let attempt=0;attempt<100&&!(await client.evaluate(`document.querySelector('[data-ready]') !== null`));attempt++)await wait(100);
  assert.equal(await client.evaluate(`document.querySelector('[data-ready]').dataset.ready`),'false','reduced motion shows awards without waiting for animation');
  await client.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await client.cmd('Page.addScriptToEvaluateOnNewDocument',{source:'delete window.IntersectionObserver'});await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
  for(let attempt=0;attempt<100&&!(await client.evaluate(`document.querySelector('[data-ready]') !== null`));attempt++)await wait(100);
  assert.equal(await client.evaluate(`document.querySelector('[data-ready]').dataset.ready`),'false','awards remain visible without IntersectionObserver');
  console.log('PASS real Film Fund page: viewport reveal, actual award days, mobile/desktop layout and reduced motion');
 }finally{if(client)client.close();chrome.kill();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
