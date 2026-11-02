const assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto');global.crypto??=webcrypto;
const {load,setMock}=require('./lib/rentalTestHarness.cjs');
const routes=[];setMock('convex/server',{httpRouter:()=>({route:r=>routes.push(r)})});load('convex/http.ts');
const upload=routes.find(r=>r.path==='/renter-drone-document'&&r.method==='POST').handler;
const options=routes.find(r=>r.path==='/renter-drone-document'&&r.method==='OPTIONS').handler;
const documentOptions=routes.find(r=>r.path==='/admin-verification-document'&&r.method==='OPTIONS').handler;
const documentRead=routes.find(r=>r.path==='/admin-verification-document'&&r.method==='POST').handler;
const stored=new Map();let serial=0,saved=[],auth=[],reject=false;
const ctx={runQuery:async(ref,args)=>{auth.push(args);if(args.token!=='owner'&&args.checkoutSessionId!=='cs_owned')throw Error('unauthorized');},runMutation:async(ref,args)=>{if(reject)throw Error('Booking closed while uploading');saved.push(args);return {documentId:'private-document'};},storage:{store:async blob=>{const id='stored-'+(++serial);stored.set(id,blob);return id;},get:async id=>stored.get(id)??null,delete:async id=>stored.delete(id)}};
const pdf=Buffer.from('%PDF-1.7\nfixture only\n%%EOF');
const req=(body=pdf,headers={})=>new Request('https://fixture.convex.site/renter-drone-document?bookingId=bookings-fixture',{method:'POST',headers:{Origin:'https://dbcinemarentals.com',Authorization:'Bearer owner','Content-Type':'application/pdf',...headers},body});
(async()=>{
 for(const origin of ['https://dbcinemarentals.com','https://www.dbcinemarentals.com','https://db-cinema-v2.vercel.app']){
  const preflight=await documentOptions({},new Request('https://fixture.convex.site/admin-verification-document',{headers:{Origin:origin}}));
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 }
 assert.equal((await documentOptions({},new Request('https://fixture.convex.site/admin-verification-document',{headers:{Origin:'https://db-cinema-v2.vercel.app.evil.invalid'}}))).status,403);
 const readCtx={runMutation:async(_ref,args)=>{if(args.token!=='admin')throw Error('unauthorized');return {storageId:'private',kind:'address-0',contentType:'application/pdf'};},storage:{get:async()=>new Blob([pdf],{type:'application/pdf'})}};
 const readRequest=token=>new Request('https://fixture.convex.site/admin-verification-document',{method:'POST',headers:{Origin:'https://db-cinema-v2.vercel.app',Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({documentId:'fixture'})});
 assert.equal((await documentRead(readCtx,readRequest('foreign'))).status,403,'the Vercel alias does not bypass admin authorization');
 const documentResponse=await documentRead(readCtx,readRequest('admin'));assert.equal(documentResponse.status,200);assert.equal(documentResponse.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await documentResponse.arrayBuffer()),pdf);
 assert.equal((await options(ctx,new Request('https://fixture.convex.site/renter-drone-document',{headers:{Origin:'https://dbcinemarentals.com'}}))).status,204);
 assert.equal((await upload(ctx,req(pdf,{Origin:'https://evil.invalid'}))).status,403);assert.equal(auth.length,0,'Reject foreign origin before account/storage access');
 assert.equal((await upload(ctx,req(pdf,{Authorization:'Bearer foreign'}))).status,403);assert.equal(stored.size,0,'Foreign owner cannot store bytes');
 assert.equal((await upload(ctx,req(Buffer.from('<html>'),{}))).status,403);assert.equal(stored.size,0,'Forged PDF MIME cannot be stored');
 assert.equal((await upload(ctx,req(pdf,{'Content-Length':String(11*1024*1024)}))).status,413);
 let response=await upload(ctx,req());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{documentId:'private-document'});
 assert.equal(saved.length,1);assert.equal(saved[0].bookingId,'bookings-fixture');assert.equal(saved[0].sha256,createHash('sha256').update(pdf).digest('hex'));assert.equal(saved[0].size,pdf.length);
 response=await upload(ctx,req(pdf,{Authorization:'','X-Checkout-Session':'cs_owned'}));assert.equal(response.status,200,'Bound checkout session supports just-paid user');
 const before=stored.size;reject=true;response=await upload(ctx,req());assert.equal(response.status,403);assert.equal(stored.size,before,'Rental closure/race removes only the newly stored orphan');
 assert.equal(saved.length,2);
 console.log('PASS actual drone HTTP route: origin/auth before storage, trusted fresh bytes, magic/MIME/size/hash, pickup-session access, private no-store response and orphan cleanup on failed binding.');
})().catch(e=>{console.error(e);process.exitCode=1});
