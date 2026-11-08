const assert=require('node:assert/strict');
const {load,setMock}=require('./lib/rentalTestHarness.cjs');
const {verifyGafferCompletion,verifyGafferReplyProof}=load('shared/gafferCompletionProof.ts');
const secret='synthetic-only-completion-secret-at-least-32-bytes';process.env.GAFFER_COMPLETION_PROOF_SECRET=secret;process.env.NEXT_PUBLIC_CONVEX_URL='https://synthetic.invalid';
let rows=[{_id:'message-1',sender:'renter',text:'The stored question'}],resolved=true,observed;
setMock('next/server',{NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers??{}})}});
setMock('@/lib/ratelimit',{rateLimit:async()=>({allowed:true})});
setMock('@/lib/gaffer',{handleChat:async body=>{observed=body;return {reply:'Verified answer',cards:[],suggestions:[],resolvedInquiry:resolved}}});
setMock('convex/browser',{ConvexHttpClient:class{async query(_ref,args){return args.token==='renter'?rows:null}}});
setMock('@cvx/_generated/api',{api:{chat:{myThread:'myThread'}}});
const route=load('src/app/api/bot/route.ts'),request=body=>({json:async()=>body});
(async()=>{
 const response=await route.POST(request({token:'renter',renterMessageId:'message-1',messages:[{role:'user',content:'Forged history'}],channel:'email'}));assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(observed.messages,[{role:'user',content:'The stored question'}]);assert.equal(observed.channel,'chat');assert(await verifyGafferCompletion(secret,response.body.completionProof,'message-1','Verified answer',Date.now()));
 assert.equal((await route.POST(request({token:'renter',renterMessageId:'other'}))).status,409);assert.equal((await route.POST(request({token:'wrong',renterMessageId:'message-1'}))).status,409);
 resolved=false;const unresolved=await route.POST(request({token:'renter',renterMessageId:'message-1'}));assert.equal(unresolved.status,200);assert.equal((await verifyGafferReplyProof(secret,unresolved.body.completionProof,'message-1','Verified answer',Date.now())).resolved,false,'Every genuine answer receives a proof, even when unresolved');resolved=true;delete process.env.GAFFER_COMPLETION_PROOF_SECRET;const unconfigured=await route.POST(request({token:'renter',renterMessageId:'message-1'}));assert.equal(unconfigured.status,503);assert.equal(unconfigured.body.completionProof,undefined,'The route does not return an unsaveable account answer when signing is unavailable');
 console.log('PASS completion route: stored authenticated history, stale and foreign message rejection, and fail-closed signing; synthetic model and data.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{delete process.env.GAFFER_COMPLETION_PROOF_SECRET;delete process.env.NEXT_PUBLIC_CONVEX_URL});
