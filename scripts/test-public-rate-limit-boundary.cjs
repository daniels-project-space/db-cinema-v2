const assert=require('node:assert/strict');
const {load,db,setMock}=require('./lib/rentalTestHarness.cjs');
const rate=load('convex/rateLimit.ts'),ctx={db};
const realNow=Date.now;let now=100000000;Date.now=()=>now;
(async()=>{try{
 for(const key of ['verification-reuse-claim:global','verification-reuse-claim:account','contact:global','contact:synthetic@example.invalid','followup:all','followup:synthetic@example.invalid','waitlist:global','waitlist:synthetic@example.invalid','account-code:global','admin_token','checkout-recovery:account','basket-activity:account']){
  assert((await rate.bump(ctx,key,1,3600000)).allowed);
  now+=2;
  await assert.rejects(rate.hit.handler(ctx,{key,limit:100,windowMs:1}),/Invalid API rate-limit/);
  assert(!(await rate.bump(ctx,key,1,3600000)).allowed,`${key} must remain exhausted`);
 }
 for(const [bucket,limit] of [['voice',40],['bot',30],['compat',60],['assemble',15]]){
  for(const suffix of ['anon','127.0.0.1','2001:db8::1'])assert((await rate.hit.handler(ctx,{key:`${bucket}:${suffix}`,limit,windowMs:60000})).allowed);
  for(const args of [{key:`${bucket}:anon`,limit,windowMs:1},{key:`${bucket}:anon`,limit:limit+1,windowMs:60000},{key:`${bucket}:`,limit,windowMs:60000}])await assert.rejects(rate.hit.handler(ctx,args),/Invalid API rate-limit/);
  await assert.rejects(rate.hit.handler(ctx,{key:`${bucket}:${'x'.repeat(257)}`,limit,windowMs:60000}),/Invalid API rate-limit/);
  assert((await rate.hit.handler(ctx,{key:`${bucket}:${'x'.repeat(255-bucket.length)}`,limit,windowMs:60000})).allowed,'A 256-character key remains permitted');
 }
 assert((await rate.hit.handler(ctx,{key:'bot:contact:global',limit:30,windowMs:60000})).allowed);
 assert(!(await rate.bump(ctx,'contact:global',1,3600000)).allowed,'A prefixed collision is a distinct key');
 const sent=[];setMock('convex/browser',{ConvexHttpClient:class{async mutation(_ref,args){sent.push(args);return {allowed:false,retryAfterMs:1000}}}});
 const next=load('src/lib/ratelimit.ts'),oldUrl=process.env.NEXT_PUBLIC_CONVEX_URL;process.env.NEXT_PUBLIC_CONVEX_URL='https://synthetic.invalid';
 try{
  for(const headers of [{'x-forwarded-for':'x'.repeat(201)},{'x-forwarded-for':', 192.0.2.1'},{'x-real-ip':'x'.repeat(201)},{}]){
   const result=await next.rateLimit(new Request('https://synthetic.invalid',{headers}),'bot',30,60000);
   assert.equal(result.allowed,false,'Invalid identifier must not force a fail-open response');assert.equal(sent.at(-1).key,'bot:anon');
  }
  assert.equal(next.clientIp(new Request('https://synthetic.invalid',{headers:{'x-forwarded-for':'2001:db8::1, 192.0.2.1'}})),'2001:db8::1');
 }finally{if(oldUrl===undefined)delete process.env.NEXT_PUBLIC_CONVEX_URL;else process.env.NEXT_PUBLIC_CONVEX_URL=oldUrl}
 now+=25*3600000;await rate.sweep.handler(ctx,{});
 assert.equal((await db.query('rate_limits').collect()).length,0,'Existing stale-counter cleanup remains functional');
 console.log('PASS public limiter: workflow namespaces and policy cannot be reset; all four Next buckets and stale cleanup work.');
}finally{Date.now=realNow}})().catch(error=>{console.error(error);process.exitCode=1});
