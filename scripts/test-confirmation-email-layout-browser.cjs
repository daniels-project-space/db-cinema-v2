const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),helper=fs.readFileSync(root+'/scripts/test-membership-browser.cjs','utf8');
const connect=new Function('require',helper.slice(0,helper.indexOf('const { ConvexHttpClient }'))+';return connect;')(require);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-confirm-email-')),html=path.join(directory,'email.html');
 execFileSync(process.execPath,['scripts/test-checkout-verification-email.cjs'],{cwd:root,env:{...process.env,DBC_EMAIL_PREVIEW:html}});
 const server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(fs.readFileSync(html))});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${directory}/chrome`],{stdio:'ignore'});let client;
 try{let port;for(let attempt=0;attempt<100;attempt++){try{port=fs.readFileSync(`${directory}/chrome/DevToolsActivePort`,'utf8').split('\n')[0];break}catch{await wait(100)}}assert(port);process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;client=await connect();await client.cmd('Page.enable');
 for(const width of [320,390,1000]){await client.cmd('Emulation.setDeviceMetricsOverride',{width,height:1300,deviceScaleFactor:1,mobile:width<600});await client.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});await wait(150);const metrics=await client.evaluate(`({width:document.documentElement.scrollWidth,viewport:innerWidth,link:document.querySelector('a[href*="#chat"]')?.getBoundingClientRect().toJSON()})`);assert(metrics.width<=width,`email must fit ${width}px: ${JSON.stringify(metrics)}`);assert(metrics.link&&metrics.link.right<=width,'chat button fits viewport');const image=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`/tmp/dbc-confirmation-email-${width}.png`,Buffer.from(image.data,'base64'));}
 console.log('PASS synthetic confirmation email renders without horizontal overflow and exposes its booking chat action at 320, 390 and 1000px.');
 }finally{if(client)client.close();server.close();chrome.kill('SIGTERM');await wait(100);fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
})().catch(error=>{console.error(error);process.exitCode=1});
