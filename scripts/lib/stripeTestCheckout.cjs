const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const browserSource=fs.readFileSync(path.join(__dirname,'../test-membership-browser.cjs'),'utf8');
const connect=new Function('require',browserSource.slice(0,browserSource.indexOf('const { ConvexHttpClient }'))+';return connect;')(require);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function payTestCheckout(url,stripe,sessionId){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-stripe-test-checkout-'));
 const browser=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{stdio:'ignore',detached:true});let client;
 try{
  let port;for(let i=0;i<150;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break}catch{await wait(100)}}if(!port)throw Error('Test browser did not start');
  process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;client=await connect();await client.cmd('Page.enable');await client.cmd('Page.navigate',{url});
  let card;for(let i=0;i<90;i++){card=await client.evaluate(`(()=>{const e=document.getElementById('payment-method-label-card');if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()`);if(card)break;await wait(1000)}
  if(card){await client.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:card.x,y:card.y,button:'left',clickCount:1});await client.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:card.x,y:card.y,button:'left',clickCount:1});}
  for(let i=0;i<90;i++){if(await client.evaluate(`!!document.querySelector('input[name="cardNumber"]')`))break;await wait(1000)}
  const inputs=await client.evaluate(`Array.from(document.querySelectorAll('input,select')).map(e=>({tag:e.tagName,name:e.name,id:e.id,placeholder:e.placeholder}))`);
  if(!inputs.some(input=>input.name==='cardNumber'))throw Error(`Stripe test checkout card form not found: ${JSON.stringify(inputs)}`);
  async function type(selector,value){const found=await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();return true})()`);if(found)await client.cmd('Input.insertText',{text:value});return found;}
  await type('input[name="cardNumber"]','4242424242424242');await type('input[name="cardExpiry"]','1234');await type('input[name="cardCvc"]','123');await type('input[name="billingName"]','Synthetic Renter');await type('input[name="billingPostalCode"]','WC2N 5EJ');
  await client.evaluate(`(()=>{const b=document.querySelector('button[type="submit"]');if(!b)throw Error('Missing Stripe test submit');b.click()})()`);
  for(let i=0;i<90;i++){const session=await stripe.checkout.sessions.retrieve(sessionId);if(session.status==='complete'&&session.payment_status==='paid')return session;await wait(1000)}
  throw Error('Stripe test checkout did not complete; no live money involved');
 }finally{if(client)client.close();if(browser.pid)try{process.kill(-browser.pid,'SIGTERM')}catch(error){if(error.code!=='ESRCH')throw error}await new Promise(resolve=>browser.exitCode!==null||browser.signalCode!==null?resolve():browser.once('exit',resolve));await wait(500);fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
module.exports={payTestCheckout};
