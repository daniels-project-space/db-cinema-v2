const assert=require('node:assert/strict'),{checkStockBackend}=require('./check-stock-backend.cjs');
const backendUrl='https://test-deployment.convex.cloud',frontendUrl=backendUrl;
let calls=0;
const transport=(status,value,catalog={status:'success',value:[{_id:'real-listing'}]})=>async(url,request)=>{
 calls++;assert.equal(request.method,'POST');assert(request.signal);
 const body=JSON.parse(request.body);
 if(url.endsWith('/api/query')){assert.deepEqual(body,{path:'catalog:listListings',args:{},format:'json'});return {status:200,ok:true,json:async()=>catalog}}
 assert.equal(url,backendUrl+'/api/action');assert.equal(body.path,'sync:refreshCartStock');assert.equal(body.format,'json');assert.equal(body.args.items.length,1);assert.equal(body.args.items[0].listingId,'real-listing');assert.equal(body.args.items[0].start,body.args.items[0].end);assert(Number.isSafeInteger(body.args.items[0].start));
 return {status,ok:status===200,json:async()=>value};
};
(async()=>{
 for(const invalid of [undefined,'http://test-deployment.convex.cloud','https://user:secret@test-deployment.convex.cloud','https://test-deployment.convex.cloud/path','https://test-deployment.convex.cloud?token=secret','https://test-deployment.convex.cloud#fragment','https://example.invalid'])assert.equal((await checkStockBackend({backendUrl:invalid,frontendUrl,fetchImpl:()=>{throw Error('Must not fetch invalid binding')}})).code,'INVALID_BACKEND_BINDING');
 assert.equal((await checkStockBackend({backendUrl,frontendUrl:'https://another-deployment.convex.cloud',fetchImpl:()=>{throw Error('Must not fetch mismatched binding')}})).code,'FRONTEND_BACKEND_MISMATCH');
 const stock={status:'success',value:{checkedAt:Date.now(),availability:{'real-listing':{available:0,demanded:1,ok:false}}}};
 assert.equal((await checkStockBackend({backendUrl,frontendUrl,fetchImpl:transport(200,stock)})).ok,true,'Unavailable equipment still proves the actual stock bridge is functional');
 const absent=await checkStockBackend({backendUrl,frontendUrl,fetchImpl:transport(560,{status:'error',errorMessage:'Could not find public function for sync:refreshCartStock\nsecret'})});assert.equal(absent.code,'STOCK_FUNCTION_NOT_DEPLOYED');assert(!JSON.stringify(absent).includes('secret'));
 for(const [status,value]of [[200,{status:'success',value:{}}],[200,{status:'error',errorMessage:'Server Error'}],[560,{status:'error',errorMessage:'ArgumentValidationError: items must be an array'}],[500,stock],[200,{status:'success',value:{checkedAt:1,availability:{'real-listing':{available:-1,demanded:1,ok:true}}}}]])assert.equal((await checkStockBackend({backendUrl,frontendUrl,fetchImpl:transport(status,value)})).code,'UNEXPECTED_STOCK_BACKEND_RESPONSE');
 assert.equal((await checkStockBackend({backendUrl,frontendUrl,fetchImpl:transport(200,stock,{status:'success',value:[]})})).code,'CATALOG_EMPTY');
 assert.equal((await checkStockBackend({backendUrl,frontendUrl,fetchImpl:transport(200,stock,{status:'error',errorMessage:'secret'})})).code,'CATALOG_UNAVAILABLE');
 assert.equal((await checkStockBackend({backendUrl,frontendUrl,fetchImpl:async()=>{throw Error('secret')}})).code,'BACKEND_UNREACHABLE');
 assert.equal((await checkStockBackend({backendUrl,frontendUrl,fetchImpl:async()=>({json:async()=>{throw Error('Bad response')}})})).code,'BACKEND_UNREACHABLE');
 const action=require('./lib/rentalTestHarness.cjs').load('convex/sync.ts').refreshCartStock;assert.equal(action.args.items.json.type,'array');
 await assert.rejects(action.handler({runAction:async()=>{throw Error('Unexpected source effect')}},{items:[]}),/Invalid basket stock request/);
 assert.equal(calls,16);console.log('PASS stock runtime check: matching bindings, actual catalogue/stock shape, empty/missing/hidden-error failures, response redaction and unchanged empty basket guard. No payment or external provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
