const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'test-membership-browser.cjs'),'utf8');
const connect=new Function('require',source.slice(0,source.indexOf('const { ConvexHttpClient }'))+'\nreturn connect;')(require);
const token=process.env.DBC_TEST_ADMIN_TOKEN,email=process.env.DBC_TEST_EMAIL,hashes=JSON.parse(process.env.DBC_TEST_HASHES??'[]');
const downloadLabel=process.env.DBC_TEST_DOWNLOAD_LABEL??'Download Proof';
const base=process.env.DBC_BROWSER_ROOT??'http://127.0.0.1:41848',dir=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-doc-')),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const browserDir=path.join(process.env.DBC_BROWSER_FILESYSTEM_ROOT??'/',dir);
if(!token||!email||!hashes.length)throw Error('A test admin token, exact customer email and expected SHA-256 hashes are required.');
(async()=>{
 const client=await connect(),events=[];let stage='start',downloadId;
 client.on(event=>{if(event.method==='Browser.downloadWillBegin')downloadId=event.params.guid;if(event.method==='Browser.downloadProgress')events.push({guid:event.params.guid,state:event.params.state});});
 async function until(expression){for(let i=0;i<100;i++){if(await client.evaluate(expression))return;await wait(300)}throw Error(`Control unavailable: ${stage}`)}
 try{
  await client.cmd('Page.enable');await client.cmd('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:dir,eventsEnabled:true});
  await client.cmd('Page.navigate',{url:`${base}/admin`});await wait(2500);
  await client.evaluate(`localStorage.setItem('dbc_admin',${JSON.stringify(token)})`);await client.cmd('Page.reload');
  stage='customers';await until(`[...document.querySelectorAll('button')].some(x=>x.innerText.trim()==='Customers')`);
  await client.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Customers').click()`);
  stage='search';await until(`!!document.querySelector('input[placeholder="Search customers, name or email…"]')`);
  await client.evaluate(`(()=>{let element=document.querySelector('input[placeholder="Search customers, name or email…"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(email)});element.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  stage='customer';await until(`[...document.querySelectorAll('[data-testid="admin-account-row"]')].some(x=>x.closest('tr').innerText.includes(${JSON.stringify(email)}))`);
  await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-row"]')].find(x=>x.closest('tr').innerText.includes(${JSON.stringify(email)})).click()`);
  stage='documents';await until(`[...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='Documents')`);
  await client.evaluate(`[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Documents').click()`);
  stage='download';await until(`[...document.querySelectorAll('button[aria-label]:not(:disabled)')].some(button=>button.getAttribute('aria-label').startsWith(${JSON.stringify(downloadLabel)}))`);
  await client.evaluate(`[...document.querySelectorAll('button[aria-label]:not(:disabled)')].find(button=>button.getAttribute('aria-label').startsWith(${JSON.stringify(downloadLabel)})).click()`);
  for(let i=0;i<100&&!events.some(event=>event.guid===downloadId&&event.state==='completed');i++)await wait(200);
  if(!downloadId||!events.some(event=>event.guid===downloadId&&event.state==='completed'))throw Error('The browser did not complete the download.');
  const bytes=fs.readFileSync(path.join(browserDir,downloadId)),valid=hashes.includes(crypto.createHash('sha256').update(bytes).digest('hex'));
  if(!valid)throw Error('The downloaded file does not match a saved document.');
  console.log(JSON.stringify({downloadCompleted:true,bytes:bytes.length,sha256MatchesSavedDocument:true}));
 }finally{
  try{await client.evaluate(`localStorage.removeItem('dbc_admin')`)}catch{}
  client.close();await fetch(`${process.env.DBC_CDP_URL??'http://localhost:9224'}/json/close/${client.tabId}`);
  fs.rmSync(browserDir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.message);fs.rmSync(browserDir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});process.exitCode=1});
