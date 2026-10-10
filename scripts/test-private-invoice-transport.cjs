const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs');
const {invoiceRequest}=h.load('convex/lib/invoiceRequest.ts');
const requests=[];global.fetch=async(url,init)=>{requests.push({url,init});return new Response('%PDF-fixture',{headers:{'content-type':'application/pdf'}});};
(async()=>{
 process.env.APP_URL='https://db-cinema-v2-git-preview.vercel.app';process.env.VERCEL_AUTOMATION_BYPASS_SECRET='isolated-preview-fixture';
 await invoiceRequest(process.env.APP_URL+'/api/invoice/booking?phase=return-preview',{method:'POST',headers:{'x-invoice-key':'isolated-invoice-key'},body:'{}'});
 assert.equal(requests[0].init.headers['x-vercel-protection-bypass'],'isolated-preview-fixture');assert.equal(requests[0].init.headers['x-invoice-key'],'isolated-invoice-key');assert.equal(requests[0].init.redirect,'error');assert.equal(requests[0].init.body,'{}');assert(!requests[0].url.includes('isolated-'));
 await assert.rejects(()=>invoiceRequest('https://foreign.vercel.app/api/invoice/booking'),/Invalid private invoice/);
 await assert.rejects(()=>invoiceRequest(process.env.APP_URL+'/api/admin'),/Invalid private invoice/);assert.equal(requests.length,1);
 process.env.APP_URL='https://dbcinemarentals.com';await invoiceRequest(process.env.APP_URL+'/api/invoice/booking',{headers:{'x-vercel-protection-bypass':'injected'}});assert.equal(requests.at(-1).init.headers['x-vercel-protection-bypass'],undefined,'preview credential never forwarded to production/custom domains');
 process.env.APP_URL='http://localhost:42000';await invoiceRequest(process.env.APP_URL+'/api/invoice/booking');assert.equal(requests.at(-1).init.headers['x-vercel-protection-bypass'],undefined,'no credential on local HTTP');
 global.fetch=async(_url,init)=>{assert.equal(init.redirect,'error');throw Error('Redirect blocked');};await assert.rejects(()=>invoiceRequest(process.env.APP_URL+'/api/invoice/booking'),/Redirect blocked/);
 console.log('PASS private invoice transport: exact configured document origin/path, server-only preview header, no query credential, no custom-domain/HTTP leakage and credential-preserving redirect denial. Controlled transport only.');
})().catch(e=>{console.error(e);process.exitCode=1});
