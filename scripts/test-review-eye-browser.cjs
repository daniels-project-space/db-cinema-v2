const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'test-membership-browser.cjs'),'utf8');
const connect=new Function('require',source.slice(0,source.indexOf('const { ConvexHttpClient }'))+'\nreturn connect;')(require);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{const client=await connect();try{
 await client.cmd('Page.enable');
 for(const width of [390,768,1280]){
  await client.cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await client.cmd('Page.navigate',{url:process.env.DBC_TEST_URL||'http://127.0.0.1:41910/'});
  for(let attempt=0;attempt<100&&!await client.evaluate(`!!document.querySelector('[data-testid="review-eye-glyph"]')`);attempt++)await delay(100);
  const result=await client.evaluate(`(()=>{const eye=document.querySelector('[data-testid="review-eye-glyph"]'),card=eye?.closest('[data-testid="hygglo-trust-card"]'),label=eye?.parentElement?.previousElementSibling,panel=card?.querySelector('.hygglo-trust-review-panel');if(!eye||!label||!panel)return null;const a=eye.getBoundingClientRect(),b=label.getBoundingClientRect(),c=panel.getBoundingClientRect(),frame=eye.parentElement.getBoundingClientRect();return {width:a.width,height:a.height,frameWidth:frame.width,frameBottom:frame.bottom,panelTop:c.top,labelRight:b.right,frameLeft:frame.left,labelText:label.textContent.trim(),insideLabel:label.contains(eye),href:card.getAttribute('href'),overflow:card.scrollHeight>card.clientHeight}})()`);
  assert(result,`The review eye renders at ${width}px`);assert.equal(result.labelText,'Trust that is earned');assert.equal(result.insideLabel,false);assert.equal(result.width,32);assert.equal(result.height,32);assert(result.frameWidth>=48);assert(result.frameLeft>result.labelRight);assert(result.panelTop>=result.frameBottom);assert(!result.overflow);assert.equal(result.href,'/#reviews');
  await client.evaluate(`document.querySelector('[data-testid="hygglo-trust-card"]').scrollIntoView({block:'center',behavior:'instant'})`);await delay(150);const screenshot=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`/tmp/dbc-review-eye-${width}.png`,Buffer.from(screenshot.data,'base64'));
 }
 console.log('PASS standalone animated eye, tile bounds and reviews link at phone, tablet and desktop sizes.');
}finally{client.close();await fetch(`${process.env.DBC_CDP_URL||'http://localhost:9224'}/json/close/${client.tabId}`)}})().catch(error=>{console.error(error);process.exitCode=1});
