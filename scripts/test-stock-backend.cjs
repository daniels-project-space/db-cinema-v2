const assert=require('node:assert/strict'),{checkStockBackend}=require('./check-stock-backend.cjs');
const backendUrl='https://test-deployment.convex.cloud',frontendUrl=backendUrl;
let calls=0;
const transport=(status,value)=>async(url,request)=>{calls++;assert.equal(url,backendUrl+'/api/action');assert.equal(request.method,'POST');assert.deepEqual(JSON.parse(request.body),{path:'sync:refreshCartStock',args:{items:null},format:'json'});assert(request.signal);return {status,ok:status===200,json:async()=>value}};
(async()=>{
 for(const invalid of [undefined,'http://test-deployment.convex.cloud','https://user:secret@test-deployment.convex.cloud','https://test-deployment.convex.cloud/path','https://test-deployment.convex.cloud?token=secret','https://test-deployment.convex.cloud#fragment','https://example.invalid'])assert.equal((await checkStockBackend({backendUrl:invalid,frontendUrl,fetchImpl:()=>{throw Error('Must not fetch invalid binding')}})).code,'INVALID_BACKEND_BINDING');
 assert.equal((await checkStockBackend({backendUrl,frontendUrl:'https://another-deployment.convex.cloud',fetchImpl:()=>{throw Error('Must not fetch mismatched binding')}})).code,'FRONTEND_BACKEND_MISMATCH');
 const valid=await checkStockBackend({backendUrl,frontendUrl,fetchImpl:transport(200,{status:'error',errorMessage:'ArgumentValidationError: items must be an array'})});assert.equal(valid.ok,true);
 assert.equal((await checkStockBackend({backendUrl,frontendUrl,fetchImpl:transport(560,{status:"error",errorMessage:"ArgumentValidationError: items must be an array"})})).ok,true,"Convex UDF failure status confirms argument validation before the action body");
 const absent=await checkStockBackend({backendUrl,frontendUrl,fetchImpl:transport(200,{status:'error',errorMessage:'Could not find public function for sync:refreshCartStock\nsecret'})});assert.equal(absent.code,'STOCK_FUNCTION_NOT_DEPLOYED');assert(!JSON.stringify(absent).includes('secret'));
 for(const [status,value]of [[200,{status:'success',value:{}}],[200,{status:'error',errorMessage:'Provider unavailable'}],[500,{status:'error',errorMessage:'Invalid basket stock request'}]])assert.equal((await checkStockBackend({backendUrl,frontendUrl,fetchImpl:transport(status,value)})).code,'UNEXPECTED_STOCK_BACKEND_RESPONSE');
 assert.equal((await checkStockBackend({backendUrl,frontendUrl,fetchImpl:async()=>{throw Error('secret')}})).code,'BACKEND_UNREACHABLE');
 assert.equal((await checkStockBackend({backendUrl,frontendUrl,fetchImpl:async()=>({json:async()=>{throw Error('Bad response')}})})).code,'BACKEND_UNREACHABLE');
 const action=require('./lib/rentalTestHarness.cjs').load('convex/sync.ts').refreshCartStock;assert.equal(action.args.items.json.type,'array','Actual action declares an array validator; null cannot enter the body');
 await assert.rejects(action.handler({runAction:async()=>{throw Error('Unexpected source effect')}},{items:[]}),/Invalid basket stock request/,'Real empty-basket guard also stops before source work');
 assert.equal(calls,6);console.log('PASS stock runtime check: matching deployment bindings, missing function, pre-body argument validation, bad/unreachable responses and provider error redaction. No source/provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
