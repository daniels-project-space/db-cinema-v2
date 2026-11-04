const assert=require('node:assert/strict');
const {load,db}=require('./lib/rentalTestHarness.cjs');
const voice=load('convex/voice.ts'),rate=load('convex/rateLimit.ts');
const jobs=[],ctx={db,scheduler:{runAfter:async(...args)=>jobs.push(args)}};
const realNow=Date.now;let now=1000000;Date.now=()=>now;
(async()=>{try{
 for(const invalid of [{kind:'',name:'Caller',message:'Question'},{kind:'inquiry',name:' ',message:'Question'},{kind:'inquiry',name:'Caller',message:' '},{kind:'x'.repeat(21),name:'Caller',message:'Question'},{kind:'inquiry',name:'x'.repeat(121),message:'Question'},{kind:'inquiry',name:'Caller',message:'x'.repeat(4001)},{kind:'inquiry',name:'Caller',message:'Question',phone:'x'.repeat(41)},{kind:'inquiry',name:'Caller',message:'Question',email:'x'.repeat(201)}])await assert.rejects(voice.lead.handler(ctx,invalid),/invalid/);
 assert.equal(jobs.length,0);assert.equal((await db.query('contact_messages').collect()).length,0);
 const samples=[{kind:'inquiry',name:'Web caller',message:'Please help',email:'fixture@example.invalid'},{kind:'callback',name:'Phone caller',message:'(no details)',phone:'0123456789'}];
 for(let index=0;index<20;index++)assert.equal((await voice.lead.handler(ctx,samples[index%2])).ok,true);
 await assert.rejects(voice.lead.handler(ctx,samples[0]),/many requests/);assert.equal(jobs.length,20);
 await assert.rejects(rate.hit.handler(ctx,{key:'voice-lead:global',limit:100,windowMs:1}),/Reserved/);
 await assert.rejects(voice.lead.handler(ctx,samples[1]),/many requests/);
 now+=60000;assert.equal((await voice.lead.handler(ctx,samples[1])).ok,true);assert.equal(jobs.length,21);
 console.log('PASS voice lead: valid web/phone payloads, bounded fields, server-owned global cap, public-reset denial and window recovery. Synthetic only.');
}finally{Date.now=realNow}})().catch(error=>{console.error(error);process.exitCode=1});
