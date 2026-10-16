// Run after the reviewed Git deployment is live. No customer or private URLs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const config=require('../indexnow.json');
(async()=>{
 assert.equal(config.host,'dbcinemarentals.com');
 const keyUrl=new URL(config.keyLocation);assert.equal(keyUrl.origin,'https://'+config.host);assert.match(keyUrl.pathname,/^\/[a-f0-9]{32}\.txt$/);
 const key=fs.readFileSync(path.join(__dirname,'..','public',keyUrl.pathname.slice(1)),'utf8').trim();
 const liveKey=await fetch(config.keyLocation);assert(liveKey.ok);assert.equal((await liveKey.text()).trim(),key,'The production key file must be live first');
 const sitemap=await fetch('https://'+config.host+'/sitemap.xml');assert(sitemap.ok);
 const urls=[...new Set([...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&')))];assert(urls.length>0&&urls.length<=10000);
 for(const value of urls){const u=new URL(value);assert.equal(u.origin,'https://'+config.host);assert(!/^\/(?:account|admin|checkout|cart|plan|kit|verify|api|cancellation-choice)(?:\/|$)/.test(u.pathname),'Private URL in sitemap');}
 const response=await fetch('https://api.indexnow.org/indexnow',{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({...config,key,urlList:urls})});
 const receipt={at:new Date().toISOString(),host:config.host,submitted:urls.length,status:response.status,accepted:[200,202].includes(response.status),indexingGuaranteed:false};console.log(JSON.stringify(receipt,null,2));assert(receipt.accepted,`IndexNow rejected the submission (${response.status}): ${(await response.text()).slice(0,200)}`);
})().catch(e=>{console.error(e.message);process.exitCode=1});
